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
