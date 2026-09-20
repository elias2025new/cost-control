/**
 * costRecipe(recipeId, asOfDate)
 *
 * Walks the recipe tree down to raw items, prices each at the cost version in
 * force on asOfDate, and returns the cost of one portion with a breakdown.
 *
 * The two things that make this worth having over a spreadsheet:
 *
 *   1. It is as-of. Changing an ingredient cost today creates a new version
 *      and leaves every report already run on an earlier date untouched. The
 *      recipe itself is versioned the same way.
 *
 *   2. It is recursive. A sub-recipe is costed once over its batch and pulled
 *      into its parent at cost per unit, to any depth, and an ingredient
 *      reached by two different branches is counted once with its quantities
 *      summed.
 *
 * There is a second implementation of the same arithmetic in SQL
 * (db/migrations/006_recipe_costing.sql). A test asserts the two agree on
 * every seeded recipe.
 */

import type { Db } from '../lib/db';
import { Decimal, dec, decOrNull, roundMoney, roundQty } from '../lib/money';

export const MAX_RECIPE_DEPTH = 10;

export class RecipeCostError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'RECIPE_NOT_FOUND'
      | 'NO_ACTIVE_VERSION'
      | 'CYCLE'
      | 'DEPTH_EXCEEDED'
      | 'COMPONENT_NOT_SUB_RECIPE',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RecipeCostError';
  }
}

export interface CostLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  /** total quantity of this raw item in one portion, all branches summed */
  qty: Decimal;
  /** null when no cost version was in force on the date */
  unitCost: Decimal | null;
  lineCost: Decimal | null;
  /** how the item was reached, e.g. ['YEAJET KITFO', 'Kitfo Base', 'Niter Kibbeh'] */
  viaPaths: string[][];
}

export interface RecipeCost {
  recipeId: string;
  recipeCode: string;
  recipeName: string;
  kind: 'menu' | 'sub';
  menuItemId: string | null;
  asOfDate: string;
  recipeVersionId: string;
  /** the recipe's quantities are our guess until the client confirms them */
  isSample: boolean;
  /**
   * What the recipe's own lines cost once.
   *
   * For a menu recipe that is one portion. For a sub-recipe it is one BATCH,
   * because a sub-recipe's lines describe a batch. Null when any ingredient
   * has no cost version in force on the date.
   */
  costPerPortion: Decimal | null;
  /**
   * Cost of one unit of what the recipe yields - the figure a parent recipe
   * pulls in. For a sub-recipe that is the batch cost divided by the batch
   * yield; for a menu recipe it is the same as costPerPortion.
   */
  costPerYieldUnit: Decimal | null;
  batchYieldQty: Decimal | null;
  batchYieldUom: string | null;
  /** true when every raw item priced */
  fullyCosted: boolean;
  uncostedItemCodes: string[];
  lines: CostLine[];
  maxDepth: number;
}

interface RecipeRow {
  id: string;
  code: string;
  name: string;
  kind: 'menu' | 'sub';
  menu_item_id: string | null;
  batch_yield_qty: string | null;
  batch_yield_uom: string | null;
  is_sample: boolean;
}

interface LineRow {
  line_no: number;
  component_item_id: string | null;
  component_recipe_id: string | null;
  qty: string;
}

