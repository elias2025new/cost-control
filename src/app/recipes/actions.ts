'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/server-db';
import { requireTenant, requirePermission } from '../../lib/queries';

export type CostChangeState = { error: string | null; ok?: string };

/**
 * Change an ingredient's standard cost from a date.
 *
 * This never edits the existing cost. set_item_cost() closes the current
 * version at the new effective date and opens a new one, so every report
 * already run against an earlier date returns exactly what it returned before.
 */
export async function changeIngredientCost(
  _prev: CostChangeState,
  formData: FormData,
): Promise<CostChangeState> {
  const itemId = String(formData.get('itemId') ?? '');
  const cost = String(formData.get('cost') ?? '').trim();
  const from = String(formData.get('effectiveFrom') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!itemId) return { error: 'Choose an ingredient.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cost)) return { error: `"${cost}" is not a cost in birr.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: 'Choose the date it takes effect.' };

  try {
    const d = await db();
    await requirePermission('recipe_cost_manage');
    const t = await requireTenant();

    const { rows: current } = await d.query<{ standard_cost: string; effective_from: string }>(
      `select standard_cost, effective_from::text as effective_from
         from item_cost_versions
        where tenant_id = $1 and item_id = $2 and effective_to is null`,
      [t.id, itemId],
    );
    if (current.length && current[0].effective_from >= from) {
      return {
        error:
          `The open cost version already starts on ${current[0].effective_from}. ` +
          `A new version has to start after it - history is never rewritten.`,
      };
    }

    await d.query(`select set_item_cost($1, $2, $3::numeric, $4::date, $5)`, [
      t.id,
      itemId,
      cost,
      from,
      note,
    ]);
  } catch (err) {
    return { error: `Could not record the new cost: ${(err as Error).message}` };
  }

  revalidatePath('/recipes');
  revalidatePath('/');
  return {
    error: null,
    ok: `New cost version recorded from ${from}. Reports dated before then are unchanged.`,
  };
}
