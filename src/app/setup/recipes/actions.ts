'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requirePermission } from '../../../lib/queries';
import { createRecipe, RecipeAuthoringError } from '../../../domain/recipeAuthoring';

export type RecipeFormState = { error: string | null };

export async function createSubRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const batchYieldQty = String(formData.get('batchYieldQty') ?? '').trim();
  const batchYieldUom = String(formData.get('batchYieldUom') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');

  if (!code) return { error: 'Give the sub-recipe a code.' };
  if (!name) return { error: 'Give the sub-recipe a name.' };
  if (!/^\d+(\.\d{1,6})?$/.test(batchYieldQty) || batchYieldQty === '0') {
    return { error: `"${batchYieldQty}" is not a batch yield greater than zero.` };
  }
  if (!batchYieldUom) return { error: 'Give the batch yield a unit (e.g. Kg, Pcs, Portion).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { error: 'Choose the date this recipe takes effect.' };
  }

  let recipeId: string;
  try {
    const d = await db();
    await requirePermission('recipe_build');
    const t = await requireTenant();
    const result = await createRecipe(d, t.id, {
      kind: 'sub',
      code,
      name,
      batchYieldQty,
      batchYieldUom,
      effectiveFrom,
    });
    recipeId = result.recipeId;
  } catch (err) {
    if (err instanceof RecipeAuthoringError) return { error: err.message };
    return { error: `Could not create the sub-recipe: ${(err as Error).message}` };
  }

  revalidatePath('/setup/recipes');
  revalidatePath('/setup');
  redirect(`/setup/recipes/${recipeId}`);
}

export async function createMenuRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const menuItemId = String(formData.get('menuItemId') ?? '');
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');

  if (!code) return { error: 'Give the recipe a code.' };
  if (!name) return { error: 'Give the recipe a name.' };
  if (!menuItemId) return { error: 'Choose the menu item this recipe is for.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { error: 'Choose the date this recipe takes effect.' };
  }

  let recipeId: string;
  try {
    const d = await db();
    await requirePermission('recipe_build');
    const t = await requireTenant();
    const result = await createRecipe(d, t.id, {
      kind: 'menu',
      code,
      name,
      menuItemId,
      effectiveFrom,
    });
    recipeId = result.recipeId;
  } catch (err) {
    if (err instanceof RecipeAuthoringError) return { error: err.message };
    return { error: `Could not create the recipe: ${(err as Error).message}` };
  }

  revalidatePath('/setup/recipes');
  revalidatePath('/setup');
  redirect(`/setup/recipes/${recipeId}`);
}
