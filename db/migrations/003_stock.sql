-- 003_stock.sql
-- The one append-only ledger, and stock on hand derived from it.

-- ---------------------------------------------------------------------------
-- stock_movements
--
-- Design rule 1: stock on hand is never stored. Every receipt, issue,
-- transfer, sale depletion, wastage, comp, staff meal and count adjustment
-- writes signed rows here, and stock is always SUM(qty_delta). There is no
-- quantity column anywhere in this schema that anything updates.
--
-- Design rule 2: nothing is deleted or edited after posting. That is enforced
-- below by a trigger, not by convention. A correction is a reversing movement
-- carrying reversal_of_id.
--
-- unit_cost is stamped on every row so history stays reproducible and FIFO
-- remains possible later. Costing is moving weighted average per store and
-- item: an inbound row carries the cost it arrived at, an outbound row carries
-- the moving average in force at that moment. Because both the quantity and
-- the value of the balance are running sums, that makes the current average
-- exactly SUM(value_delta) / SUM(qty_delta) — which is all v_stock_on_hand does.
-- ---------------------------------------------------------------------------
create table stock_movements (
  id             uuid primary key default gen_random_uuid(),
  -- Insertion order, so the ledger's running balance is deterministic.
  -- occurred_at alone is not enough: everything written inside one transaction
  -- shares a single now(), and a uuid tie-break would order rows at random.
  seq            bigserial not null,
  tenant_id      uuid not null references tenants(id),
  store_id       uuid not null references stores(id),
  item_id        uuid not null references items(id),

  movement_type  text not null check (movement_type in (
                   'opening',          -- opening balance
                   'receipt',          -- purchase received into a store
                   'issue_out',        -- leaves the issuing store
                   'issue_in',         -- arrives at the receiving store
                   'transfer_out',     -- inter-outlet, leaves
                   'transfer_in',      -- inter-outlet, arrives
                   'sale_depletion',   -- exploded from a recipe on a posted sale
                   'wastage',
                   'comp',             -- complimentary: full standard recipe cost
                   'staff_meal',       -- costed at raw ingredient cost
                   'count_adjustment', -- physical count correction
                   'reversal'
                 )),

  qty_delta      numeric(18,6) not null check (qty_delta <> 0),
  unit_cost      numeric(18,2) not null check (unit_cost >= 0),
  -- signed value of the movement; kept as a column so the average is a plain
  -- SUM and never has to be replayed row by row
  value_delta    numeric(18,2) not null,

  occurred_on    date not null,
  occurred_at    timestamptz not null default now(),

  source_doc_type text not null,   -- 'sales_import', 'stock_count', 'seed', ...
  source_doc_id   uuid,
  source_doc_line uuid,            -- e.g. the sales_lines row that caused this
  reversal_of_id  uuid references stock_movements(id),

  note           text,
  created_at     timestamptz not null default now(),
  created_by     text not null default 'system'
);

create index stock_movements_balance
  on stock_movements (tenant_id, store_id, item_id, occurred_on, seq);

-- Inbound before outbound within a day.
--
-- Issuing stock at the weighted average does not move the average — only a
-- receipt does. So the only ordering that affects the arithmetic is that a
-- receipt landing on a given day must be seen before that day's depletions,
-- otherwise the depletion is valued at yesterday's average. This function
-- makes that ordering a property of the ledger rather than of the order
-- someone happened to insert rows in.
create or replace function movement_sort_rank(p_type text) returns integer as $$
  select case p_type
           when 'opening'      then 0
           when 'receipt'      then 1
           when 'issue_in'     then 1
           when 'transfer_in'  then 1
           else 2
         end;
$$ language sql immutable;

create index stock_movements_by_doc
  on stock_movements (tenant_id, source_doc_type, source_doc_id);

-- Posting a sales import twice must not double-deplete. The transaction guard
-- in postSalesImport is the primary defence; this index makes a second set of
-- rows impossible even if that guard were ever bypassed. Depletion is
-- aggregated to one row per (sales line, store, item), so an ingredient
-- reached by two different branches of the recipe tree still lands once.
create unique index stock_movements_sale_depletion_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'sales_import' and movement_type = 'sale_depletion';

