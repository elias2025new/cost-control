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
