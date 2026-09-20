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