-- ---------------------------------------------------------------------------
-- Append-only, enforced.
--
-- The ledger is the record of what happened. A posted movement may not be
-- edited or deleted by anyone, including us. Corrections are reversing rows.
-- ---------------------------------------------------------------------------
create or replace function stock_movements_append_only() returns trigger as $$
begin
  raise exception
    'stock_movements is append-only: % is not permitted. Post a reversing movement instead.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

create trigger stock_movements_no_update
  before update on stock_movements
  for each row execute function stock_movements_append_only();

create trigger stock_movements_no_delete
  before delete on stock_movements
  for each row execute function stock_movements_append_only();

-- ---------------------------------------------------------------------------
-- Stock on hand, with moving weighted average cost. Never stored, always summed.
-- ---------------------------------------------------------------------------
create view v_stock_on_hand as
select
  m.tenant_id,
  m.store_id,
  m.item_id,
  sum(m.qty_delta)                       as qty_on_hand,
  sum(m.value_delta)                     as value_on_hand,
  case
    when sum(m.qty_delta) = 0 then 0::numeric(18,2)
    else round(sum(m.value_delta) / sum(m.qty_delta), 2)
  end                                    as avg_unit_cost,
  max(m.occurred_on)                     as last_movement_on,
  count(*)                               as movement_count
from stock_movements m
group by m.tenant_id, m.store_id, m.item_id;

-- The same figure as at a point in time, for reports run over a closed period.
create or replace function stock_on_hand_as_of(
  p_tenant uuid,
  p_store  uuid,
  p_item   uuid,
  p_as_of  date
) returns table (qty numeric, value numeric, avg_unit_cost numeric) as $$
  select
    coalesce(sum(m.qty_delta), 0),
    coalesce(sum(m.value_delta), 0),
    case
      when coalesce(sum(m.qty_delta), 0) = 0 then 0::numeric
      else round(sum(m.value_delta) / sum(m.qty_delta), 2)
    end
  from stock_movements m
  where m.tenant_id = p_tenant
    and m.store_id  = p_store
    and m.item_id   = p_item
    and m.occurred_on <= p_as_of;
$$ language sql stable;

-- The moving weighted average in force right now for a store and item. Every
-- outbound movement stamps its unit_cost from this.
create or replace function current_avg_cost(
  p_tenant uuid,
  p_store  uuid,
  p_item   uuid
) returns numeric as $$
  select case
           when coalesce(sum(m.qty_delta), 0) = 0 then 0::numeric
           else round(sum(m.value_delta) / sum(m.qty_delta), 2)
         end
    from stock_movements m
   where m.tenant_id = p_tenant
     and m.store_id  = p_store
     and m.item_id   = p_item;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- The stock ledger view: every movement for a store and item with a running
-- balance. This is what the ledger screen reads.
-- ---------------------------------------------------------------------------
create view v_stock_ledger as
select
  m.tenant_id,
  m.store_id,
  s.code   as store_code,
  s.name   as store_name,
  m.item_id,
  i.code   as item_code,
  i.name   as item_name,
  i.uom,
  m.id     as movement_id,
  m.seq,
  m.occurred_on,
  m.occurred_at,
  m.movement_type,
  m.qty_delta,
  m.unit_cost,
  m.value_delta,
  m.source_doc_type,
  m.source_doc_id,
  m.reversal_of_id,
  m.note,
  sum(m.qty_delta) over w   as running_qty,
  sum(m.value_delta) over w as running_value
from stock_movements m
join stores s on s.id = m.store_id
join items  i on i.id = m.item_id
window w as (
  partition by m.tenant_id, m.store_id, m.item_id
  order by m.occurred_on, movement_sort_rank(m.movement_type), m.seq
  rows between unbounded preceding and current row
);

-- ---------------------------------------------------------------------------
-- Reorder status against par levels.
-- ---------------------------------------------------------------------------
create view v_reorder_status as
select
  l.tenant_id,
  l.store_id,
  l.item_id,
  coalesce(soh.qty_on_hand, 0) as qty_on_hand,
  l.min_qty,
  l.max_qty,
  case
    when coalesce(soh.qty_on_hand, 0) < l.min_qty then 'REORDER NOW'
    when l.max_qty > 0 and coalesce(soh.qty_on_hand, 0) > l.max_qty then 'OVERSTOCK'
    else 'OK'
  end as reorder_status
from store_item_levels l
left join v_stock_on_hand soh
  on soh.tenant_id = l.tenant_id
 and soh.store_id  = l.store_id
 and soh.item_id   = l.item_id;
