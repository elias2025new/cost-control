/**
 * Recipe authoring - creating recipes and versioning their lines through the
 * UI, rather than the seed script's hand-ordered array.
 *
 * Design rule 3 applies to recipes exactly as it does to item costs:
 * changing a recipe today must not change last month's report. A version
 * that has already been live is never edited in place - createRecipeVersion
 * closes it and opens a new one, mirroring set_item_cost(). Only a version
 * that has never been live (its first version, still at version_no 1, or a
 * version whose effective_from hasn't arrived yet) may have its lines
 * replaced directly - that is what lets a recipe be composed interactively
 * in the UI without spawning a version per edit.
 *
 * A sub-recipe must exist before a parent can reference it as a line. In the
 * UI this holds by construction: a line's component picker only ever offers
 * recipes that already exist in the database, so there is nothing here that
 * re-implements the seed script's hand-ordering discipline.
 */

import type { Database, Tx } from '../lib/db';
import { qtyParam } from '../lib/money';

export class RecipeAuthoringError extends Error {
  constructor(
    message: string,
    readonly code: 'DUPLICATE_CODE' | 'ALREADY_LIVE' | 'INVALID_COMPONENT' | 'RECIPE_NOT_FOUND',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RecipeAuthoringError';
  }
}

export interface RecipeLineInput {
  componentType: 'item' | 'sub';
  componentId: string;
  qty: string;
  note?: string;
}

export interface CreateRecipeInput {
  kind: 'menu' | 'sub';
  code: string;
  name: string;
  menuItemId?: string;
  batchYieldQty?: string;
  batchYieldUom?: string;
  effectiveFrom: string;
  lines?: RecipeLineInput[];
}

export interface CreateRecipeResult {
  recipeId: string;
  versionId: string;
}

async function insertLines(
  tx: Tx,
  tenantId: string,
  versionId: string,
  lines: RecipeLineInput[],
) {
  let lineNo = 0;
  for (const line of lines) {
    await tx.query(
      `insert into recipe_lines
         (tenant_id, recipe_version_id, line_no, component_item_id, component_recipe_id, qty, note)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        versionId,
        ++lineNo,
        line.componentType === 'item' ? line.componentId : null,
        line.componentType === 'sub' ? line.componentId : null,
        qtyParam(line.qty),
        line.note ?? null,
      ],
    );
  }
}

export async function createRecipe(
  db: Database,
  tenantId: string,
  input: CreateRecipeInput,
): Promise<CreateRecipeResult> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into recipes
         (tenant_id, code, name, kind, menu_item_id, batch_yield_qty, batch_yield_uom)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        tenantId,
        input.code,
        input.name,
        input.kind,
        input.kind === 'menu' ? (input.menuItemId ?? null) : null,
        input.kind === 'sub' ? (input.batchYieldQty ?? null) : null,
        input.kind === 'sub' ? (input.batchYieldUom ?? null) : null,
      ],
    );
    const recipeId = rows[0].id;

    const { rows: vrows } = await tx.query<{ id: string }>(
      `insert into recipe_versions (tenant_id, recipe_id, version_no, effective_from)
       values ($1, $2, 1, $3::date) returning id`,
      [tenantId, recipeId, input.effectiveFrom],
    );
    const versionId = vrows[0].id;

    if (input.lines?.length) await insertLines(tx, tenantId, versionId, input.lines);

    return { recipeId, versionId };
  });
}

export interface CreateRecipeVersionInput {
  effectiveFrom: string;
  note?: string;
  lines: RecipeLineInput[];
}

/** Closes the currently open version at effectiveFrom, opens a new one with fresh lines. */
export async function createRecipeVersion(
  db: Database,
  tenantId: string,
  recipeId: string,
  input: CreateRecipeVersionInput,
): Promise<{ versionId: string }> {
  return db.transaction(async (tx) => {
    const { rows: current } = await tx.query<{ id: string; version_no: number }>(
      `select id, version_no from recipe_versions
        where tenant_id = $1 and recipe_id = $2 and effective_to is null`,
      [tenantId, recipeId],
    );
    if (!current.length) {
      throw new RecipeAuthoringError(`Recipe ${recipeId} has no open version.`, 'RECIPE_NOT_FOUND', {
        recipeId,
      });
    }

    await tx.query(
      `update recipe_versions set effective_to = $3
        where tenant_id = $1 and id = $2`,
      [tenantId, current[0].id, input.effectiveFrom],
    );

    const { rows: vrows } = await tx.query<{ id: string }>(
      `insert into recipe_versions (tenant_id, recipe_id, version_no, effective_from, note)
       values ($1, $2, $3, $4::date, $5) returning id`,
      [tenantId, recipeId, current[0].version_no + 1, input.effectiveFrom, input.note ?? null],
    );
    const versionId = vrows[0].id;

    await insertLines(tx, tenantId, versionId, input.lines);

    return { versionId };
  });
}

/**
 * In-place line replace - only when the target version has never been live:
 * still its first version, or its effective date hasn't arrived yet.
 * Anything else must go through createRecipeVersion instead.
 */
export async function replaceDraftLines(
  db: Database,
  tenantId: string,
  recipeVersionId: string,
  lines: RecipeLineInput[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ version_no: number; effective_from: string }>(
      `select version_no, effective_from::text as effective_from from recipe_versions
        where tenant_id = $1 and id = $2`,
      [tenantId, recipeVersionId],
    );
    if (!rows.length) {
      throw new RecipeAuthoringError(
        `Recipe version ${recipeVersionId} not found.`,
        'RECIPE_NOT_FOUND',
      );
    }
    const { version_no, effective_from } = rows[0];
    const { rows: today } = await tx.query<{ today: string }>(
      `select current_date::text as today`,
    );
    const isDraft = version_no === 1 || effective_from > today[0].today;
    if (!isDraft) {
      throw new RecipeAuthoringError(
        'This version has already taken effect. Record a new version instead of editing this one.',
        'ALREADY_LIVE',
        { recipeVersionId },
      );
    }

    await tx.query(`delete from recipe_lines where tenant_id = $1 and recipe_version_id = $2`, [
      tenantId,
      recipeVersionId,
    ]);
    if (lines.length) await insertLines(tx, tenantId, recipeVersionId, lines);
  });
}
