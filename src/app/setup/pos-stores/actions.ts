'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type CategoryStoreMapFormState = { error: string | null; ok?: string };

/**
 * Always writes is_assumed = false - a human just chose this deliberately,
 * which is what turns the importer's permanent "ASSUMED" default rows into
 * a real, confirmed mapping.
 *
 * The two cases (category-wide default vs. a sub-category override) target
 * different partial unique indexes, so which insert to run depends on
 * whether a sub-category was given.
 */
export async function saveCategoryStoreMap(
  _prev: CategoryStoreMapFormState,
  formData: FormData,
): Promise<CategoryStoreMapFormState> {
  const branchId = String(formData.get('branchId') ?? '');
  const posCategory = String(formData.get('posCategory') ?? '').trim();
  const posSubCategory = String(formData.get('posSubCategory') ?? '').trim() || null;
  const storeId = String(formData.get('storeId') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!branchId) return { error: 'Choose a branch.' };
  if (!posCategory) return { error: 'Give the POS category a name.' };
  if (!storeId) return { error: 'Choose which store this depletes from.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();

    if (posSubCategory) {
      await d.query(
        `insert into pos_category_store_map
           (tenant_id, branch_id, pos_category, pos_sub_category, store_id, is_assumed, note)
         values ($1, $2, $3, $4, $5, false, $6)
         on conflict (tenant_id, branch_id, source, pos_category, pos_sub_category)
           where pos_sub_category is not null
         do update set store_id = excluded.store_id, is_assumed = false, note = excluded.note`,
        [t.id, branchId, posCategory, posSubCategory, storeId, note],
      );
    } else {
      await d.query(
        `insert into pos_category_store_map
           (tenant_id, branch_id, pos_category, pos_sub_category, store_id, is_assumed, note)
         values ($1, $2, $3, null, $4, false, $5)
         on conflict (tenant_id, branch_id, source, pos_category) where pos_sub_category is null
         do update set store_id = excluded.store_id, is_assumed = false, note = excluded.note`,
        [t.id, branchId, posCategory, storeId, note],
      );
    }
  } catch (err) {
    return { error: `Could not save the mapping: ${(err as Error).message}` };
  }

  revalidatePath('/setup/pos-stores');
  revalidatePath('/setup');
  return { error: null, ok: `"${posCategory}" now depletes from the chosen store.` };
}
