-- 007_counts_and_reporting.sql
-- What Phase 3 needs: posted counts that cannot be edited, a food/beverage
-- classification that works for articles with no recipe, and the F&B cost
-- summary the dashboard reads.

-- ---------------------------------------------------------------------------
-- A posted count is evidence. It is not editable.
--
-- Rule 2 applies to counts exactly as it applies to the ledger: an unposted
-- document may be edited, a posted one may only be reversed. The count is the
-- only record of what was physically on the shelf that morning, so letting
-- someone quietly change a counted quantity afterwards would destroy the one
-- number the variance report is arguing from.
-- ---------------------------------------------------------------------------
create or replace function stock_count_lines_frozen_when_posted() returns trigger as $$
declare
  v_status text;
  v_count_id uuid;
begin
  v_count_id := coalesce(new.stock_count_id, old.stock_count_id);
  select status into v_status from stock_counts where id = v_count_id;

  if v_status = 'posted' then
    raise exception
      'stock count % is posted; its lines can no longer be % . Reverse the count instead.',
      v_count_id, lower(tg_op)
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger stock_count_lines_frozen_trg
  before update or delete on stock_count_lines
  for each row execute function stock_count_lines_frozen_when_posted();

-- A count may go draft -> posted -> reversed, and nowhere else.
create or replace function stock_counts_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status not in ('posted', 'reversed') then
    raise exception 'a posted stock count may only be reversed, not returned to %', new.status
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'a reversed stock count is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger stock_counts_status_forward_only_trg
  before update on stock_counts
  for each row execute function stock_counts_status_forward_only();

alter table stock_counts add column posted_by text;

-- ---------------------------------------------------------------------------
-- Food or beverage, for revenue.
--
-- Food and beverage are reported separately and never merged. menu_items
-- carries the answer, but only about 8 of 171 articles have a menu item — and
-- the other 163 still earned money that has to land on one side or the other.
--
-- The POS category is the only classification that covers every article, so it
-- is recorded per article at import time. It can be corrected per article
-- without touching anything else.
-- ---------------------------------------------------------------------------
alter table pos_item_map
  add column revenue_kind text not null default 'other'
  check (revenue_kind in ('food','beverage','other'));

-- One rule, used by both the seed and the importer, so they cannot drift.
create or replace function classify_revenue_kind(p_category text, p_sub text)
returns text as $$
  select case
    when upper(trim(coalesce(p_category,''))) = 'FOOD' then 'food'
    when upper(trim(coalesce(p_category,''))) = 'BEVERAGE' then 'beverage'
    -- CAFE MENU is mixed: the cakes are food, the coffee is not
    when upper(trim(coalesce(p_category,''))) = 'CAFE MENU'
         and upper(trim(coalesce(p_sub,''))) = 'CAKE' then 'food'
    when upper(trim(coalesce(p_category,''))) = 'CAFE MENU' then 'beverage'
    -- the free extras are all drinks; takeaway boxes are neither
    when upper(trim(coalesce(p_category,''))) = 'EXTRAS'
         and upper(trim(coalesce(p_sub,''))) = 'FREE EXTRA' then 'beverage'
    else 'other'
  end;
$$ language sql immutable;

update pos_item_map
   set revenue_kind = classify_revenue_kind(pos_category, pos_sub_category);

-- ---------------------------------------------------------------------------
-- Food cost % and beverage cost %, per import.
--
-- The honest denominator is COSTED revenue, not all revenue. Dividing the cost
-- of the dishes we can explode by the revenue of every dish including the ones
-- we cannot would understate the cost percentage by whatever coverage is
-- missing — which today is most of it. Both figures are returned so the screen
-- can show the base it is dividing by.
-- ---------------------------------------------------------------------------
create view v_fb_cost_summary as
with revenue as (
  select
    sl.tenant_id,
    sl.sales_import_id,
    coalesce(mi.kind, p.revenue_kind, 'other') as kind,
    sum(sl.total_amount) filter (where coalesce(p.counts_as_sale, true)) as revenue_all,
    sum(sl.total_amount) filter (where coalesce(p.counts_as_sale, true) and sl.depleted)
      as revenue_costed,
    sum(sl.qty) as qty
  from sales_lines sl
  left join pos_item_map p on p.id = sl.pos_item_map_id
  left join menu_items mi on mi.id = sl.menu_item_id
  group by sl.tenant_id, sl.sales_import_id, coalesce(mi.kind, p.revenue_kind, 'other')
),
cost as (
  select
    sl.tenant_id,
    sl.sales_import_id,
    coalesce(mi.kind, p.revenue_kind, 'other') as kind,
    -sum(m.value_delta) as cost_of_sales
  from stock_movements m
  join sales_lines sl on sl.id = m.source_doc_line
  left join pos_item_map p on p.id = sl.pos_item_map_id
  left join menu_items mi on mi.id = sl.menu_item_id
  where m.source_doc_type = 'sales_import'
    and m.movement_type = 'sale_depletion'
  group by sl.tenant_id, sl.sales_import_id, coalesce(mi.kind, p.revenue_kind, 'other')
)
select
  r.tenant_id,
  r.sales_import_id,
  r.kind,
  coalesce(r.revenue_all, 0)                          as revenue_all,
  coalesce(r.revenue_costed, 0)                       as revenue_costed,
  coalesce(c.cost_of_sales, 0)                        as cost_of_sales,
  case
    when coalesce(r.revenue_costed, 0) = 0 then null
    else round(coalesce(c.cost_of_sales, 0) / r.revenue_costed * 100, 2)
  end                                                 as cost_pct_of_costed,
  case
    when coalesce(r.revenue_all, 0) = 0 then null
    else round(coalesce(r.revenue_costed, 0) / r.revenue_all * 100, 2)
  end                                                 as coverage_pct,
  coalesce(r.revenue_costed, 0) - coalesce(c.cost_of_sales, 0) as gross_profit
from revenue r
left join cost c
  on  c.sales_import_id = r.sales_import_id
  and c.kind = r.kind;
