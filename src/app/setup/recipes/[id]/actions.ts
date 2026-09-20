'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../../lib/server-db';
import { requireTenant, requirePermission } from '../../../../lib/queries';
import { replaceDraftLines, RecipeAuthoringError } from '../../../../domain/recipeAuthoring';

export type RecipeLinesFormState = { error: string | null; ok?: string };

/**
 * One recipe's full line set, saved together. Rows are client-managed
 * (added/removed with no round trip - see RecipeLinesEditor), so the keys
 * that identify a row on submit come from the form itself: every line
 * posts `component_<key>` (either `item:<id>` or `sub:<id>`), and the key
 * set is read from those.
 */
export async function saveRecipeLines(
  _prev: RecipeLinesFormState,
  formData: FormData,
): Promise<RecipeLinesFormState> {
  const recipeId = String(formData.get('recipeId') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  if (!recipeId || !versionId) return { error: 'Missing recipe.' };

  const keys = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith('component_')) keys.add(key.slice('component_'.length));
  }

  const lines: { componentType: 'item' | 'sub'; componentId: string; qty: string; note?: string }[] =
    [];
  for (const key of keys) {
    const component = String(formData.get(`component_${key}`) ?? '');
    const qty = String(formData.get(`qty_${key}`) ?? '').trim();
    const note = String(formData.get(`note_${key}`) ?? '').trim() || undefined;
    if (!component) continue; // a blank row the user added and never filled in

    const [type, id] = component.split(':');
    if ((type !== 'item' && type !== 'sub') || !id) {
      return { error: 'A line has no ingredient chosen.' };
    }
    if (!/^\d+(\.\d{1,6})?$/.test(qty) || qty === '0') {
      return { error: `"${qty}" is not a quantity greater than zero.` };
    }
    lines.push({ componentType: type, componentId: id, qty, note });
  }

  if (lines.length === 0) return { error: 'Add at least one ingredient.' };

  try {
    const d = await db();
    await requirePermission('recipe_build');
    const t = await requireTenant();
    await replaceDraftLines(d, t.id, versionId, lines);
  } catch (err) {
    if (err instanceof RecipeAuthoringError) return { error: err.message };
    return { error: `Could not save the recipe: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/recipes/${recipeId}`);
  revalidatePath('/setup/recipes');
  revalidatePath('/recipes');
  revalidatePath('/');
  return { error: null, ok: 'Recipe saved.' };
}
