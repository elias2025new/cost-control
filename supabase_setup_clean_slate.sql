-- =============================================================================
-- Prime Hospitality F&B Cost Control ERP — Clean-Slate Supabase Setup
-- =============================================================================
-- Target: Supabase PostgreSQL (SQL Editor)
-- Status: Clean Slate (Tenant, 4 Stores, 5 HMC Staff Accounts, 0 Sample Data)
-- Generated: 2026-10-17T16:48:49.523Z
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reset Schema & Permissions
-- -----------------------------------------------------------------------------
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON SCHEMA public TO postgres;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT USAGE, CREATE ON SCHEMA public TO anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE, CREATE ON SCHEMA public TO authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON SCHEMA public TO service_role;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Schema Migrations Ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- MIGRATION: 001_core.sql
-- =============================================================================
-- 001_core.sql
-- Tenancy, branches, stores, categories, items and versioned item costs.
--
-- Conventions used across every migration:
--   quantities  numeric(18,6)
--   money (ETB) numeric(18,2)
--   rates       numeric(6,4)
--   POS-sourced amounts  numeric(18,4)  -- see note in 004_sales.sql
--   every table carries tenant_id and every query is scoped by it.

-- gen_random_uuid() is in core Postgres from v13. No extensions are required
-- anywhere in this schema: the deployment target is undecided and may be a
-- laptop at the property.

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  currency    text not null default 'ETB',
  created_at  timestamptz not null default now()
);

create table branches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- A store is anywhere stock physically sits. The client's written spec asks for
-- separate kitchen and bar with inter-outlet transfers; the workbook merges
-- them. We follow the spec and keep them separate.
create table stores (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  branch_id   uuid not null references branches(id),
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('main','kitchen','bar')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- kind drives the food / beverage / other split, which is reported separately
-- and never merged.
create table item_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('food','beverage','other')),
  unique (tenant_id, code)
);

-- Items carry no cost column. Cost lives in item_cost_versions, effective-dated.
create table items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  name        text not null,
  category_id uuid not null references item_categories(id),
  uom         text not null,
  is_active   boolean not null default true,
  -- sample data pending the client's confirmation; surfaced in the UI
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Versioned standard costs.
--
-- This is design rule 3 and the main reason the client is buying software:
-- changing an ingredient cost today must not change last month's food cost
-- report. Ranges are [effective_from, effective_to) — from inclusive, to
-- exclusive. effective_to null means "still open".
-- ---------------------------------------------------------------------------
create table item_cost_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  item_id        uuid not null references items(id),
  standard_cost  numeric(18,2) not null check (standard_cost >= 0),
  effective_from date not null,
  effective_to   date,
  note           text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, item_id, effective_from),
  check (effective_to is null or effective_to > effective_from)
);

create index item_cost_versions_lookup
  on item_cost_versions (tenant_id, item_id, effective_from desc);

-- At most one open-ended version per item.
create unique index item_cost_versions_one_open
  on item_cost_versions (tenant_id, item_id)
  where effective_to is null;

-- Reject any insert or update that would overlap an existing range for the
-- same item. A trigger rather than an exclusion constraint, because exclusion
-- on a range needs btree_gist and we are not requiring contrib extensions.
create or replace function item_cost_versions_no_overlap() returns trigger as $$
declare
  clash record;
begin
  select icv.effective_from, icv.effective_to into clash
  from item_cost_versions icv
  where icv.tenant_id = new.tenant_id
    and icv.item_id   = new.item_id
    and icv.id       <> new.id
    and icv.effective_from < coalesce(new.effective_to, 'infinity'::date)
    and new.effective_from < coalesce(icv.effective_to, 'infinity'::date)
  limit 1;

  if found then
    raise exception
      'cost version [% , %) for item % overlaps existing [% , %)',
      new.effective_from, new.effective_to, new.item_id,
      clash.effective_from, clash.effective_to
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger item_cost_versions_no_overlap_trg
  before insert or update on item_cost_versions
  for each row execute function item_cost_versions_no_overlap();

-- Record a new standard cost. Closes the currently open version at the new
-- effective date and opens a new one. This is the only supported way to change
-- a cost: the old version is never edited, so historical reports do not move.
create or replace function set_item_cost(
  p_tenant   uuid,
  p_item     uuid,
  p_cost     numeric,
  p_from     date,
  p_note     text default null
) returns uuid as $$
declare
  v_id uuid;
begin
  update item_cost_versions
     set effective_to = p_from
   where tenant_id = p_tenant
     and item_id   = p_item
     and effective_to is null
     and effective_from < p_from;

  insert into item_cost_versions (tenant_id, item_id, standard_cost, effective_from, note)
  values (p_tenant, p_item, p_cost, p_from, p_note)
  returning id into v_id;

  return v_id;
end;
$$ language plpgsql;

-- The standard cost of an item on a given date, or null if none was in force.
create or replace function item_cost_on(
  p_tenant uuid,
  p_item   uuid,
  p_as_of  date
) returns numeric as $$
  select icv.standard_cost
    from item_cost_versions icv
   where icv.tenant_id = p_tenant
     and icv.item_id   = p_item
     and icv.effective_from <= p_as_of
     and (icv.effective_to is null or icv.effective_to > p_as_of)
   limit 1;
$$ language sql stable;

-- Min / max par levels are per store and item, not per item.
create table store_item_levels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  store_id   uuid not null references stores(id),
  item_id    uuid not null references items(id),
  min_qty    numeric(18,6) not null default 0 check (min_qty >= 0),
  max_qty    numeric(18,6) not null default 0 check (max_qty >= 0),
  unique (tenant_id, store_id, item_id),
  check (max_qty = 0 or max_qty >= min_qty)
);

INSERT INTO schema_migrations (filename) VALUES ('001_core.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 002_menu_and_recipes.sql
-- =============================================================================
-- 002_menu_and_recipes.sql
-- Menu items, the POS article map, and the recipe tree.

create table menu_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  name        text not null,
  -- food / beverage / other are reported separately and never merged
  kind        text not null check (kind in ('food','beverage','other')),
  uom         text not null default 'Portion',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- POS article map.
--
-- article_code is TEXT and is the only stable key. Some real codes carry no
-- 'P-' prefix ('00081', '00040', '00039') and their leading zeros must
-- survive. Article NAMES are not keys: the client's own export contains
-- 'MOJITO' and ' MOJITO' as two different articles at two different prices,
-- and 'SPECIAL TEA' likewise.
--
-- article_flag records why an article may not be costable:
--   normal    -- an ordinary sellable article
--   generic   -- names no specific product, so no recipe can exist
--               (SOFT DRINK 1,803 units, BEER 379, SEASONAL FRESH JUICE 44)
--   test      -- test articles live in production, priced around 0.1 birr
--   free_comp -- consumes real stock with no revenue
--
-- depletes / counts_as_sale carry the free-article rule declaratively:
-- a FREE WATER must move stock but must not appear in sales.
-- ---------------------------------------------------------------------------
create table pos_item_map (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  source             text not null default 'CNET',
  article_code       text not null,
  article_name_seen  text,
  pos_category       text,
  pos_sub_category   text,
  menu_item_id       uuid references menu_items(id),
  article_flag       text not null default 'normal'
                     check (article_flag in ('normal','generic','test','free_comp')),
  depletes           boolean not null default true,
  counts_as_sale     boolean not null default true,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, source, article_code)
);

-- A generic article names no specific product, so it must never carry a menu
-- item. This is enforced rather than merely documented.
alter table pos_item_map
  add constraint pos_item_map_generic_unmappable
  check (article_flag <> 'generic' or menu_item_id is null);

-- ---------------------------------------------------------------------------
-- Which store does a POS category deplete from?
--
-- The client's export carries NO outlet dimension: nothing on a sales row says
-- whether it came from the bar or the kitchen. Category is the only proxy
-- available, so the mapping has to be data, not code — when the client answers
-- the question, it is a row change and nothing is rebuilt.
--
-- Rows with a null sub-category are the category-wide default; a row naming a
-- sub-category wins over it.
--
-- is_assumed marks a mapping we chose ourselves. Every assumed row is shown to
-- the client as an open question rather than presented as fact.
-- ---------------------------------------------------------------------------
create table pos_category_store_map (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  branch_id        uuid not null references branches(id),
  source           text not null default 'CNET',
  pos_category     text not null,
  pos_sub_category text,
  store_id         uuid not null references stores(id),
  is_assumed       boolean not null default true,
  note             text
);

-- One default per category and one override per sub-category.
create unique index pos_category_store_map_cat
  on pos_category_store_map (tenant_id, branch_id, source, pos_category)
  where pos_sub_category is null;

create unique index pos_category_store_map_sub
  on pos_category_store_map (tenant_id, branch_id, source, pos_category, pos_sub_category)
  where pos_sub_category is not null;

-- Most specific wins: an exact sub-category match, otherwise the category default.
create or replace function resolve_pos_store(
  p_tenant   uuid,
  p_branch   uuid,
  p_source   text,
  p_category text,
  p_sub      text
) returns uuid as $$
  select m.store_id
    from pos_category_store_map m
   where m.tenant_id = p_tenant
     and m.branch_id = p_branch
     and m.source    = p_source
     and m.pos_category = p_category
     and (m.pos_sub_category is null or m.pos_sub_category = p_sub)
   order by (m.pos_sub_category is not null) desc
   limit 1;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- Recipes are a tree, not a flat list.
--
-- A recipe belongs to either a menu item ("menu") or a sub-recipe product
-- ("sub"). A sub-recipe is costed once over a batch and pulled into its parent
-- as a single line at cost per unit — the burger bun in the workbook.
--
-- recipes  is the stable identity of a recipe.
-- recipe_versions carries the effective dating: changing a recipe today must
--          not change last month's report, exactly as with costs.
-- recipe_lines hang off a version and reference EITHER an item OR another
--          recipe, never both and never neither.
-- ---------------------------------------------------------------------------
create table recipes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  code            text not null,
  name            text not null,
  kind            text not null check (kind in ('menu','sub')),
  menu_item_id    uuid references menu_items(id),
  -- sub-recipes only: the batch produces this many of this unit
  batch_yield_qty numeric(18,6) check (batch_yield_qty is null or batch_yield_qty > 0),
  batch_yield_uom text,
  -- ingredient quantities are our best guess until the client confirms them
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (tenant_id, code),

  -- a menu recipe names a menu item and yields one portion
  check (kind <> 'menu' or (menu_item_id is not null
                            and batch_yield_qty is null
                            and batch_yield_uom is null)),
  -- a sub-recipe names no menu item and must declare its batch yield
  check (kind <> 'sub'  or (menu_item_id is null
                            and batch_yield_qty is not null
                            and batch_yield_uom is not null))
);

-- One recipe per menu item.
create unique index recipes_one_per_menu_item
  on recipes (tenant_id, menu_item_id)
  where menu_item_id is not null;

create table recipe_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  recipe_id      uuid not null references recipes(id),
  version_no     integer not null,
  effective_from date not null,
  effective_to   date,
  note           text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, recipe_id, version_no),
  unique (tenant_id, recipe_id, effective_from),
  check (effective_to is null or effective_to > effective_from)
);

create unique index recipe_versions_one_open
  on recipe_versions (tenant_id, recipe_id)
  where effective_to is null;

create or replace function recipe_versions_no_overlap() returns trigger as $$
declare
  clash record;
begin
  select rv.effective_from, rv.effective_to into clash
  from recipe_versions rv
  where rv.tenant_id = new.tenant_id
    and rv.recipe_id = new.recipe_id
    and rv.id       <> new.id
    and rv.effective_from < coalesce(new.effective_to, 'infinity'::date)
    and new.effective_from < coalesce(rv.effective_to, 'infinity'::date)
  limit 1;

  if found then
    raise exception
      'recipe version [% , %) for recipe % overlaps existing [% , %)',
      new.effective_from, new.effective_to, new.recipe_id,
      clash.effective_from, clash.effective_to
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger recipe_versions_no_overlap_trg
  before insert or update on recipe_versions
  for each row execute function recipe_versions_no_overlap();

create table recipe_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  recipe_version_id   uuid not null references recipe_versions(id) on delete cascade,
  line_no             integer not null,
  -- exactly one of these two
  component_item_id   uuid references items(id),
  component_recipe_id uuid references recipes(id),
  qty                 numeric(18,6) not null check (qty > 0),
  note                text,
  unique (tenant_id, recipe_version_id, line_no),
  check ( (component_item_id is not null) <> (component_recipe_id is not null) )
);

create index recipe_lines_by_version on recipe_lines (recipe_version_id);

-- A recipe line carries no UOM of its own. The unit is always the component's
-- own unit: an item line is in the item's uom, a sub-recipe line is in that
-- sub-recipe's batch_yield_uom. There is nowhere for the two to disagree.

-- A recipe may not reference itself directly. Deeper cycles are caught by the
-- explosion walk, which tracks the path it took and raises on a revisit.
create or replace function recipe_lines_no_self_reference() returns trigger as $$
declare
  v_owner uuid;
begin
  if new.component_recipe_id is null then
    return new;
  end if;

  select rv.recipe_id into v_owner
    from recipe_versions rv
   where rv.id = new.recipe_version_id;

  if v_owner = new.component_recipe_id then
    raise exception 'recipe % may not reference itself', v_owner
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger recipe_lines_no_self_reference_trg
  before insert or update on recipe_lines
  for each row execute function recipe_lines_no_self_reference();