export async function costRecipe(
  db: Db,
  tenantId: string,
  recipeId: string,
  asOfDate: string,
): Promise<RecipeCost> {
  const root = await loadRecipe(db, tenantId, recipeId);

  // Accumulated raw quantities, keyed by item.
  const totals = new Map<string, { qty: Decimal; viaPaths: string[][] }>();
  let maxDepth = 0;
  let rootVersionId = '';

  /**
   * `multiplier` converts one portion of the root recipe into a quantity of
   * this node's batch. A line asking for Q of a sub-recipe whose batch yields
   * Y units consumes Q/Y of that batch, so it compounds down the tree.
   */
  const walk = async (
    recipe: RecipeRow,
    multiplier: Decimal,
    depth: number,
    path: string[],
    seen: string[],
  ): Promise<void> => {
    if (depth > MAX_RECIPE_DEPTH) {
      throw new RecipeCostError(
        `Recipe tree deeper than the ${MAX_RECIPE_DEPTH} level cap at "${recipe.name}".`,
        'DEPTH_EXCEEDED',
        { recipeId: recipe.id, path },
      );
    }
    if (seen.includes(recipe.id)) {
      throw new RecipeCostError(
        `Recipe tree contains a cycle: ${[...path].join(' -> ')} revisits "${recipe.name}".`,
        'CYCLE',
        { recipeId: recipe.id, path },
      );
    }
    maxDepth = Math.max(maxDepth, depth);

    const versionId = await activeVersionId(db, tenantId, recipe.id, asOfDate);
    if (!versionId) {
      throw new RecipeCostError(
        `Recipe "${recipe.name}" (${recipe.code}) has no active version on ${asOfDate}.`,
        'NO_ACTIVE_VERSION',
        { recipeId: recipe.id, recipeCode: recipe.code, asOfDate },
      );
    }
    if (depth === 0) rootVersionId = versionId;

    const { rows: lines } = await db.query<LineRow>(
      `select line_no, component_item_id, component_recipe_id, qty
         from recipe_lines
        where tenant_id = $1 and recipe_version_id = $2
        order by line_no`,
      [tenantId, versionId],
    );

    for (const line of lines) {
      const lineQty = dec(line.qty);

      if (line.component_item_id) {
        const contribution = multiplier.times(lineQty);
        const existing = totals.get(line.component_item_id);
        if (existing) {
          existing.qty = existing.qty.plus(contribution);
          existing.viaPaths.push([...path]);
        } else {
          totals.set(line.component_item_id, { qty: contribution, viaPaths: [[...path]] });
        }
        continue;
      }

      const child = await loadRecipe(db, tenantId, line.component_recipe_id!);
      if (child.kind !== 'sub') {
        throw new RecipeCostError(
          `Recipe line ${line.line_no} of "${recipe.name}" references "${child.name}", ` +
            `which is a menu recipe. Only sub-recipes have a batch yield to divide by.`,
          'COMPONENT_NOT_SUB_RECIPE',
          { recipeId: recipe.id, componentRecipeId: child.id },
        );
      }

      // Q of a sub-recipe whose batch yields Y units == Q/Y of that batch.
      const yieldQty = dec(child.batch_yield_qty);
      const childMultiplier = multiplier.times(lineQty).dividedBy(yieldQty);

      await walk(child, childMultiplier, depth + 1, [...path, child.name], [...seen, recipe.id]);
    }
  };

  await walk(root, new Decimal(1), 0, [root.name], []);

  // Price the exploded items.
  const itemIds = [...totals.keys()];
  const itemRows = itemIds.length
    ? (
        await db.query<{ id: string; code: string; name: string; uom: string; unit_cost: string | null }>(
          `select i.id, i.code, i.name, i.uom,
                  item_cost_on($1, i.id, $3::date) as unit_cost
             from items i
            where i.tenant_id = $1 and i.id = any($2::uuid[])`,
          [tenantId, itemIds, asOfDate],
        )
      ).rows
    : [];

  const lines: CostLine[] = itemRows
    .map((row) => {
      const acc = totals.get(row.id)!;
      const unitCost = decOrNull(row.unit_cost);
      return {
        itemId: row.id,
        itemCode: row.code,
        itemName: row.name,
        uom: row.uom,
        qty: roundQty(acc.qty),
        unitCost,
        lineCost: unitCost === null ? null : roundMoney(acc.qty.times(unitCost)),
        viaPaths: acc.viaPaths,
      };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  const uncosted = lines.filter((l) => l.unitCost === null);
  const fullyCosted = uncosted.length === 0;

  // A partially costed recipe returns null, not a smaller number. A cost that
  // is quietly missing an ingredient looks like an answer and is not one.
  const costPerPortion = fullyCosted
    ? roundMoney(lines.reduce((sum, l) => sum.plus(l.lineCost!), new Decimal(0)))
    : null;

  const batchYieldQty = root.batch_yield_qty === null ? null : dec(root.batch_yield_qty);
  const costPerYieldUnit =
    costPerPortion === null
      ? null
      : batchYieldQty === null || batchYieldQty.isZero()
        ? costPerPortion
        : roundMoney(costPerPortion.dividedBy(batchYieldQty));

  return {
    recipeId: root.id,
    recipeCode: root.code,
    recipeName: root.name,
    kind: root.kind,
    menuItemId: root.menu_item_id,
    asOfDate,
    recipeVersionId: rootVersionId,
    isSample: root.is_sample,
    costPerPortion,
    costPerYieldUnit,
    batchYieldQty,
    batchYieldUom: root.batch_yield_uom,
    fullyCosted,
    uncostedItemCodes: uncosted.map((l) => l.itemCode),
    lines,
    maxDepth,
  };
}

/**
 * One portion of a recipe reduced to raw items only - what actually leaves the
 * shelf. postSalesImport uses this to write depletion movements.
 */
export async function explodeRecipe(
  db: Db,
  tenantId: string,
  recipeId: string,
  asOfDate: string,
  portions: Decimal,
): Promise<Map<string, Decimal>> {
  const cost = await costRecipe(db, tenantId, recipeId, asOfDate);
  const out = new Map<string, Decimal>();
  for (const line of cost.lines) {
    out.set(line.itemId, line.qty.times(portions));
  }
  return out;
}

/* ----------------------------------------------------------------- helpers */

const recipeCache = new WeakMap<object, Map<string, RecipeRow>>();

async function loadRecipe(db: Db, tenantId: string, recipeId: string): Promise<RecipeRow> {
  let perDb = recipeCache.get(db as object);
  if (!perDb) {
    perDb = new Map();
    recipeCache.set(db as object, perDb);
  }
  const key = `${tenantId}:${recipeId}`;
  const hit = perDb.get(key);
  if (hit) return hit;

  const { rows } = await db.query<RecipeRow>(
    `select id, code, name, kind, menu_item_id, batch_yield_qty, batch_yield_uom, is_sample
       from recipes
      where tenant_id = $1 and id = $2`,
    [tenantId, recipeId],
  );
  if (!rows.length) {
    throw new RecipeCostError(`Recipe ${recipeId} not found.`, 'RECIPE_NOT_FOUND', { recipeId });
  }
  perDb.set(key, rows[0]);
  return rows[0];
}

async function activeVersionId(
  db: Db,
  tenantId: string,
  recipeId: string,
  asOfDate: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from recipe_versions
      where tenant_id = $1
        and recipe_id = $2
        and effective_from <= $3::date
        and (effective_to is null or effective_to > $3::date)
      limit 1`,
    [tenantId, recipeId, asOfDate],
  );
  return rows.length ? rows[0].id : null;
}
