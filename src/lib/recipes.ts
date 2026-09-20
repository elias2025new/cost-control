import 'server-only';

import { db } from './server-db';
import { requireTenant } from './queries';

/**
 * Recipe costs as at a chosen date - the whole point of effective dating.
 *
 * recipe_cost() raises rather than returning a wrong answer when a recipe
 * has no version in force on that date (by design - see 006_recipe_costing.sql).
 * That's correct for a caller asking about one specific recipe it knows
 * exists on that date, but this screen compares every recipe on two dates
 * chosen freely, and a recipe simply not having existed yet on the earlier
 * one is an expected, displayable state ("-"), not an error - so it's
 * guarded here rather than left to raise.
 */
export async function recipeCostsAsOf(asOf: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    recipe_id: string;
    recipe_code: string;
    recipe_name: string;
    kind: string;
    menu_kind: string | null;
    is_sample: boolean;
    cost: string | null;
  }>(
    `select r.id as recipe_id, r.code as recipe_code, r.name as recipe_name, r.kind,
            mi.kind as menu_kind, r.is_sample,
            case
              when exists (
                select 1 from recipe_versions rv
                 where rv.tenant_id = r.tenant_id and rv.recipe_id = r.id
                   and rv.effective_from <= $2::date
              ) then recipe_cost(r.tenant_id, r.id, $2::date)
              else null
            end as cost
       from recipes r
       left join menu_items mi on mi.id = r.menu_item_id
      where r.tenant_id = $1
      order by case r.kind when 'menu' then 0 else 1 end, r.name`,
    [t.id, asOf],
  );
  return rows;
}

/** Same "didn't exist yet" guard as recipeCostsAsOf - see its comment. */
export async function recipeBreakdown(recipeId: string, asOf: string) {
  const d = await db();
  const t = await requireTenant();

  const { rows: existed } = await d.query<{ exists: boolean }>(
    `select exists (
       select 1 from recipe_versions
        where tenant_id = $1 and recipe_id = $2 and effective_from <= $3::date
     ) as exists`,
    [t.id, recipeId, asOf],
  );
  if (!existed[0].exists) return [];

  const { rows } = await d.query<{
    item_code: string;
    item_name: string;
    uom: string;
    qty: string;
    unit_cost: string | null;
    line_cost: string | null;
    is_costed: boolean;
  }>(
    `select item_code, item_name, uom, qty, unit_cost, line_cost, is_costed
       from recipe_cost_breakdown($1, $2, $3::date)`,
    [t.id, recipeId, asOf],
  );
  return rows;
}

export async function listIngredients() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    uom: string;
    current_cost: string | null;
    effective_from: string | null;
    version_count: string;
  }>(
    `select i.id, i.code, i.name, i.uom,
            v.standard_cost as current_cost,
            v.effective_from::text as effective_from,
            (select count(*)::text from item_cost_versions c
              where c.item_id = i.id) as version_count
       from items i
       left join item_cost_versions v
              on v.item_id = i.id and v.tenant_id = i.tenant_id and v.effective_to is null
      where i.tenant_id = $1 and i.is_active
      order by i.name`,
    [t.id],
  );
  return rows;
}

export async function costHistory(itemId: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    standard_cost: string;
    effective_from: string;
    effective_to: string | null;
    note: string | null;
  }>(
    `select standard_cost, effective_from::text as effective_from,
            effective_to::text as effective_to, note
       from item_cost_versions
      where tenant_id = $1 and item_id = $2
      order by effective_from`,
    [t.id, itemId],
  );
  return rows;
}