-- The recipe version in force for a recipe on a given date.
create or replace function recipe_version_on(
  p_tenant uuid,
  p_recipe uuid,
  p_as_of  date
) returns uuid as $$
  select rv.id
    from recipe_versions rv
   where rv.tenant_id = p_tenant
     and rv.recipe_id = p_recipe
     and rv.effective_from <= p_as_of
     and (rv.effective_to is null or rv.effective_to > p_as_of)
   limit 1;
$$ language sql stable;

INSERT INTO schema_migrations (filename) VALUES ('002_menu_and_recipes.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 003_stock.sql
-- =============================================================================
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

INSERT INTO schema_migrations (filename) VALUES ('003_stock.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 004_sales.sql
-- =============================================================================
-- 004_sales.sql
-- Sales imports from the POS, and the lines they carry.

-- ---------------------------------------------------------------------------
-- A NOTE ON MONEY PRECISION, because this departs from the stated rule.
--
-- Design rule 4 says money is numeric(18,2). Every figure this system
-- CALCULATES obeys that. But the client's own CNET export does not: article
-- amounts carry three decimals (227.743, 683.229, 4484.587) and the footer
-- Sub Total is 8,928,373.056. Stored at two decimals the sum would no longer
-- reproduce that footer, and an import that does not reconcile does not post —
-- so the import would refuse every real file the client has.
--
-- POS-sourced amounts are therefore held at numeric(18,4): wide enough to keep
-- the source data exactly as issued, still fixed-point, still never a float.
-- Anything we derive ourselves — costs, values, the ledger — stays at (18,2).
-- ---------------------------------------------------------------------------

create table sales_imports (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  branch_id     uuid not null references branches(id),
  source        text not null default 'CNET',

  -- The real export is run over a date range, not a single day: the client's
  -- file covers 08/07/2026 to 03/08/2026. A single business day is simply the
  -- case where period_start = period_end.
  period_start  date not null,
  period_end    date not null,
  -- the date depletion is posted on
  business_date date not null,

  filename      text,
  file_sha256   text,
  uploaded_at   timestamptz not null default now(),

  status        text not null default 'draft'
                check (status in ('draft','validated','posted','rejected','reversed')),

  -- as printed in the file's own footer
  declared_sub_total   numeric(18,4),
  declared_add_charge  numeric(18,4),
  declared_discount    numeric(18,4),
  declared_tax         numeric(18,4),
  declared_grand_total numeric(18,4),

  -- as summed from the parsed lines
  computed_sub_total   numeric(18,4),
  computed_qty         numeric(18,6),

  reconciled    boolean not null default false,
  posted_at     timestamptz,
  reversed_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),

  check (period_end >= period_start)
);

-- The same period cannot post twice for a branch and source. Restricted to
-- posted rows so that a rejected file can be corrected and re-uploaded.
create unique index sales_imports_one_posting_per_period
  on sales_imports (tenant_id, branch_id, source, period_start, period_end)
  where status = 'posted';

-- Catches re-uploading byte-identical files; surfaced as a validation warning.
create index sales_imports_by_hash on sales_imports (tenant_id, file_sha256);

create table sales_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  sales_import_id  uuid not null references sales_imports(id) on delete cascade,
  line_no          integer not null,

  -- exactly as they appear in the file
  pos_category     text,
  pos_sub_category text,
  article_code     text not null,   -- TEXT. '00081' keeps its leading zeros.
  article_name     text,            -- kept verbatim, whitespace and all

  qty              numeric(18,6) not null,
  avg_amount       numeric(18,4),
  total_amount     numeric(18,4) not null,

  -- resolved at validation time
  pos_item_map_id  uuid references pos_item_map(id),
  menu_item_id     uuid references menu_items(id),
  resolved_store_id uuid references stores(id),

  -- Set at posting time.
  --
  -- Revenue always posts: every sales line is recorded whether or not a recipe
  -- exists for it. Depletion is the part that needs a recipe, and it happens
  -- only for lines that have one active on the business date. A line without
  -- one is recorded and flagged here — never rejected. There will be a handful
  -- of recipes against 171 articles for a long time, and recipes get written
  -- gradually over weeks after go-live.
  depleted         boolean not null default false,
  uncosted_reason  text,

  unique (tenant_id, sales_import_id, line_no)
);

create index sales_lines_by_import on sales_lines (sales_import_id);
create index sales_lines_by_article on sales_lines (tenant_id, article_code);

-- ---------------------------------------------------------------------------
-- Problems found while validating or posting an import. Nothing is silently
-- skipped: a generic article that cannot be costed is reported with its
-- quantity so the client can see the size of what is unmeasurable.
--
-- Severity 'block' prevents posting, and only STRUCTURAL problems earn it:
--
--   reconciliation   the lines do not sum to the file's own footer subtotal
--   duplicate_period this branch and period is already posted
--   parse            the file could not be read
--
-- Everything to do with coverage — an unmapped article, a generic article, a
-- mapped article with no recipe yet — is a 'warn'. Those are the normal state
-- of the world, not a reason to refuse a day's sales.
-- ---------------------------------------------------------------------------
create table sales_import_issues (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  sales_import_id uuid not null references sales_imports(id) on delete cascade,
  sales_line_id   uuid references sales_lines(id) on delete cascade,
  severity        text not null check (severity in ('block','warn','info')),
  kind            text not null,   -- blocking:  'reconciliation', 'duplicate_period', 'parse'
                                   -- warning:   'unmapped', 'generic', 'test', 'free_comp',
                                   --            'no_active_recipe', 'no_store_mapping',
                                   --            'duplicate_file'
  article_code    text,
  message         text not null,
  qty             numeric(18,6),
  amount          numeric(18,4),
  created_at      timestamptz not null default now()
);

create index sales_import_issues_by_import
  on sales_import_issues (sales_import_id, severity);

-- ---------------------------------------------------------------------------
-- Sales as the business reads them.
--
-- A free / comp article consumes stock but is not revenue, so it is excluded
-- here while still being depleted by postSalesImport. Test articles are
-- excluded too — they are noise priced at 0.1 birr.
-- ---------------------------------------------------------------------------
create view v_sales_lines_enriched as
select
  sl.tenant_id,
  sl.sales_import_id,
  si.branch_id,
  si.business_date,
  si.status as import_status,
  sl.id as sales_line_id,
  sl.article_code,
  sl.article_name,
  sl.pos_category,
  sl.pos_sub_category,
  sl.qty,
  sl.total_amount,
  pim.article_flag,
  pim.depletes,
  pim.counts_as_sale,
  mi.id   as menu_item_id,
  mi.name as menu_item_name,
  mi.kind as menu_kind,
  sl.resolved_store_id,
  sl.depleted,
  sl.uncosted_reason
from sales_lines sl
join sales_imports si on si.id = sl.sales_import_id
left join pos_item_map pim on pim.id = sl.pos_item_map_id
left join menu_items  mi  on mi.id = sl.menu_item_id;

