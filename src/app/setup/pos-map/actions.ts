'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type ArticleMapFormState = { error: string | null; ok?: string };

const FLAGS = ['normal', 'generic', 'test', 'free_comp'] as const;

/**
 * One row per POS article, all saved together - the same bulk-save shape as
 * CountSheet.tsx: fields keyed by row id, grouped out of FormData. Row ids
 * come from the `flag_<id>` keys (always present, a <select>), rather than
 * a separately posted list, since that is already exactly the set of rows
 * the form rendered.
 */
export async function saveArticleMappings(
  _prev: ArticleMapFormState,
  formData: FormData,
): Promise<ArticleMapFormState> {
  const rowIds = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith('flag_')) rowIds.add(key.slice(5));
  }
  if (rowIds.size === 0) return { error: 'Nothing to save.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();

    await d.transaction(async (tx) => {
      for (const id of rowIds) {
        const flag = String(formData.get(`flag_${id}`) ?? 'normal');
        if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
          throw new Error(`"${flag}" is not a valid flag.`);
        }
        const menuItemId = String(formData.get(`menuItem_${id}`) ?? '') || null;
        const depletes = formData.get(`depletes_${id}`) === 'on';
        const countsAsSale = formData.get(`countsAsSale_${id}`) === 'on';
        const note = String(formData.get(`note_${id}`) ?? '').trim() || null;

        await tx.query(
          `update pos_item_map
              set menu_item_id = $3, article_flag = $4, depletes = $5,
                  counts_as_sale = $6, note = $7, updated_at = now()
            where tenant_id = $1 and id = $2`,
          [t.id, id, flag === 'generic' ? null : menuItemId, flag, depletes, countsAsSale, note],
        );
      }
    });
  } catch (err) {
    return { error: `Could not save the mapping: ${(err as Error).message}` };
  }

  revalidatePath('/setup/pos-map');
  revalidatePath('/setup');
  return { error: null, ok: 'Article mapping saved.' };
}
