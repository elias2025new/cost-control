-- 005_counts.sql
-- Physical counts and the variance they reveal.
--
-- Two distinct variance checks exist in this system and both are kept:
--
--   Theoretical consumption -- what recipes say should have been used against
--   what the store actually issued. Catches recipe drift and over-portioning.
--   (See v_theoretical_consumption in 006.)
--
--   Inventory variance -- book stock at the outlet against a physical count.
--   Catches theft and miscounting. That is this file.

create table stock_counts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  store_id    uuid not null references stores(id),
  count_date  date not null,
  status      text not null default 'draft'
              check (status in ('draft','posted','reversed')),
  counted_by  text,
  note        text,
  created_at  timestamptz not null default now(),
  posted_at   timestamptz,
  unique (tenant_id, store_id, count_date)
);

create table stock_count_lines (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  stock_count_id  uuid not null references stock_counts(id) on delete cascade,
  item_id         uuid not null references items(id),

  -- book stock at the moment the count was taken, snapshotted so the count
  -- stays meaningful after later movements land
  theoretical_qty numeric(18,6) not null,
  counted_qty     numeric(18,6),
  unit_cost       numeric(18,2) not null default 0,

  variance_qty numeric(18,6)
    generated always as (coalesce(counted_qty, 0) - theoretical_qty) stored,

  note            text,
  unique (tenant_id, stock_count_id, item_id)
);

-- Variance with the client's thresholds applied: within 3% is OK, within 8%
-- is REVIEW, beyond that is INVESTIGATE. Where book stock is zero any
-- difference at all is INVESTIGATE — a percentage of nothing is meaningless.
create view v_stock_count_variance as
select
  cl.tenant_id,
  sc.store_id,
  sc.count_date,
  sc.status,
  cl.stock_count_id,
  cl.id as stock_count_line_id,
  cl.item_id,
  i.code as item_code,
  i.name as item_name,
  i.uom,
  cl.theoretical_qty,
  cl.counted_qty,
  cl.variance_qty,
  cl.unit_cost,
  round(cl.variance_qty * cl.unit_cost, 2) as variance_value,
  case
    when cl.theoretical_qty = 0 then null
    else round(abs(cl.variance_qty) / abs(cl.theoretical_qty), 6)
  end as variance_ratio,
  case
    when cl.counted_qty is null then 'NOT COUNTED'
    when cl.variance_qty = 0 then 'OK'
    when cl.theoretical_qty = 0 then 'INVESTIGATE'
    when abs(cl.variance_qty) / abs(cl.theoretical_qty) <= 0.03 then 'OK'
    when abs(cl.variance_qty) / abs(cl.theoretical_qty) <= 0.08 then 'REVIEW'
    else 'INVESTIGATE'
  end as variance_status
from stock_count_lines cl
join stock_counts sc on sc.id = cl.stock_count_id
join items i on i.id = cl.item_id;