-- ---------------------------------------------------------------------------
-- Cost coverage.
--
-- How much of a day's revenue the system could actually cost. With a handful
-- of recipes written against 171 articles this starts low and climbs as the
-- controller writes recipes — which makes it the single most honest number to
-- show the client, and the one that tells him what his own effort buys.
--
-- Free and comp articles are excluded from revenue: they consume stock at no
-- revenue and would otherwise drag the percentage around for no reason.
-- ---------------------------------------------------------------------------
create view v_import_cost_coverage as
select
  sl.tenant_id,
  sl.sales_import_id,
  count(*)                                                       as line_count,
  count(*) filter (where sl.depleted)                            as costed_line_count,
  sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true))
                                                                 as revenue_total,
  coalesce(sum(sl.total_amount)
    filter (where sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
                                                                 as revenue_costed,
  coalesce(sum(sl.total_amount)
    filter (where not sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
                                                                 as revenue_uncosted,
  case
    when coalesce(sum(sl.total_amount)
           filter (where coalesce(pim.counts_as_sale, true)), 0) = 0 then null
    else round(
      coalesce(sum(sl.total_amount)
        filter (where sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
      / sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true))
      * 100, 2)
  end                                                            as revenue_costed_pct
from sales_lines sl
left join pos_item_map pim on pim.id = sl.pos_item_map_id
group by sl.tenant_id, sl.sales_import_id;

INSERT INTO schema_migrations (filename) VALUES ('004_sales.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 005_counts.sql
-- =============================================================================
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

INSERT INTO schema_migrations (filename) VALUES ('005_counts.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 006_recipe_costing.sql
-- =============================================================================
-- 006_recipe_costing.sql
-- Recursive recipe explosion and cost roll-up.
--
-- This is the SQL twin of costRecipe() in src/domain/costRecipe.ts. Reports
-- read the SQL; the application reads the TypeScript; a test asserts the two
-- agree to the last birr on every seeded recipe. Two implementations that must
-- match is a cheap and very effective check on the arithmetic.

-- A recipe line may only pull in a sub-recipe. Referencing another menu
-- recipe has no defined yield and no meaning.
create or replace function recipe_lines_component_must_be_sub() returns trigger as $$
declare
  v_kind text;
begin
  if new.component_recipe_id is null then
    return new;
  end if;

  select kind into v_kind from recipes where id = new.component_recipe_id;

  if v_kind <> 'sub' then
    raise exception
      'recipe line may only reference a sub-recipe; recipe % is of kind %',
      new.component_recipe_id, v_kind
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger recipe_lines_component_must_be_sub_trg
  before insert or update on recipe_lines
  for each row execute function recipe_lines_component_must_be_sub();

-- ---------------------------------------------------------------------------
-- recipe_walk
--
-- Walks the tree from a recipe down through its sub-recipes, carrying the
-- multiplier that converts one portion of the root into a quantity of each
-- node's batch.
--
-- A sub-recipe line asking for Q of a sub-recipe whose batch yields Y units
-- consumes Q/Y of that batch, so the multiplier compounds as mult * qty / yield.
--
-- The path taken is carried so a cycle is detected rather than followed, and
-- depth is capped. Both are reported back rather than silently swallowed.
-- ---------------------------------------------------------------------------
create or replace function recipe_walk(
  p_tenant     uuid,
  p_recipe     uuid,
  p_as_of      date,
  p_multiplier numeric default 1
) returns table (
  recipe_id  uuid,
  version_id uuid,
  mult       numeric,
  depth      integer,
  path       uuid[],
  is_cycle   boolean
) as $$
  with recursive walk as (
    select
      p_recipe                                            as recipe_id,
      recipe_version_on(p_tenant, p_recipe, p_as_of)      as version_id,
      p_multiplier                                        as mult,
      0                                                   as depth,
      array[p_recipe]                                     as path,
      false                                               as is_cycle

    union all

    select
      rl.component_recipe_id,
      recipe_version_on(p_tenant, rl.component_recipe_id, p_as_of),
      w.mult * rl.qty / r.batch_yield_qty,
      w.depth + 1,
      w.path || rl.component_recipe_id,
      rl.component_recipe_id = any(w.path)
    from walk w
    join recipe_lines rl
      on rl.recipe_version_id = w.version_id
     and rl.tenant_id = p_tenant
     and rl.component_recipe_id is not null
    join recipes r
      on r.id = rl.component_recipe_id
    -- do not follow a cycle, and never past the depth cap
    where not w.is_cycle
      and w.depth < 10
      and w.version_id is not null
  )
  select recipe_id, version_id, mult, depth, path, is_cycle from walk;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- recipe_explode
--
-- One portion of a recipe reduced to raw items only. Sub-recipes disappear:
-- what comes back is what actually leaves the shelf. An ingredient reached by
-- two different branches of the tree is returned once, summed.
--
-- Raises rather than returning a wrong answer when the tree cannot be walked.
-- ---------------------------------------------------------------------------
create or replace function recipe_explode(
  p_tenant     uuid,
  p_recipe     uuid,
  p_as_of      date,
  p_multiplier numeric default 1
) returns table (
  item_id uuid,
  qty     numeric
) as $$
declare
  v_bad record;
begin
  -- a cycle in the tree
  select w.recipe_id, w.path into v_bad
  from recipe_walk(p_tenant, p_recipe, p_as_of, p_multiplier) w
  where w.is_cycle
  limit 1;

  if found then
    raise exception 'recipe tree contains a cycle at recipe % (path %)',
      v_bad.recipe_id, v_bad.path
      using errcode = 'check_violation';
  end if;

  -- a node with no recipe version in force on this date
  select w.recipe_id into v_bad
  from recipe_walk(p_tenant, p_recipe, p_as_of, p_multiplier) w
  where w.version_id is null
  limit 1;

  if found then
    raise exception 'recipe % has no active version on %',
      v_bad.recipe_id, p_as_of
      using errcode = 'no_data_found';
  end if;

  -- the depth cap was hit while sub-recipes were still unexpanded
  select w.recipe_id into v_bad
  from recipe_walk(p_tenant, p_recipe, p_as_of, p_multiplier) w
  join recipe_lines rl
    on rl.recipe_version_id = w.version_id
   and rl.component_recipe_id is not null
  where w.depth >= 10
  limit 1;

  if found then
    raise exception 'recipe tree deeper than the 10 level cap at recipe %',
      v_bad.recipe_id
      using errcode = 'program_limit_exceeded';
  end if;

  return query
  select rl.component_item_id, sum(w.mult * rl.qty)::numeric
  from recipe_walk(p_tenant, p_recipe, p_as_of, p_multiplier) w
  join recipe_lines rl
    on rl.recipe_version_id = w.version_id
   and rl.tenant_id = p_tenant
   and rl.component_item_id is not null
  group by rl.component_item_id;
end;
$$ language plpgsql stable;

-- ---------------------------------------------------------------------------
-- recipe_cost_breakdown
--
-- The exploded raw items priced at the cost version in force on the date.
-- An item with no cost version on that date comes back with a null cost and
-- is_costed false, so a missing cost can never be silently read as zero.
-- ---------------------------------------------------------------------------
create or replace function recipe_cost_breakdown(
  p_tenant uuid,
  p_recipe uuid,
  p_as_of  date
) returns table (
  item_id    uuid,
  item_code  text,
  item_name  text,
  uom        text,
  qty        numeric,
  unit_cost  numeric,
  line_cost  numeric,
  is_costed  boolean
) as $$
  select
    e.item_id,
    i.code,
    i.name,
    i.uom,
    round(e.qty, 6),
    item_cost_on(p_tenant, e.item_id, p_as_of),
    round(e.qty * item_cost_on(p_tenant, e.item_id, p_as_of), 2),
    item_cost_on(p_tenant, e.item_id, p_as_of) is not null
  from recipe_explode(p_tenant, p_recipe, p_as_of, 1) e
  join items i on i.id = e.item_id
  order by i.code;
$$ language sql stable;

-- Cost of one portion. Null if any ingredient has no cost on that date —
-- a partial cost is worse than no cost, because it looks like an answer.
create or replace function recipe_cost(
  p_tenant uuid,
  p_recipe uuid,
  p_as_of  date
) returns numeric as $$
  select case
           when bool_and(b.is_costed) then round(sum(b.line_cost), 2)
           else null
         end
  from recipe_cost_breakdown(p_tenant, p_recipe, p_as_of) b;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- Recipe cost as at today, for screens that do not care about history.
-- ---------------------------------------------------------------------------
create view v_recipe_cost_today as
select
  r.tenant_id,
  r.id   as recipe_id,
  r.code as recipe_code,
  r.name as recipe_name,
  r.kind,
  r.is_sample,
  r.menu_item_id,
  mi.name as menu_item_name,
  mi.kind as menu_kind,
  recipe_cost(r.tenant_id, r.id, current_date) as cost_per_portion
from recipes r
left join menu_items mi on mi.id = r.menu_item_id;

-- ---------------------------------------------------------------------------
-- Theoretical consumption: what the recipes say should have been used over a
-- period, against what the store actually issued. This is the variance check
-- that catches recipe drift and over-portioning, and it is a different
-- question from the physical count in 005.
-- ---------------------------------------------------------------------------
create view v_theoretical_consumption as
with theoretical as (
  select
    m.tenant_id,
    m.store_id,
    m.item_id,
    m.occurred_on,
    -sum(m.qty_delta) as theoretical_qty
  from stock_movements m
  where m.movement_type = 'sale_depletion'
  group by m.tenant_id, m.store_id, m.item_id, m.occurred_on
),
issued as (
  select
    m.tenant_id,
    m.store_id,
    m.item_id,
    m.occurred_on,
    sum(m.qty_delta) as issued_qty
  from stock_movements m
  where m.movement_type = 'issue_in'
  group by m.tenant_id, m.store_id, m.item_id, m.occurred_on
)
select
  coalesce(t.tenant_id, s.tenant_id)   as tenant_id,
  coalesce(t.store_id,  s.store_id)    as store_id,
  coalesce(t.item_id,   s.item_id)     as item_id,
  coalesce(t.occurred_on, s.occurred_on) as occurred_on,
  coalesce(t.theoretical_qty, 0)       as theoretical_qty,
  coalesce(s.issued_qty, 0)            as issued_qty,
  coalesce(s.issued_qty, 0) - coalesce(t.theoretical_qty, 0) as variance_qty,
  case
    when coalesce(t.theoretical_qty, 0) = 0 then null
    else round(abs(coalesce(s.issued_qty,0) - t.theoretical_qty) / abs(t.theoretical_qty), 6)
  end as variance_ratio,
  case
    when coalesce(t.theoretical_qty, 0) = 0 then 'INVESTIGATE'
    when abs(coalesce(s.issued_qty,0) - t.theoretical_qty) / abs(t.theoretical_qty) <= 0.03 then 'OK'
    when abs(coalesce(s.issued_qty,0) - t.theoretical_qty) / abs(t.theoretical_qty) <= 0.08 then 'REVIEW'
    else 'INVESTIGATE'
  end as variance_status
from theoretical t
full outer join issued s
  on  s.tenant_id = t.tenant_id
  and s.store_id  = t.store_id
  and s.item_id   = t.item_id
  and s.occurred_on = t.occurred_on;

INSERT INTO schema_migrations (filename) VALUES ('006_recipe_costing.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 007_counts_and_reporting.sql
-- =============================================================================
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

INSERT INTO schema_migrations (filename) VALUES ('007_counts_and_reporting.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 008_auth.sql
-- =============================================================================
-- 008_auth.sql
-- Users and roles.
--
-- Two roles: 'admin' (full access, no store scope) and 'store_user' (scoped
-- to exactly one store — main, kitchen, or bar, per that store's own kind
-- column; the role does not duplicate stores.kind into a second enum).
--
-- No hard delete anywhere in this app's UI for users: once an account has
-- acted (an issue request, a count) it is FK-referenced almost immediately,
-- so deactivate (is_active) is the only path offered.

create table users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  username      text not null,
  password_hash text not null,
  display_name  text not null,
  role          text not null check (role in ('admin', 'store_user')),
  store_id      uuid references stores(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, username),
  check (role = 'admin' or store_id is not null),
  check (role = 'store_user' or store_id is null)
);

INSERT INTO schema_migrations (filename) VALUES ('008_auth.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 009_issue_requests.sql
-- =============================================================================
-- 009_issue_requests.sql
-- Issue requests: an outlet (kitchen, bar) asks the main store for stock,
-- the main store releases it, and the ledger records the transfer.
--
-- The client's spec describes a fuller chain — three manager approvals, then
-- the requester separately approving and receiving. How many approval levels
-- are really wanted is an open question in the brief, so this models the two
-- ends that are certain (a request is made; stock is released and moves) and
-- the request screen shows the fuller chain inert, the same way every other
-- undecided approval workflow in this app is shown but not built.
--
-- Shaped after stock_counts / stock_count_lines: a header carrying a status,
-- lines carrying quantities, and a forward-only status trigger.

create table issue_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  requesting_store_id  uuid not null references stores(id),
  fulfilling_store_id  uuid not null references stores(id),
  status               text not null default 'requested'
                       check (status in ('requested', 'fulfilled', 'cancelled')),
  requested_by_user_id uuid references users(id),
  fulfilled_by_user_id uuid references users(id),
  requested_at         timestamptz not null default now(),
  fulfilled_at         timestamptz,
  note                 text,
  -- A store cannot issue to itself. Deliberately NOT constraining the
  -- fulfilling store to kind='main' here: the client's "Inter-Outlet
  -- Transfer" (bar to kitchen) is out of scope now but would reuse this
  -- shape, and an app-level rule can relax without a migration.
  check (requesting_store_id <> fulfilling_store_id)
);

create index issue_requests_by_store
  on issue_requests (tenant_id, requesting_store_id, status);

create table issue_request_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  issue_request_id uuid not null references issue_requests(id) on delete cascade,
  item_id          uuid not null references items(id),
  requested_qty    numeric(18,6) not null check (requested_qty > 0),
  fulfilled_qty    numeric(18,6) check (fulfilled_qty is null or fulfilled_qty >= 0),
  note             text,
  unique (tenant_id, issue_request_id, item_id)
);

create index issue_request_lines_by_request on issue_request_lines (issue_request_id);

-- Same forward-only discipline as stock_counts: once released or cancelled,
-- a request never returns to an earlier state.
create or replace function issue_requests_status_forward_only() returns trigger as $$
begin
  if old.status = 'fulfilled' and new.status <> 'fulfilled' then
    raise exception 'a fulfilled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger issue_requests_status_forward_only_trg
  before update on issue_requests
  for each row execute function issue_requests_status_forward_only();

-- The backstop against a double release, mirroring
-- stock_movements_sale_depletion_once. The domain function locks the header
-- and re-checks status, which should be enough — this index is what makes
-- "should be" unnecessary to trust.
create unique index stock_movements_issue_fulfillment_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'issue_request'
    and movement_type in ('issue_out', 'issue_in');

INSERT INTO schema_migrations (filename) VALUES ('009_issue_requests.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 010_purchases.sql
-- =============================================================================
-- 010_purchases.sql
-- Purchase Register: inbound deliveries from suppliers.

create table purchases (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  store_id         uuid not null references stores(id),
  supplier_name    text not null,
  reference_number text,
  status           text not null default 'draft'
                   check (status in ('draft', 'posted')),
  occurred_on      date not null,
  created_at       timestamptz not null default now(),
  created_by       text not null default 'system'
);

create index purchases_by_store on purchases (tenant_id, store_id, status);

create table purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  purchase_id  uuid not null references purchases(id) on delete cascade,
  item_id      uuid not null references items(id),
  qty          numeric(18,6) not null check (qty > 0),
  unit_cost    numeric(18,2) not null check (unit_cost >= 0),
  unique (tenant_id, purchase_id, item_id)
);

create index purchase_lines_by_purchase on purchase_lines (purchase_id);

-- Forward-only discipline: once posted, a purchase never returns to draft.
create or replace function purchases_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted purchase is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger purchases_status_forward_only_trg
  before update on purchases
  for each row execute function purchases_status_forward_only();

-- A backstop against double-posting a purchase line to the ledger.
create unique index stock_movements_purchase_receipt_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'purchase_receipt'
    and movement_type = 'receipt';

INSERT INTO schema_migrations (filename) VALUES ('010_purchases.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 011_transfers.sql
-- =============================================================================
-- 011_transfers.sql
-- Inter-store / inter-outlet stock transfers.
--
-- A transfer moves stock from one store to another at the current moving
-- weighted average cost of the SOURCE store. Two ledger rows are written
-- in the same transaction: transfer_out (negative qty_delta in the source)
-- and transfer_in (positive qty_delta in the destination).
--
-- Like purchases and issue requests, a transfer has a header + lines and
-- a forward-only status: draft → posted.

create table transfers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  from_store_id   uuid not null references stores(id),
  to_store_id     uuid not null references stores(id),
  status          text not null default 'draft'
                  check (status in ('draft', 'posted')),
  occurred_on     date not null,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      text not null default 'system',
  check (from_store_id <> to_store_id)
);

create index transfers_by_from_store on transfers (tenant_id, from_store_id, status);
create index transfers_by_to_store   on transfers (tenant_id, to_store_id,   status);

create table transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  transfer_id uuid not null references transfers(id) on delete cascade,
  item_id     uuid not null references items(id),
  qty         numeric(18,6) not null check (qty > 0),
  unique (tenant_id, transfer_id, item_id)
);

create index transfer_lines_by_transfer on transfer_lines (transfer_id);

-- Forward-only: once posted a transfer is final.
create or replace function transfers_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted transfer is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger transfers_status_forward_only_trg
  before update on transfers
  for each row execute function transfers_status_forward_only();

-- Prevent double-posting the same transfer line.
create unique index stock_movements_transfer_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'transfer'
    and movement_type in ('transfer_out', 'transfer_in');

INSERT INTO schema_migrations (filename) VALUES ('011_transfers.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 012_suppliers.sql
-- =============================================================================
-- 012_suppliers.sql
-- Supplier master list.
-- 
-- Before adding the supplier_id FK on purchases, we harvest any names already
-- stored there (from earlier free-text entries) so no data is lost.

create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,                       -- short reference code
  name        text not null,
  contact     text,                                -- contact person / phone
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, name)
);

create index suppliers_by_tenant on suppliers (tenant_id, is_active);

-- Harvest any free-text supplier names already in purchases so existing rows
-- survive the migration. Each unique name becomes one supplier record.
insert into suppliers (tenant_id, code, name)
select distinct
  p.tenant_id,
  -- code = upper-cased first 8 chars of name, stripped to alphanumeric
  upper(substring(regexp_replace(p.supplier_name, '[^a-zA-Z0-9]', '', 'g'), 1, 8)) as code,
  p.supplier_name as name
from purchases p
on conflict do nothing;

-- Add the FK column (nullable first so existing rows don't violate it).
alter table purchases add column supplier_id uuid references suppliers(id);

-- Wire up existing purchases to their newly-created supplier rows.
update purchases p
set    supplier_id = s.id
from   suppliers s
where  s.tenant_id = p.tenant_id
  and  s.name      = p.supplier_name;

-- Now make it mandatory, and drop the old free-text column.
alter table purchases alter column supplier_id set not null;
alter table purchases drop column supplier_name;

INSERT INTO schema_migrations (filename) VALUES ('012_suppliers.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 013_purchase_requests.sql
-- =============================================================================
-- 013_purchase_requests.sql
-- Purchase Requests: an outlet asks the main store/purchasing to buy an item from a supplier.

create table purchase_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  requesting_store_id  uuid not null references stores(id),
  status               text not null default 'draft'
                       check (status in ('draft', 'requested', 'resolved', 'cancelled')),
  requested_by_user_id uuid references users(id),
  requested_at         timestamptz not null default now(),
  note                 text
);

create index purchase_requests_by_store on purchase_requests (tenant_id, requesting_store_id, status);

create table purchase_request_lines (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  request_id         uuid not null references purchase_requests(id) on delete cascade,
  item_id            uuid not null references items(id),
  requested_qty      numeric(18,6) not null check (requested_qty > 0),
  note               text,
  unique (tenant_id, request_id, item_id)
);

create index purchase_request_lines_by_request on purchase_request_lines (request_id);

-- Forward-only discipline
create or replace function purchase_requests_status_forward_only() returns trigger as $$
begin
  if old.status = 'resolved' and new.status <> 'resolved' then
    raise exception 'a resolved purchase request is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled purchase request is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger purchase_requests_status_forward_only_trg
  before update on purchase_requests
  for each row execute function purchase_requests_status_forward_only();

INSERT INTO schema_migrations (filename) VALUES ('013_purchase_requests.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 014_purchase_returns.sql
-- =============================================================================
-- 014_purchase_returns.sql
-- Allow reversing a posted purchase receipt.

-- Drop the old constraint that only allowed 'draft' and 'posted'
alter table purchases drop constraint purchases_status_check;

-- Add the new constraint
alter table purchases add constraint purchases_status_check
  check (status in ('draft', 'posted', 'reversed'));

-- Update the forward-only trigger to allow posted -> reversed,
-- and make reversed a final terminal state.
create or replace function purchases_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status not in ('posted', 'reversed') then
    raise exception 'a posted purchase is final and can only be reversed'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'a reversed purchase is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

INSERT INTO schema_migrations (filename) VALUES ('014_purchase_returns.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 015_user_permissions.sql
-- =============================================================================
-- 015_user_permissions.sql
-- Add granular JSONB permissions to users table to support exact role customization

alter table users
  add column permissions jsonb not null default '[]'::jsonb;

INSERT INTO schema_migrations (filename) VALUES ('015_user_permissions.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 016_waste_logs.sql
-- =============================================================================
-- 016_waste_logs.sql
-- Waste & Leakage Logging: tracks kitchen burns, bar breakages, spoilage, comps, and staff meals.
-- Entered by kitchen/bar staff, approved by F&B Cost Controller before posting to the ledger.

create table waste_logs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  store_id            uuid not null references stores(id),
  occurred_on         date not null,
  status              text not null default 'draft'
                      check (status in ('draft', 'submitted', 'approved', 'rejected')),
  logged_by_user_id   uuid references users(id),
  approved_by_user_id uuid references users(id),
  approved_at         timestamptz,
  rejection_reason    text,
  note                text,
  created_at          timestamptz not null default now()
);

create index waste_logs_by_store on waste_logs (tenant_id, store_id, status);

create table waste_log_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  waste_log_id  uuid not null references waste_logs(id) on delete cascade,
  item_id       uuid not null references items(id),
  qty           numeric(18,6) not null check (qty > 0),
  reason        text not null check (reason in ('spoilage', 'burnt', 'spill', 'expired', 'comp', 'staff_meal')),
  unit_cost     numeric(18,2) check (unit_cost is null or unit_cost >= 0),
  total_cost    numeric(18,2) check (total_cost is null or total_cost >= 0),
  note          text,
  unique (tenant_id, waste_log_id, item_id, reason)
);

create index waste_log_lines_by_log on waste_log_lines (waste_log_id);

-- Forward-only discipline: once approved or rejected, a waste log is final.
create or replace function waste_logs_status_forward_only() returns trigger as $$
begin
  if old.status = 'approved' and new.status <> 'approved' then
    raise exception 'an approved waste log is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'a rejected waste log is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger waste_logs_status_forward_only_trg
  before update on waste_logs
  for each row execute function waste_logs_status_forward_only();

-- Backstop index against double-posting waste lines to stock_movements
create unique index stock_movements_waste_log_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'waste_log';

INSERT INTO schema_migrations (filename) VALUES ('016_waste_logs.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 017_request_approvals.sql
-- =============================================================================
-- 017_request_approvals.sql
-- Add Chef/Bar Manager pre-approval workflow to issue requests before storekeeper fulfillment.

alter table issue_requests drop constraint issue_requests_status_check;

alter table issue_requests add constraint issue_requests_status_check
  check (status in ('draft', 'requested', 'approved', 'fulfilled', 'cancelled'));

alter table issue_requests add column approved_by_user_id uuid references users(id);
alter table issue_requests add column approved_at timestamptz;

create or replace function issue_requests_status_forward_only() returns trigger as $$
begin
  if old.status = 'fulfilled' and new.status <> 'fulfilled' then
    raise exception 'a fulfilled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

INSERT INTO schema_migrations (filename) VALUES ('017_request_approvals.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 018_transfer_approvals.sql
-- =============================================================================
-- 018_transfer_approvals.sql
-- Add dispatch and acceptance stages to inter-outlet transfers.

alter table transfers drop constraint transfers_status_check;

alter table transfers add constraint transfers_status_check
  check (status in ('draft', 'dispatched', 'posted', 'cancelled'));

alter table transfers add column dispatched_by_user_id uuid references users(id);
alter table transfers add column dispatched_at timestamptz;
alter table transfers add column accepted_by_user_id uuid references users(id);
alter table transfers add column accepted_at timestamptz;

create or replace function transfers_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted transfer is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled transfer is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

INSERT INTO schema_migrations (filename) VALUES ('018_transfer_approvals.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 019_store_cost_centers_and_par.sql
-- =============================================================================
-- 019_store_cost_centers_and_par.sql
-- Expand stores to support hospitality cost centers, default fulfilling stores,
-- and rich par stock configuration.

-- 1. Relax kind check to allow modern restaurant cost center types
alter table stores drop constraint if exists stores_kind_check;
alter table stores add constraint stores_kind_check check (
  kind in ('main', 'kitchen', 'bar', 'cellar', 'prep', 'outlet')
);

-- 2. Add default fulfilling store and description
alter table stores
  add column if not exists default_fulfilling_store_id uuid references stores(id),
  add column if not exists description text;

-- 3. Avoid self-referencing fulfilling store
alter table stores drop constraint if exists stores_no_self_fulfill;
alter table stores add constraint stores_no_self_fulfill check (
  default_fulfilling_store_id is null or default_fulfilling_store_id <> id
);

INSERT INTO schema_migrations (filename) VALUES ('019_store_cost_centers_and_par.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 020_master_data_units_and_shrinkage.sql
-- =============================================================================
-- 020_master_data_units_and_shrinkage.sql
-- Phase 1: Re-engineering Materials Control Master Data & Dual Unit Conversion Engine
--
-- Replicates HMC's VPCKEINH (Packaging Units), PRODEINH (Production Units),
-- VPK_INHALT (Packaging Contents Factor), and ART_VERLUST (Shrinkage / Yield Loss).

-- 1. Standard Units of Measure Dictionary
create table if not exists units_of_measure (
  code           text primary key,
  name           text not null,
  dimension      text not null check (dimension in ('weight', 'volume', 'count', 'custom')),
  base_unit      text not null,
  to_base_factor numeric(18,8) not null check (to_base_factor > 0),
  created_at     timestamptz not null default now()
);

-- Seed universal units (metric, bar volume, counts)
insert into units_of_measure (code, name, dimension, base_unit, to_base_factor) values
  -- Weight (base = g)
  ('kg',      'Kilogram',     'weight', 'g', 1000.0),
  ('g',       'Gram',         'weight', 'g', 1.0),
  ('mg',      'Milligram',    'weight', 'g', 0.001),
  ('lb',      'Pound',        'weight', 'g', 453.59237),
  ('oz',      'Ounce',        'weight', 'g', 28.349523125),

  -- Volume (base = ml)
  ('l',       'Liter',        'volume', 'ml', 1000.0),
  ('ml',      'Milliliter',   'volume', 'ml', 1.0),
  ('cl',      'Centiliter',   'volume', 'ml', 10.0),
  ('dl',      'Deciliter',    'volume', 'ml', 100.0),
  ('fl_oz',   'Fluid Ounce',  'volume', 'ml', 29.5735),
  ('gal',     'Gallon (US)',  'volume', 'ml', 3785.41),

  -- Count (base = pc)
  ('pc',      'Piece',        'count',  'pc', 1.0),
  ('each',    'Each',         'count',  'pc', 1.0),
  ('portion', 'Portion',      'count',  'pc', 1.0),
  ('serving', 'Serving',      'count',  'pc', 1.0),
  ('can',     'Can',          'count',  'pc', 1.0),
  ('bottle',  'Bottle',       'count',  'pc', 1.0),
  ('dozen',   'Dozen',        'count',  'pc', 12.0),
  ('box',     'Box / Carton', 'count',  'pc', 1.0),
  ('crate',   'Crate',        'count',  'pc', 1.0),
  ('bag',     'Bag',          'count',  'pc', 1.0),
  ('keg',     'Keg',          'count',  'pc', 1.0)
on conflict (code) do update set
  name = excluded.name,
  dimension = excluded.dimension,
  base_unit = excluded.base_unit,
  to_base_factor = excluded.to_base_factor;

-- 2. Item-Specific Custom Unit Conversions (e.g. density, bottle volume, custom pack sizes)
create table if not exists item_unit_conversions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  item_id     uuid not null references items(id),
  from_uom    text not null,
  to_uom      text not null,
  factor      numeric(18,8) not null check (factor > 0),
  note        text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, item_id, from_uom, to_uom),
  check (from_uom <> to_uom)
);

create index if not exists idx_item_unit_conversions
  on item_unit_conversions (tenant_id, item_id, from_uom, to_uom);

-- 3. Enhance `items` table with HMC Master Data properties:
--    purchase_uom (VPCKEINH)
--    pack_factor (VPK_INHALT)
--    loss_percent (ART_VERLUST / shrinkage)
--    default_store_id (ART_LAGER)
--    abc_class (ART_ABC)
alter table items
  add column if not exists purchase_uom text,
  add column if not exists pack_factor numeric(18,6) not null default 1.0 check (pack_factor > 0),
  add column if not exists loss_percent numeric(5,2) not null default 0.0 check (loss_percent >= 0 and loss_percent < 100),
  add column if not exists default_store_id uuid references stores(id),
  add column if not exists abc_class text check (abc_class in ('A', 'B', 'C')),
  add column if not exists barcode text;

-- Default purchase_uom to item uom if not specified
update items set purchase_uom = uom where purchase_uom is null;

-- 4. Store-specific shrinkage overrides (e.g. kitchen butchery has higher loss than central warehouse)
alter table store_item_levels
  add column if not exists loss_percent numeric(5,2) check (loss_percent is null or (loss_percent >= 0 and loss_percent < 100));

-- 5. Materials Control SQL functions for unit conversions, usable quantity, and effective cost:

-- A. Usable Net Quantity given gross quantity and loss/shrinkage percent
create or replace function item_usable_qty(
  p_gross_qty    numeric,
  p_loss_percent numeric
) returns numeric as $$
  select round(p_gross_qty * (1.0 - (coalesce(p_loss_percent, 0.0) / 100.0)), 6);
$$ language sql immutable;

-- B. Effective Usable Cost per Unit given standard purchase cost and loss percent
--    e.g. 500 ETB/kg with 20% loss = 500 / 0.80 = 625 ETB/kg
create or replace function item_effective_cost(
  p_standard_cost numeric,
  p_loss_percent  numeric
) returns numeric as $$
  select case 
    when coalesce(p_loss_percent, 0.0) >= 100.0 then 0.0
    else round(p_standard_cost / (1.0 - (coalesce(p_loss_percent, 0.0) / 100.0)), 2)
  end;
$$ language sql immutable;

-- C. Universal Unit Conversion Function
create or replace function convert_item_uom(
  p_tenant  uuid,
  p_item    uuid,
  p_qty     numeric,
  p_from    text,
  p_to      text
) returns numeric as $$
declare
  v_from_norm text := lower(trim(p_from));
  v_to_norm   text := lower(trim(p_to));
  v_from_uom  units_of_measure%rowtype;
  v_to_uom    units_of_measure%rowtype;
  v_custom    numeric;
  v_pack_fac  numeric;
  v_item_uom  text;
  v_purch_uom text;
begin
  -- 1. Identity
  if v_from_norm = v_to_norm then
    return p_qty;
  end if;

  -- 2. Item-specific custom conversion table (exact match from -> to)
  select factor into v_custom
    from item_unit_conversions
   where tenant_id = p_tenant
     and item_id   = p_item
     and lower(from_uom) = v_from_norm
     and lower(to_uom)   = v_to_norm
   limit 1;

  if found then
    return round(p_qty * v_custom, 6);
  end if;

  -- Inverse item-specific conversion (to -> from)
  select factor into v_custom
    from item_unit_conversions
   where tenant_id = p_tenant
     and item_id   = p_item
     and lower(from_uom) = v_to_norm
     and lower(to_uom)   = v_from_norm
   limit 1;

  if found and v_custom > 0 then
    return round(p_qty / v_custom, 6);
  end if;

  -- 3. Check item purchase_uom vs recipe/inventory uom via pack_factor
  select lower(uom), lower(coalesce(purchase_uom, uom)), pack_factor
    into v_item_uom, v_purch_uom, v_pack_fac
    from items
   where tenant_id = p_tenant and id = p_item;

  if v_from_norm = v_purch_uom and v_to_norm = v_item_uom then
    return round(p_qty * v_pack_fac, 6);
  end if;

  if v_from_norm = v_item_uom and v_to_norm = v_purch_uom and v_pack_fac > 0 then
    return round(p_qty / v_pack_fac, 6);
  end if;

  -- 4. Universal dimension conversion (weight <-> weight, volume <-> volume, count <-> count)
  select * into v_from_uom from units_of_measure where lower(code) = v_from_norm;
  select * into v_to_uom   from units_of_measure where lower(code) = v_to_norm;

  if v_from_uom.code is not null and v_to_uom.code is not null then
    if v_from_uom.dimension = v_to_uom.dimension and v_from_uom.dimension <> 'custom' then
      -- Convert from -> base -> to
      return round((p_qty * v_from_uom.to_base_factor) / v_to_uom.to_base_factor, 6);
    end if;
  end if;

  -- 5. No conversion found
  raise exception 'Cannot convert % from % to % for item % (no standard or item-specific conversion defined)',
    p_qty, p_from, p_to, p_item
    using errcode = 'data_exception';
end;
$$ language plpgsql stable;

INSERT INTO schema_migrations (filename) VALUES ('020_master_data_units_and_shrinkage.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 021_purchasing_and_3way_matching.sql
-- =============================================================================
-- 021_purchasing_and_3way_matching.sql
-- Phase 2: Purchasing & Receiving Engine (Auto-PO from Par, 3-Way Match)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Supplier Price Books (LIEFERART) with pack sizes, contract prices, and lead times
-- - Purchase Orders (BESTELLUNG / BESTPOS) with approval workflows and statuses
-- - Automated Par Ordering from min/max levels and pending orders (OrderCalculation.cs)
-- - 3-Way Matching: Purchase Order vs. Goods Receiving Note (GRN) vs. Supplier Invoice (LIEFSCH)

-- 1. Supplier Article Catalog & Price Book (HMC LIEFERART)
create table if not exists supplier_item_prices (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  supplier_id         uuid not null references suppliers(id),
  item_id             uuid not null references items(id),
  supplier_item_code  text,
  purchase_uom        text not null,
  pack_factor         numeric(18,6) not null default 1.0 check (pack_factor > 0),
  contract_price      numeric(18,2) not null check (contract_price >= 0),
  tax_rate            numeric(5,2) not null default 15.0 check (tax_rate >= 0),
  min_order_qty       numeric(18,6) not null default 1.0 check (min_order_qty > 0),
  lead_time_days      integer not null default 1 check (lead_time_days >= 0),
  is_preferred        boolean not null default false,
  effective_from      date not null default current_date,
  effective_to        date,
  created_at          timestamptz not null default now(),
  unique (tenant_id, supplier_id, item_id, purchase_uom),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_supplier_item_prices_lookup
  on supplier_item_prices (tenant_id, item_id, is_preferred);

-- 2. Purchase Orders (HMC BESTELLUNG)
create table if not exists purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  po_number              text not null,
  supplier_id            uuid not null references suppliers(id),
  destination_store_id   uuid not null references stores(id),
  order_date             date not null default current_date,
  expected_delivery_date date,
  status                 text not null default 'draft'
                         check (status in ('draft', 'approved', 'sent', 'partially_received', 'completed', 'cancelled')),
  notes                  text,
  approved_by            uuid references users(id),
  approved_at            timestamptz,
  created_by             text not null default 'system',
  created_at             timestamptz not null default now(),
  unique (tenant_id, po_number)
);

create index if not exists idx_purchase_orders_tenant_status
  on purchase_orders (tenant_id, status, supplier_id);

-- 3. Purchase Order Lines (HMC BESTPOS)
create table if not exists purchase_order_lines (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  purchase_order_id      uuid not null references purchase_orders(id) on delete cascade,
  line_no                integer not null,
  item_id                uuid not null references items(id),
  order_uom              text not null,
  ordered_pack_qty       numeric(18,6) not null check (ordered_pack_qty > 0),
  pack_factor            numeric(18,6) not null default 1.0 check (pack_factor > 0),
  ordered_inventory_qty  numeric(18,6) not null check (ordered_inventory_qty > 0),
  unit_price             numeric(18,2) not null check (unit_price >= 0),
  line_total             numeric(18,2) not null check (line_total >= 0),
  received_inventory_qty numeric(18,6) not null default 0 check (received_inventory_qty >= 0),
  status                 text not null default 'open'
                         check (status in ('open', 'partial', 'received', 'cancelled')),
  unique (purchase_order_id, line_no)
);

create index if not exists idx_purchase_order_lines_po
  on purchase_order_lines (purchase_order_id, item_id);

-- 4. Extend Purchases (GRN / Delivery Note) for 3-Way Matching (HMC LIEFSCH)
alter table purchases
  add column if not exists purchase_order_id uuid references purchase_orders(id),
  add column if not exists invoice_number text,
  add column if not exists invoice_amount numeric(18,2),
  add column if not exists match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'variance_flagged', 'variance_approved')),
  add column if not exists variance_reason text,
  add column if not exists variance_approved_by uuid references users(id),
  add column if not exists variance_approved_at timestamptz;

alter table purchase_lines
  add column if not exists po_line_id uuid references purchase_order_lines(id),
  add column if not exists ordered_qty numeric(18,6),
  add column if not exists ordered_unit_cost numeric(18,2),
  add column if not exists invoiced_qty numeric(18,6),
  add column if not exists invoiced_unit_cost numeric(18,2),
  add column if not exists price_variance numeric(18,2) default 0.0,
  add column if not exists qty_variance numeric(18,6) default 0.0,
  add column if not exists variance_status text not null default 'ok'
    check (variance_status in ('ok', 'price_mismatch', 'over_delivery', 'under_delivery', 'approved'));

-- 5. Stored Procedure: Auto-Ordering Calculation from Par Levels (OrderCalculation.cs)
-- Suggests order quantities where Current On-Hand + Pending On-Order <= Min Qty
-- Order Qty = RoundUp((Max Qty - On-Hand - Pending) / Pack Factor) * Pack Factor
create or replace function calculate_par_order_suggestions(
  p_tenant uuid,
  p_store  uuid
) returns table (
  item_id               uuid,
  item_code             text,
  item_name             text,
  inventory_uom         text,
  purchase_uom          text,
  pack_factor           numeric,
  supplier_id           uuid,
  supplier_name         text,
  contract_price        numeric,
  min_qty               numeric,
  max_qty               numeric,
  qty_on_hand           numeric,
  pending_ordered_qty   numeric,
  suggested_pack_qty    numeric,
  suggested_inv_qty     numeric,
  estimated_cost        numeric
) as $$
begin
  return query
  with pending_po as (
    -- Unfulfilled quantities currently on approved/sent purchase orders
    select pol.item_id,
           sum(pol.ordered_inventory_qty - pol.received_inventory_qty) as pending_qty
      from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
     where po.tenant_id = p_tenant
       and po.destination_store_id = p_store
       and po.status in ('approved', 'sent', 'partially_received')
       and pol.status in ('open', 'partial')
     group by pol.item_id
  ),
  stock_current as (
    select s.item_id, coalesce(s.qty_on_hand, 0) as on_hand
      from v_stock_on_hand s
     where s.tenant_id = p_tenant and s.store_id = p_store
  ),
  preferred_vendor as (
    -- Pick preferred supplier price record, or fallback to first valid price record
    select distinct on (sip.item_id)
           sip.item_id,
           sip.supplier_id,
           sup.name as supplier_name,
           sip.purchase_uom,
           sip.pack_factor,
           sip.contract_price,
           sip.min_order_qty
      from supplier_item_prices sip
      join suppliers sup on sup.id = sip.supplier_id
     where sip.tenant_id = p_tenant
       and (sip.effective_to is null or sip.effective_to >= current_date)
     order by sip.item_id, sip.is_preferred desc, sip.contract_price asc
  )
  select
    i.id as item_id,
    i.code as item_code,
    i.name as item_name,
    i.uom as inventory_uom,
    coalesce(pv.purchase_uom, i.purchase_uom, i.uom) as purchase_uom,
    coalesce(pv.pack_factor, i.pack_factor, 1.0)::numeric as pack_factor,
    pv.supplier_id,
    pv.supplier_name,
    coalesce(pv.contract_price, 0.0)::numeric as contract_price,
    lvl.min_qty::numeric,
    lvl.max_qty::numeric,
    coalesce(sc.on_hand, 0.0)::numeric as qty_on_hand,
    coalesce(ppo.pending_qty, 0.0)::numeric as pending_ordered_qty,
    -- Round up to full packs (ceil((Max - OnHand - Pending) / PackFactor))
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        greatest(
          ceil(
            (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
            / coalesce(pv.pack_factor, i.pack_factor, 1.0)
          ),
          coalesce(pv.min_order_qty, 1.0)
        )
      else 0.0
    end::numeric as suggested_pack_qty,
    -- Suggested inventory units
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        greatest(
          ceil(
            (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
            / coalesce(pv.pack_factor, i.pack_factor, 1.0)
          ),
          coalesce(pv.min_order_qty, 1.0)
        ) * coalesce(pv.pack_factor, i.pack_factor, 1.0)
      else 0.0
    end::numeric as suggested_inv_qty,
    -- Estimated total cost
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        round(
          greatest(
            ceil(
              (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
              / coalesce(pv.pack_factor, i.pack_factor, 1.0)
            ),
            coalesce(pv.min_order_qty, 1.0)
          ) * coalesce(pv.contract_price, 0.0),
          2
        )
      else 0.0
    end::numeric as estimated_cost
  from store_item_levels lvl
  join items i on i.id = lvl.item_id
  left join stock_current sc on sc.item_id = lvl.item_id
  left join pending_po ppo on ppo.item_id = lvl.item_id
  left join preferred_vendor pv on pv.item_id = lvl.item_id
  where lvl.tenant_id = p_tenant
    and lvl.store_id  = p_store
    and (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty
    and lvl.max_qty > lvl.min_qty
  order by i.code;
end;
$$ language plpgsql stable;

-- 6. Stored Function: 3-Way Matching Verification (HMC LIEFSCH Matching)
-- Evaluates Price Variance: (Actual Unit Cost - PO Unit Cost) * Qty
-- Evaluates Qty Variance: Received Qty - PO Ordered Qty
-- Flags receipts where price variance % exceeds tolerance
create or replace function match_3way_receipt(
  p_purchase_id          uuid,
  p_price_tolerance_pct  numeric default 2.0
) returns table (
  purchase_id        uuid,
  match_status       text,
  total_ordered_cost numeric,
  total_actual_cost  numeric,
  total_variance     numeric,
  flagged_lines      integer
) as $$
declare
  v_tenant   uuid;
  v_po_id    uuid;
  v_flagged  integer := 0;
  v_ord_sum  numeric := 0;
  v_act_sum  numeric := 0;
  v_var_sum  numeric := 0;
  v_status   text := 'matched';
  v_line     record;
  v_pct_diff numeric;
begin
  select tenant_id, purchase_order_id into v_tenant, v_po_id
    from purchases where id = p_purchase_id;

  if v_po_id is null then
    -- Non-PO direct receipt: matched automatically without PO lines
    update purchases set match_status = 'matched' where id = p_purchase_id;
    return query select p_purchase_id, 'matched'::text, 0.0::numeric, 0.0::numeric, 0.0::numeric, 0;
    return;
  end if;

  -- Walk through each purchase line and compare against PO line
  for v_line in
    select pl.id as line_id,
           pl.item_id,
           pl.qty,
           pl.unit_cost,
           pol.id as po_line_id,
           pol.ordered_inventory_qty as po_qty,
           pol.unit_price as po_unit_cost
      from purchase_lines pl
      left join purchase_order_lines pol
        on pol.purchase_order_id = v_po_id and pol.item_id = pl.item_id
     where pl.purchase_id = p_purchase_id
  loop
    if v_line.po_line_id is not null then
      -- Calculate variances
      v_pct_diff := case
        when v_line.po_unit_cost > 0 then
          abs((v_line.unit_cost - v_line.po_unit_cost) / v_line.po_unit_cost) * 100.0
        else 0.0
      end;

      v_ord_sum := v_ord_sum + (v_line.qty * v_line.po_unit_cost);
      v_act_sum := v_act_sum + (v_line.qty * v_line.unit_cost);
      v_var_sum := v_var_sum + (v_line.qty * (v_line.unit_cost - v_line.po_unit_cost));

      if v_pct_diff > p_price_tolerance_pct then
        v_flagged := v_flagged + 1;
        update purchase_lines
           set po_line_id = v_line.po_line_id,
               ordered_qty = v_line.po_qty,
               ordered_unit_cost = v_line.po_unit_cost,
               price_variance = round(v_line.qty * (v_line.unit_cost - v_line.po_unit_cost), 2),
               qty_variance = round(v_line.qty - v_line.po_qty, 6),
               variance_status = 'price_mismatch'
         where id = v_line.line_id;
      else
        update purchase_lines
           set po_line_id = v_line.po_line_id,
               ordered_qty = v_line.po_qty,
               ordered_unit_cost = v_line.po_unit_cost,
               price_variance = round(v_line.qty * (v_line.unit_cost - v_line.po_unit_cost), 2),
               qty_variance = round(v_line.qty - v_line.po_qty, 6),
               variance_status = 'ok'
         where id = v_line.line_id;
      end if;
    end if;
  end loop;

  if v_flagged > 0 then
    v_status := 'variance_flagged';
  else
    v_status := 'matched';
  end if;

  update purchases
     set match_status = v_status
   where id = p_purchase_id;

  return query select
    p_purchase_id,
    v_status,
    round(v_ord_sum, 2)::numeric,
    round(v_act_sum, 2)::numeric,
    round(v_var_sum, 2)::numeric,
    v_flagged;
end;
$$ language plpgsql;

INSERT INTO schema_migrations (filename) VALUES ('021_purchasing_and_3way_matching.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 022_production_batches_and_yield_tests.sql
-- =============================================================================
-- 022_production_batches_and_yield_tests.sql
-- Phase 3: Production Batches & Yield Engineering (PROD.EXE / MENU.EXE)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Batch Production of Sub-Recipes (PRODUKTION / PRODPOS / ProductionDBusinessObject.cs)
-- - Butcher Tests & Yield Cut Calculations (YIELD / YIELDPOS / YieldBusinessObject.cs)

-- 1. Extend stock_movements constraint to allow production & butchery movements
alter table stock_movements drop constraint if exists stock_movements_movement_type_check;

alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in (
    'opening',          -- opening balance
    'receipt',          -- purchase received into a store
    'issue_out',        -- leaves the issuing store
    'issue_in',         -- arrives at the receiving store
    'transfer_out',     -- inter-outlet, leaves
    'transfer_in',      -- inter-outlet, arrives
    'sale_depletion',   -- exploded from a recipe on a posted sale
    'wastage',
    'comp',             -- complimentary
    'staff_meal',       -- costed at raw ingredient cost
    'count_adjustment', -- physical count correction
    'reversal',
    'production_issue',   -- raw ingredients consumed in batch prep
    'production_receipt', -- finished sub-recipe batch booked to stock
    'butcher_primal_issue', -- primal cut issued to butcher block
    'butcher_cut_receipt'   -- prime cuts/byproducts yielded from butchery
  ));

-- 2. Production Batches (HMC PRODUKTION)
create table if not exists production_batches (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  batch_number     text not null,
  store_id         uuid not null references stores(id),
  recipe_id        uuid references recipes(id),
  target_item_id   uuid references items(id),
  batch_qty        numeric(18,6) not null check (batch_qty > 0),
  produced_qty     numeric(18,6) not null check (produced_qty > 0),
  produced_uom     text not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'scheduled', 'posted', 'reversed')),
  production_date  date not null default current_date,
  notes            text,
  total_cost       numeric(18,2) not null default 0.0 check (total_cost >= 0),
  unit_cost        numeric(18,2) not null default 0.0 check (unit_cost >= 0),
  created_by       text not null default 'system',
  created_at       timestamptz not null default now(),
  posted_at        timestamptz,
  unique (tenant_id, batch_number)
);

create index if not exists idx_production_batches_store
  on production_batches (tenant_id, store_id, status);

-- 3. Production Batch Ingredient Lines (HMC PRODPOS)
create table if not exists production_batch_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  batch_id     uuid not null references production_batches(id) on delete cascade,
  line_no      integer not null,
  item_id      uuid not null references items(id),
  planned_qty  numeric(18,6) not null check (planned_qty > 0),
  actual_qty   numeric(18,6) not null check (actual_qty > 0),
  uom          text not null,
  unit_cost    numeric(18,2) not null default 0.0 check (unit_cost >= 0),
  line_cost    numeric(18,2) not null default 0.0 check (line_cost >= 0),
  unique (batch_id, line_no)
);

create index if not exists idx_production_batch_lines_batch
  on production_batch_lines (batch_id, item_id);

-- 4. Butcher / Yield Tests (HMC YIELD)
create table if not exists yield_tests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  test_number        text not null,
  store_id           uuid not null references stores(id),
  primal_item_id     uuid not null references items(id),
  test_date          date not null default current_date,
  gross_weight       numeric(18,6) not null check (gross_weight > 0),
  gross_cost_per_kg  numeric(18,2) not null check (gross_cost_per_kg >= 0),
  total_primal_cost  numeric(18,2) not null check (total_primal_cost >= 0),
  usable_weight      numeric(18,6) not null default 0.0 check (usable_weight >= 0),
  waste_weight       numeric(18,6) not null default 0.0 check (waste_weight >= 0),
  yield_percent      numeric(5,2) not null default 0.0,
  loss_percent       numeric(5,2) not null default 0.0,
  cost_factor        numeric(8,4) not null default 1.0,
  status             text not null default 'draft'
                     check (status in ('draft', 'posted', 'reversed')),
  notes              text,
  created_by         text not null default 'system',
  created_at         timestamptz not null default now(),
  posted_at          timestamptz,
  unique (tenant_id, test_number)
);

create index if not exists idx_yield_tests_lookup
  on yield_tests (tenant_id, primal_item_id, test_date);

-- 5. Butcher / Yield Test Breakdown Lines (HMC YIELDPOS)
create table if not exists yield_test_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  yield_test_id         uuid not null references yield_tests(id) on delete cascade,
  line_no               integer not null,
  cut_name              text not null,
  item_id               uuid references items(id),
  is_byproduct          boolean not null default false,
  weight                numeric(18,6) not null check (weight >= 0),
  weight_percent        numeric(5,2) not null default 0.0,
  market_price_per_kg   numeric(18,2) not null default 0.0,
  allocated_cost_per_kg numeric(18,2) not null default 0.0,
  total_line_cost       numeric(18,2) not null default 0.0,
  unique (yield_test_id, line_no)
);

create index if not exists idx_yield_test_lines_test
  on yield_test_lines (yield_test_id, item_id);

INSERT INTO schema_migrations (filename) VALUES ('022_production_batches_and_yield_tests.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 023_blind_counts_and_recipe_waste.sql
-- =============================================================================
-- 023_blind_counts_and_recipe_waste.sql
-- Phase 4: Stock Movement & Physical Count Engine (Stock.exe / INVENTUR.EXE / WASTE)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Blind Physical Count Sheets (hiding book stock from counters)
-- - Variance Recount Flags & Thresholds (INVENTUR.EXE / InventoryBusinessProcessObject.cs)
-- - Discrepancy Reason Codes & Adjustment Journals
-- - Recipe-Exploded Waste & Spoilage Logging (WASTE / AddRecipeToWastePos.cs)

-- 1. Extend stock_counts for Blind Counts & Recount Workflow
alter table stock_counts
  add column if not exists is_blind boolean not null default true,
  add column if not exists recount_requested boolean not null default false,
  add column if not exists recount_notes text,
  add column if not exists recount_by text;

alter table stock_counts drop constraint if exists stock_counts_status_check;

alter table stock_counts add constraint stock_counts_status_check
  check (status in ('draft', 'recount_required', 'approved', 'posted', 'reversed'));

-- 2. Extend stock_count_lines for Recount Tracking & Discrepancy Classification
alter table stock_count_lines
  add column if not exists first_counted_qty numeric(18,6),
  add column if not exists recount_qty numeric(18,6),
  add column if not exists recount_status text not null default 'none'
    check (recount_status in ('none', 'flagged', 'recounted', 'waived')),
  add column if not exists discrepancy_reason text
    check (discrepancy_reason is null or discrepancy_reason in (
      'spoilage', 'unrecorded_waste', 'theft', 'portion_error',
      'receiving_error', 'counting_error', 'other'
    ));

-- 3. Extend waste_log_lines to allow logging waste by Recipe / Dish (AddRecipeToWastePos.cs)
alter table waste_log_lines
  add column if not exists recipe_id uuid references recipes(id),
  add column if not exists portions numeric(18,6) check (portions is null or portions > 0);

alter table waste_log_lines alter column item_id drop not null;

alter table waste_log_lines drop constraint if exists waste_log_lines_item_or_recipe_chk;

alter table waste_log_lines add constraint waste_log_lines_item_or_recipe_chk
  check ((item_id is not null) or (recipe_id is not null));

alter table waste_log_lines drop constraint if exists waste_log_lines_tenant_id_waste_log_id_item_id_reason_key;

-- 4. Stored Procedure: Evaluate Count Recount Flags (HMC InventoryBusinessProcessObject.cs)
-- Checks count lines against variance thresholds (default: value > 500 ETB or variance % > 5%)
-- Flags discrepant lines and updates count status to 'recount_required' if discrepancies found
create or replace function evaluate_count_recounts(
  p_count_id           uuid,
  p_val_threshold      numeric default 500.0,
  p_pct_threshold      numeric default 5.0
) returns table (
  stock_count_id    uuid,
  status            text,
  flagged_lines     integer,
  total_variance_val numeric
) as $$
declare
  v_flagged integer := 0;
  v_total_val numeric := 0.0;
  v_line record;
  v_var_qty numeric;
  v_var_val numeric;
  v_var_pct numeric;
begin
  for v_line in
    select scl.id, scl.theoretical_qty, coalesce(scl.counted_qty, scl.first_counted_qty, 0) as counted, scl.unit_cost
      from stock_count_lines scl
     where scl.stock_count_id = p_count_id
       and (scl.counted_qty is not null or scl.first_counted_qty is not null)
  loop
    v_var_qty := abs(v_line.counted - v_line.theoretical_qty);
    v_var_val := v_var_qty * v_line.unit_cost;
    v_total_val := v_total_val + (v_line.counted - v_line.theoretical_qty) * v_line.unit_cost;

    v_var_pct := case
      when v_line.theoretical_qty > 0 then (v_var_qty / v_line.theoretical_qty) * 100.0
      when v_var_qty > 0 then 100.0
      else 0.0
    end;

    if v_var_val > p_val_threshold or v_var_pct > p_pct_threshold then
      v_flagged := v_flagged + 1;
      update stock_count_lines
         set recount_status = 'flagged'
       where id = v_line.id;
    else
      update stock_count_lines
         set recount_status = 'none'
       where id = v_line.id;
    end if;
  end loop;

  if v_flagged > 0 then
    update stock_counts sc
       set status = 'recount_required', recount_requested = true
     where sc.id = p_count_id and sc.status in ('draft', 'recount_required');
  else
    update stock_counts sc
       set status = 'approved', recount_requested = false
     where sc.id = p_count_id and sc.status in ('draft', 'recount_required');
  end if;

  return query
  select
    p_count_id,
    case when v_flagged > 0 then 'recount_required'::text else 'approved'::text end,
    v_flagged,
    round(v_total_val, 2);
end;
$$ language plpgsql;

INSERT INTO schema_migrations (filename) VALUES ('023_blind_counts_and_recipe_waste.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 024_pos_depletion_and_theoretical_reconciliation.sql
-- =============================================================================
-- 024_pos_depletion_and_theoretical_reconciliation.sql
-- Phase 5: End-of-Day Sales Depletion & Theoretical Reconciliation Engine (HMC Soll-Ist-Vergleich, FBCalculation.cs)
-- Note: Sales enter the system via End-of-Day CNet export file uploads (sales_imports), NOT direct POS connection.

-- 1. Drop pos_daily_sessions if previously created
drop table if exists pos_daily_sessions cascade;

-- 2. Stored Procedure: Calculate Theoretical vs. Actual Consumption Matrix (HMC Soll-Ist-Vergleich)
-- Calculates full Material Consumption equation over any given date range per store:
--   Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
--   Theoretical Consumption = POS Depletions (from EOD CNet uploads) + Approved Wastage + Comps + Staff Meals
--   Unexplained Variance = Actual - Theoretical
create or replace function calculate_theoretical_vs_actual_matrix(
  p_tenant     uuid,
  p_store      uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  item_id                     uuid,
  item_code                   text,
  item_name                   text,
  category                    text,
  uom                         text,
  opening_qty                 numeric,
  received_qty                numeric,
  transfers_net_qty           numeric,
  production_net_qty          numeric,
  closing_qty                 numeric,
  actual_consumption_qty      numeric,
  pos_depletion_qty           numeric,
  waste_qty                   numeric,
  comp_qty                    numeric,
  staff_meal_qty              numeric,
  theoretical_consumption_qty numeric,
  variance_qty                numeric,
  unit_cost                   numeric,
  variance_value              numeric,
  variance_pct                numeric,
  variance_status             text,
  probable_cause              text
) as $$
declare
  v_item record;
  v_open_qty numeric;
  v_rec_qty numeric;
  v_trans_qty numeric;
  v_prod_qty numeric;
  v_close_qty numeric;
  v_act_cons numeric;
  v_dep_qty numeric;
  v_wast_qty numeric;
  v_comp_qty numeric;
  v_meal_qty numeric;
  v_theo_cons numeric;
  v_var_qty numeric;
  v_cost numeric;
  v_var_val numeric;
  v_var_pct numeric;
  v_status text;
  v_cause text;
begin
  for v_item in
    select i.id, i.code, i.name, c.code as category, i.uom
      from items i
      join item_categories c on c.id = i.category_id
     where i.tenant_id = p_tenant
     order by c.code, i.code
  loop
    -- A. Opening Stock (on-hand balance before p_start_date)
    select coalesce(sum(m.qty_delta), 0)
      into v_open_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.occurred_on < p_start_date;

    -- B. Receipts (purchases received during period)
    select coalesce(sum(m.qty_delta), 0)
      into v_rec_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type = 'receipt'
       and m.occurred_on between p_start_date and p_end_date;

    -- C. Net Transfers & Issues during period
    select coalesce(sum(case
             when m.movement_type in ('transfer_in', 'issue_in') then m.qty_delta
             when m.movement_type in ('transfer_out', 'issue_out') then m.qty_delta
             else 0
           end), 0)
      into v_trans_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('transfer_in', 'issue_in', 'transfer_out', 'issue_out')
       and m.occurred_on between p_start_date and p_end_date;

    -- D. Net Production (batches & butcher yields)
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.qty_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.qty_delta
             else 0
           end), 0)
      into v_prod_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
       and m.occurred_on between p_start_date and p_end_date;

    -- E. Closing Stock (from posted stock count at p_end_date if exists, else ledger balance)
    select scl.counted_qty
      into v_close_qty
      from stock_counts sc
      join stock_count_lines scl on scl.stock_count_id = sc.id and scl.item_id = v_item.id
     where sc.tenant_id = p_tenant
       and sc.store_id = p_store
       and sc.count_date = p_end_date
       and sc.status = 'posted'
     limit 1;

    if v_close_qty is null then
      -- Fallback to running ledger balance as of p_end_date
      select coalesce(sum(m.qty_delta), 0)
        into v_close_qty
        from stock_movements m
       where m.tenant_id = p_tenant
         and m.store_id = p_store
         and m.item_id = v_item.id
         and m.occurred_on <= p_end_date;
    end if;

    -- F. POS Recipe Depletions (sale_depletion from EOD CNet uploads)
    select coalesce(-sum(m.qty_delta), 0)
      into v_dep_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type = 'sale_depletion'
       and m.occurred_on between p_start_date and p_end_date;

    -- G. Logged Losses: Wastage, Comps, Staff Meals
    select coalesce(-sum(case when m.movement_type = 'wastage' then m.qty_delta else 0 end), 0),
           coalesce(-sum(case when m.movement_type = 'comp' then m.qty_delta else 0 end), 0),
           coalesce(-sum(case when m.movement_type = 'staff_meal' then m.qty_delta else 0 end), 0)
      into v_wast_qty, v_comp_qty, v_meal_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('wastage', 'comp', 'staff_meal')
       and m.occurred_on between p_start_date and p_end_date;

    -- Skip items with absolutely zero activity across all dimensions
    if v_open_qty = 0 and v_rec_qty = 0 and v_trans_qty = 0 and v_prod_qty = 0
       and v_close_qty = 0 and v_dep_qty = 0 and v_wast_qty = 0 and v_comp_qty = 0 and v_meal_qty = 0 then
      continue;
    end if;

    -- H. Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
    v_act_cons := round(v_open_qty + v_rec_qty + v_trans_qty + v_prod_qty - v_close_qty, 6);

    -- I. Theoretical Consumption = POS Depletions + Waste + Comps + Staff Meals
    v_theo_cons := round(v_dep_qty + v_wast_qty + v_comp_qty + v_meal_qty, 6);

    -- If no count existed, actual equals theoretical plus uncounted adjustments
    if v_act_cons < 0 and v_theo_cons > 0 then
      v_act_cons := v_theo_cons;
    end if;

    -- J. Unexplained Variance = Actual - Theoretical
    v_var_qty := round(v_act_cons - v_theo_cons, 6);

    -- Current moving average unit cost
    select current_avg_cost(p_tenant, p_store, v_item.id)
      into v_cost;
    v_cost := coalesce(v_cost, 0);

    v_var_val := round(v_var_qty * v_cost, 2);

    v_var_pct := case
      when v_theo_cons > 0 then round((v_var_qty / v_theo_cons) * 100.0, 2)
      when v_var_qty > 0 then 100.0
      else 0.0
    end;

    -- Status classification & probable cause
    if abs(v_var_val) > 500.0 or abs(v_var_pct) > 5.0 then
      v_status := 'LEAKAGE_ALERT';
      if v_var_qty > 0 then
        if v_dep_qty > 0 and v_wast_qty = 0 then
          v_cause := 'OVER_PORTIONING';
        else
          v_cause := 'UNRECORDED_WASTE_OR_THEFT';
        end if;
      else
        v_cause := 'COUNTING_ERROR_OR_SURPLUS';
      end if;
    elsif abs(v_var_val) > 100.0 or abs(v_var_pct) > 2.0 then
      v_status := 'REVIEW';
      v_cause := case when v_var_qty > 0 then 'PORTION_DRIFT' else 'SURPLUS_UNDER_REVIEW' end;
    else
      v_status := 'NORMAL';
      v_cause := 'ON_TARGET';
    end if;

    return query
    select
      v_item.id,
      v_item.code,
      v_item.name,
      v_item.category,
      v_item.uom,
      v_open_qty,
      v_rec_qty,
      v_trans_qty,
      v_prod_qty,
      v_close_qty,
      v_act_cons,
      v_dep_qty,
      v_wast_qty,
      v_comp_qty,
      v_meal_qty,
      v_theo_cons,
      v_var_qty,
      v_cost,
      v_var_val,
      v_var_pct,
      v_status,
      v_cause;
  end loop;
end;
$$ language plpgsql stable;

INSERT INTO schema_migrations (filename) VALUES ('024_pos_depletion_and_theoretical_reconciliation.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 025_executive_cost_control_reports.sql
-- =============================================================================
-- 025_executive_cost_control_reports.sql
-- Phase 6: Materials Control Executive Reporting Suite (HMC FBCalculation, Cost Centers, Stock Card, ABC)

-- 1. Stored Procedure: Comprehensive F&B Actual vs. Theoretical Cost of Sales
-- Computes the full classical hotel F&B equation over any trading period for Food and Beverage:
--   Gross Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
--   Net Cost of Sales = Gross Consumption - Staff Meals - Comps
--   Theoretical Cost = POS Depletions (from EOD sales uploads)
--   Variance Value = Net Cost of Sales - Theoretical Cost
create or replace function get_fb_cost_reconciliation(
  p_tenant     uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  kind                     text,
  revenue_total            numeric,
  revenue_costed           numeric,
  coverage_pct             numeric,
  opening_stock            numeric,
  purchases                numeric,
  transfers_in             numeric,
  transfers_out            numeric,
  production_net           numeric,
  closing_stock            numeric,
  gross_consumption        numeric,
  staff_meals              numeric,
  comps                    numeric,
  waste                    numeric,
  net_cost_of_sales        numeric,
  actual_cost_pct          numeric,
  theoretical_cost         numeric,
  theoretical_cost_pct     numeric,
  variance_value           numeric,
  cost_variance_pct        numeric,
  potential_savings        numeric
) as $$
declare
  v_kind text;
  v_store_kind text;
  v_rev_tot numeric;
  v_rev_cost numeric;
  v_cov_pct numeric;
  v_open numeric;
  v_purch numeric;
  v_trans_in numeric;
  v_trans_out numeric;
  v_prod_net numeric;
  v_close numeric;
  v_gross numeric;
  v_meals numeric;
  v_comps numeric;
  v_waste numeric;
  v_net_cost numeric;
  v_act_pct numeric;
  v_theo numeric;
  v_theo_pct numeric;
  v_var_val numeric;
  v_var_pct numeric;
  v_savings numeric;
begin
  for v_kind in select unnest(array['food', 'beverage']) loop
    v_store_kind := case when v_kind = 'food' then 'kitchen' else 'bar' end;

    -- Revenue from sales imports covering or within this period
    select
      coalesce(sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true)), 0),
      coalesce(sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true) and sl.depleted), 0)
    into v_rev_tot, v_rev_cost
    from sales_lines sl
    join sales_imports si on si.id = sl.sales_import_id
    left join pos_item_map pim on pim.id = sl.pos_item_map_id
    left join menu_items mi on mi.id = sl.menu_item_id
    where si.tenant_id = p_tenant
      and si.status = 'posted'
      and si.business_date between p_start_date and p_end_date
      and coalesce(mi.kind, pim.revenue_kind, 'other') = v_kind;

    v_cov_pct := case
      when v_rev_tot > 0 then round((v_rev_cost / v_rev_tot) * 100.0, 2)
      else null
    end;

    -- Opening Balance Value before p_start_date for stores of this kind
    select coalesce(sum(m.value_delta), 0)
    into v_open
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.occurred_on < p_start_date;

    -- Purchases / Receipts during period
    select coalesce(sum(m.value_delta), 0)
    into v_purch
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type = 'receipt'
      and m.occurred_on between p_start_date and p_end_date;

    -- Transfers In and Issues In
    select coalesce(sum(m.value_delta), 0)
    into v_trans_in
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('transfer_in', 'issue_in')
      and m.occurred_on between p_start_date and p_end_date;

    -- Transfers Out and Issues Out
    select coalesce(-sum(m.value_delta), 0)
    into v_trans_out
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('transfer_out', 'issue_out')
      and m.occurred_on between p_start_date and p_end_date;

    -- Net Production Batches & Butcher Yields
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.value_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.value_delta
             else 0
           end), 0)
    into v_prod_net
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
      and m.occurred_on between p_start_date and p_end_date;

    -- Closing Stock Value at p_end_date: from posted stock count if exists, else ledger running value
    select coalesce(sum(scl.counted_qty * scl.unit_cost), 0)
    into v_close
    from stock_counts sc
    join stores s on s.id = sc.store_id
    join stock_count_lines scl on scl.stock_count_id = sc.id
    where sc.tenant_id = p_tenant
      and s.kind = v_store_kind
      and sc.count_date = p_end_date
      and sc.status = 'posted';

    if v_close = 0 then
      select coalesce(sum(m.value_delta), 0)
      into v_close
      from stock_movements m
      join stores s on s.id = m.store_id
      where m.tenant_id = p_tenant
        and s.kind = v_store_kind
        and m.occurred_on <= p_end_date;
    end if;

    -- Theoretical Consumption (sales depletions from EOD CNet uploads)
    select coalesce(-sum(m.value_delta), 0)
    into v_theo
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type = 'sale_depletion'
      and m.occurred_on between p_start_date and p_end_date;

    -- Logged Losses: Staff Meals, Comps, Waste
    select
      coalesce(-sum(case when m.movement_type = 'staff_meal' then m.value_delta else 0 end), 0),
      coalesce(-sum(case when m.movement_type = 'comp' then m.value_delta else 0 end), 0),
      coalesce(-sum(case when m.movement_type = 'wastage' then m.value_delta else 0 end), 0)
    into v_meals, v_comps, v_waste
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('staff_meal', 'comp', 'wastage')
      and m.occurred_on between p_start_date and p_end_date;

    -- Gross Consumption = Opening + Receipts + Transfers In - Transfers Out + Net Production - Closing
    v_gross := round(v_open + v_purch + v_trans_in - v_trans_out + v_prod_net - v_close, 2);
    if v_gross < 0 then
      v_gross := round(v_theo + v_waste, 2);
    end if;

    -- Net Cost of Sales = Gross Consumption - Staff Meals - Comps
    v_net_cost := round(v_gross - v_meals - v_comps, 2);

    -- Actual Cost % against costed revenue
    v_act_pct := case
      when v_rev_cost > 0 then round((v_net_cost / v_rev_cost) * 100.0, 2)
      else null
    end;

    -- Theoretical Cost %
    v_theo_pct := case
      when v_rev_cost > 0 then round((v_theo / v_rev_cost) * 100.0, 2)
      else null
    end;

    -- Variance Value & Variance %
    v_var_val := round(v_net_cost - v_theo, 2);
    v_var_pct := case
      when v_act_pct is not null and v_theo_pct is not null then round(v_act_pct - v_theo_pct, 2)
      else null
    end;

    -- Potential Savings (positive variance represent preventable excess consumption)
    v_savings := case when v_var_val > 0 then v_var_val else 0 end;

    return query
    select
      v_kind,
      round(v_rev_tot, 2),
      round(v_rev_cost, 2),
      v_cov_pct,
      round(v_open, 2),
      round(v_purch, 2),
      round(v_trans_in, 2),
      round(v_trans_out, 2),
      round(v_prod_net, 2),
      round(v_close, 2),
      round(v_gross, 2),
      round(v_meals, 2),
      round(v_comps, 2),
      round(v_waste, 2),
      round(v_net_cost, 2),
      v_act_pct,
      round(v_theo, 2),
      v_theo_pct,
      round(v_var_val, 2),
      v_var_pct,
      round(v_savings, 2);
  end loop;
end;
$$ language plpgsql stable;

-- 2. Stored Procedure: Cost Center Comparison Matrix across Outlets
-- Summarizes deliveries, inter-store transfers, production, sales, and turnover per store
create or replace function get_cost_center_summary(
  p_tenant     uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  store_id              uuid,
  store_name            text,
  store_kind            text,
  opening_value         numeric,
  purchases_value       numeric,
  transfers_in_value    numeric,
  transfers_out_value   numeric,
  production_net_value  numeric,
  depletion_value       numeric,
  waste_value           numeric,
  closing_value         numeric,
  net_consumption_value numeric,
  turnover_ratio        numeric
) as $$
declare
  v_store record;
  v_open numeric;
  v_purch numeric;
  v_trans_in numeric;
  v_trans_out numeric;
  v_prod_net numeric;
  v_dep numeric;
  v_waste numeric;
  v_close numeric;
  v_net_cons numeric;
  v_avg_stock numeric;
  v_turnover numeric;
begin
  for v_store in
    select s.id, s.name, s.kind
      from stores s
     where s.tenant_id = p_tenant
     order by case s.kind when 'main' then 0 when 'kitchen' then 1 when 'bar' then 2 else 3 end, s.name
  loop
    -- Opening Balance
    select coalesce(sum(m.value_delta), 0)
      into v_open
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.occurred_on < p_start_date;

    -- Receipts (direct deliveries from suppliers)
    select coalesce(sum(m.value_delta), 0)
      into v_purch
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type = 'receipt'
       and m.occurred_on between p_start_date and p_end_date;

    -- Transfers / Issues In
    select coalesce(sum(m.value_delta), 0)
      into v_trans_in
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('transfer_in', 'issue_in')
       and m.occurred_on between p_start_date and p_end_date;

    -- Transfers / Issues Out
    select coalesce(-sum(m.value_delta), 0)
      into v_trans_out
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('transfer_out', 'issue_out')
       and m.occurred_on between p_start_date and p_end_date;

    -- Net Production
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.value_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.value_delta
             else 0
           end), 0)
      into v_prod_net
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
       and m.occurred_on between p_start_date and p_end_date;

    -- Depletions (from sales)
    select coalesce(-sum(m.value_delta), 0)
      into v_dep
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type = 'sale_depletion'
       and m.occurred_on between p_start_date and p_end_date;

    -- Waste, Comps, Staff Meals
    select coalesce(-sum(m.value_delta), 0)
      into v_waste
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('wastage', 'comp', 'staff_meal')
       and m.occurred_on between p_start_date and p_end_date;

    -- Closing Balance
    select coalesce(sum(scl.counted_qty * scl.unit_cost), 0)
      into v_close
      from stock_counts sc
      join stock_count_lines scl on scl.stock_count_id = sc.id
     where sc.tenant_id = p_tenant
       and sc.store_id = v_store.id
       and sc.count_date = p_end_date
       and sc.status = 'posted';

    if v_close = 0 then
      select coalesce(sum(m.value_delta), 0)
        into v_close
        from stock_movements m
       where m.tenant_id = p_tenant
         and m.store_id = v_store.id
         and m.occurred_on <= p_end_date;
    end if;

    -- Net Consumption / Usage
    v_net_cons := round(v_open + v_purch + v_trans_in - v_trans_out + v_prod_net - v_close, 2);
    if v_net_cons < 0 then
      v_net_cons := round(v_dep + v_waste, 2);
    end if;

    -- Average Stock & Turnover: Turnover = Net Consumption / Avg Stock
    v_avg_stock := (v_open + v_close) / 2.0;
    v_turnover := case
      when v_avg_stock > 0 then round(v_net_cons / v_avg_stock, 2)
      else 0.0
    end;

    return query
    select
      v_store.id,
      v_store.name,
      v_store.kind,
      round(v_open, 2),
      round(v_purch, 2),
      round(v_trans_in, 2),
      round(v_trans_out, 2),
      round(v_prod_net, 2),
      round(v_dep, 2),
      round(v_waste, 2),
      round(v_close, 2),
      round(v_net_cons, 2),
      v_turnover;
  end loop;
end;
$$ language plpgsql stable;

-- 3. Stored Procedure: Article Transaction History Ledger (Artikelkarte / Forward-Only Stock Card)
-- Reconstructs the exact chronological audit trail of all transactions for any article and store
create or replace function get_article_history_ledger(
  p_tenant     uuid,
  p_store      uuid,
  p_item       uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  movement_id       uuid,
  occurred_on       date,
  occurred_at       timestamptz,
  movement_type     text,
  source_doc_type   text,
  source_doc_id     uuid,
  note              text,
  qty_delta         numeric,
  unit_cost         numeric,
  value_delta       numeric,
  running_qty       numeric,
  running_avg_cost  numeric,
  running_value     numeric
) as $$
declare
  v_mov record;
  v_cur_qty numeric := 0.0;
  v_cur_val numeric := 0.0;
  v_cur_avg numeric := 0.0;
begin
  -- First calculate starting position before p_start_date
  select coalesce(sum(m.qty_delta), 0), coalesce(sum(m.value_delta), 0)
    into v_cur_qty, v_cur_val
    from stock_movements m
   where m.tenant_id = p_tenant
     and m.store_id = p_store
     and m.item_id = p_item
     and m.occurred_on < p_start_date;

  v_cur_avg := case when v_cur_qty > 0 then round(v_cur_val / v_cur_qty, 2) else 0.0 end;

  for v_mov in
    select m.id, m.occurred_on, m.occurred_at, m.movement_type,
           m.source_doc_type, m.source_doc_id, m.note,
           m.qty_delta, m.unit_cost, m.value_delta
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = p_item
       and m.occurred_on between p_start_date and p_end_date
     order by m.occurred_on, m.seq, m.occurred_at
  loop
    v_cur_qty := v_cur_qty + v_mov.qty_delta;
    v_cur_val := v_cur_val + v_mov.value_delta;
    v_cur_avg := case when v_cur_qty > 0 then round(v_cur_val / v_cur_qty, 2) else v_mov.unit_cost end;

    return query
    select
      v_mov.id,
      v_mov.occurred_on,
      v_mov.occurred_at,
      v_mov.movement_type,
      v_mov.source_doc_type,
      v_mov.source_doc_id,
      v_mov.note,
      v_mov.qty_delta,
      v_mov.unit_cost,
      v_mov.value_delta,
      round(v_cur_qty, 6),
      round(v_cur_avg, 2),
      round(v_cur_val, 2);
  end loop;
end;
$$ language plpgsql stable;

INSERT INTO schema_migrations (filename) VALUES ('025_executive_cost_control_reports.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- MIGRATION: 026_materials_control_user_roles.sql
-- =============================================================================
-- 026_materials_control_user_roles.sql
-- Authentic Materials Control (HMC) User, Department Group & Store Rights Architecture
-- Directly models HMC BESTELLER, KSTRIGHTS (KGT_ALLKST), and RIGHTS tables.

-- 1. Drop rigid legacy check constraints on store_id
alter table users drop constraint if exists users_check;
alter table users drop constraint if exists users_check1;
alter table users drop constraint if exists users_role_check;

-- 2. Add HMC Department Groups, All-Stores Access flag (KGT_ALLKST), C/S Store Filter, and Document Visibility
alter table users
  add column if not exists department_group text not null default 'custom'
    check (department_group in ('controller', 'storekeeper', 'chef', 'bar', 'purchasing', 'management', 'admin', 'custom')),
  add column if not exists all_stores_access boolean not null default false,
  add column if not exists assigned_store_ids jsonb not null default '[]'::jsonb,
  add column if not exists document_visibility text not null default 'department'
    check (document_visibility in ('all', 'department', 'own'));

-- 3. Backfill existing users according to HMC rules
-- Admin users get full property-wide all-stores access
update users
set department_group = 'admin',
    all_stores_access = true,
    document_visibility = 'all'
where role = 'admin';

-- Store users get assigned their current store_id into assigned_store_ids
update users u
set department_group = case 
      when s.kind = 'kitchen' then 'chef'
      when s.kind = 'bar' then 'bar'
      when s.kind = 'main' then 'storekeeper'
      else 'custom'
    end,
    all_stores_access = false,
    assigned_store_ids = case when u.store_id is not null then jsonb_build_array(u.store_id) else '[]'::jsonb end,
    document_visibility = 'department'
from stores s
where u.store_id = s.id and u.role = 'store_user';

INSERT INTO schema_migrations (filename) VALUES ('026_materials_control_user_roles.sql') ON CONFLICT (filename) DO NOTHING;

-- =============================================================================
-- 3. Clean-Slate Master Data Seeding (Tenant, Branch, Stores, Staff Users)
-- =============================================================================

DO $$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
  v_main_id uuid;
  v_kitchen_id uuid;
  v_bar_id uuid;
  v_prep_id uuid;
BEGIN
  -- Tenant
  INSERT INTO tenants (code, name) VALUES ('PRIME', 'Prime Hospitality Business Group')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_tenant_id;

  -- Branch
  INSERT INTO branches (tenant_id, code, name) VALUES (v_tenant_id, 'SIYONAT', 'Siyonat Branch')
  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_branch_id;

  -- 4 Stores
  INSERT INTO stores (tenant_id, branch_id, code, name, kind)
  VALUES (v_tenant_id, v_branch_id, 'MAIN', 'Central Store (Warehouse)', 'main')
  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind
  RETURNING id INTO v_main_id;

  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)
  VALUES (v_tenant_id, v_branch_id, 'KITCHEN', 'Main Kitchen', 'kitchen', v_main_id)
  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id
  RETURNING id INTO v_kitchen_id;

  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)
  VALUES (v_tenant_id, v_branch_id, 'BAR', 'Main Bar', 'bar', v_main_id)
  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id
  RETURNING id INTO v_bar_id;

  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)
  VALUES (v_tenant_id, v_branch_id, 'PREP', 'Pastry & Prep Kitchen', 'prep', v_main_id)
  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id
  RETURNING id INTO v_prep_id;

  -- 5 Staff Users (HMC Role-Based Permissions, default password: password123)
  -- Staff User: admin (General Manager (Admin))
  INSERT INTO users (
    tenant_id, username, password_hash, display_name, role, store_id,
    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
  ) VALUES (
    v_tenant_id, 'admin', 'bbf282644008073e0166e0fce585649d:bd635604f6e70c8bb091dfc8065175d8272dae91b816f916136aded6d8d205691fbc7316fc2d88ca4f555a054c3432749a32e13994177f1274565699696c3436', 'General Manager (Admin)', 'admin', NULL,
    '["all"]'::jsonb, 'admin', true,
    '[]'::jsonb, 'all'
  )
  ON CONFLICT (tenant_id, username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    department_group = EXCLUDED.department_group,
    all_stores_access = EXCLUDED.all_stores_access,
    assigned_store_ids = EXCLUDED.assigned_store_ids,
    document_visibility = EXCLUDED.document_visibility;

  -- Staff User: controller (F&B Cost Controller)
  INSERT INTO users (
    tenant_id, username, password_hash, display_name, role, store_id,
    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
  ) VALUES (
    v_tenant_id, 'controller', 'b86341281bbff1ba8967103cd4116305:4576f9f7a39c29b76d5c828ab1ac0aef74bb6c875d3ef2c6caa6892f3127d168d4f074c2890b47e7a7eddec4f4fd786da486186c9f55ac8b2acb1c02f24c327d', 'F&B Cost Controller', 'store_user', NULL,
    '["sales_eod_upload","sales_view","price_override_approve","recount_authorize","waste_approve","reports_view","variance_view","ledger_view","recipe_view","recipe_cost_manage"]'::jsonb, 'controller', true,
    '[]'::jsonb, 'all'
  )
  ON CONFLICT (tenant_id, username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    department_group = EXCLUDED.department_group,
    all_stores_access = EXCLUDED.all_stores_access,
    assigned_store_ids = EXCLUDED.assigned_store_ids,
    document_visibility = EXCLUDED.document_visibility;

  -- Staff User: storekeeper (Central Storekeeper)
  INSERT INTO users (
    tenant_id, username, password_hash, display_name, role, store_id,
    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
  ) VALUES (
    v_tenant_id, 'storekeeper', 'a16bdef4accc794c248b4679a36de66a:01134639229a72db6701d0f509ae2eb8f213d0acd9fe870641b2a2710f942719683610cc9b871474b47edf9c85521119a74b0bec5089e1c7ccc3d03b3f4214ec', 'Central Storekeeper', 'store_user', v_main_id,
    '["po_create","purchase_receive","issue_fulfill","transfer_manage","count_entry","waste_log","ledger_view"]'::jsonb, 'storekeeper', false,
    jsonb_build_array(v_main_id::text), 'all'
  )
  ON CONFLICT (tenant_id, username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    department_group = EXCLUDED.department_group,
    all_stores_access = EXCLUDED.all_stores_access,
    assigned_store_ids = EXCLUDED.assigned_store_ids,
    document_visibility = EXCLUDED.document_visibility;

  -- Staff User: chef (Executive Chef)
  INSERT INTO users (
    tenant_id, username, password_hash, display_name, role, store_id,
    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
  ) VALUES (
    v_tenant_id, 'chef', 'd33703df7265722ef772ca9be6ede307:9022b8b6ad8ed11e0657a5270b9264262e73de93ccbd5b39d1fad313bb861e10bfc7d43b5b810a34395f504aee33cdf5797baa281ab15da8cefc399773e5c20c', 'Executive Chef', 'store_user', v_kitchen_id,
    '["issue_request","issue_authorize","butcher_test","production_batch","waste_log","count_entry","recipe_view","ledger_view"]'::jsonb, 'chef', false,
    jsonb_build_array(v_kitchen_id::text), 'department'
  )
  ON CONFLICT (tenant_id, username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    department_group = EXCLUDED.department_group,
    all_stores_access = EXCLUDED.all_stores_access,
    assigned_store_ids = EXCLUDED.assigned_store_ids,
    document_visibility = EXCLUDED.document_visibility;

  -- Staff User: bar (Bar Manager)
  INSERT INTO users (
    tenant_id, username, password_hash, display_name, role, store_id,
    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
  ) VALUES (
    v_tenant_id, 'bar', '9e85cd6042f1bfd110a3c3747be4dfeb:a588a253a2ddbd3cf6bfc33693f19ba5fe7f2deb4345bdf2841b2fb56ff277c46fdc4c92d3ee9a73d8bbd4159dc49eaa5f089622779c403d0e34bd1f0716cc82', 'Bar Manager', 'store_user', v_bar_id,
    '["issue_request","transfer_manage","waste_log","count_entry","recipe_view","ledger_view"]'::jsonb, 'bar', false,
    jsonb_build_array(v_bar_id::text), 'department'
  )
  ON CONFLICT (tenant_id, username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    department_group = EXCLUDED.department_group,
    all_stores_access = EXCLUDED.all_stores_access,
    assigned_store_ids = EXCLUDED.assigned_store_ids,
    document_visibility = EXCLUDED.document_visibility;

END $$;

-- -----------------------------------------------------------------------------
-- 4. Verification Check Query
-- -----------------------------------------------------------------------------
SELECT
  (SELECT name FROM tenants LIMIT 1) AS tenant,
  (SELECT count(*) FROM stores) AS stores_count,
  (SELECT count(*) FROM users) AS users_count,
  (SELECT count(*) FROM pos_item_map) AS articles_count,
  (SELECT count(*) FROM recipes) AS recipes_count,
  (SELECT count(*) FROM stock_movements) AS stock_movements_count;