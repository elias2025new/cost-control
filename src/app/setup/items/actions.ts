'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type ItemFormState = { error: string | null; ok?: string };

export async function createItem(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '');
  const uom = String(formData.get('uom') ?? '').trim();
  const cost = String(formData.get('cost') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');

  if (!code) return { error: 'Give the item a code.' };
  if (!name) return { error: 'Give the item a name.' };
  if (!categoryId) return { error: 'Choose a category.' };
  if (!uom) return { error: 'Give the item a unit of measure.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cost)) return { error: `"${cost}" is not a cost in birr.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { error: 'Choose the date this cost takes effect.' };
  }

  let itemId: string;
  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    itemId = await d.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into items (tenant_id, code, name, category_id, uom)
         values ($1, $2, $3, $4, $5) returning id`,
        [t.id, code, name, categoryId, uom],
      );
      // set_item_cost() closes any open version and opens a new one - for a
      // brand-new item there is nothing to close, so it is exactly right for
      // the FIRST cost too. No separate insert path needed.
      await tx.query(`select set_item_cost($1, $2, $3::numeric, $4::date, $5)`, [
        t.id,
        rows[0].id,
        cost,
        effectiveFrom,
        'opening cost',
      ]);
      return rows[0].id;
    });
  } catch (err) {
    return { error: `Could not create the item: ${(err as Error).message}` };
  }

  revalidatePath('/setup/items');
  revalidatePath('/setup');
  redirect(`/setup/items/${itemId}`);
}

export async function updateItem(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const id = String(formData.get('id') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '');
  const uom = String(formData.get('uom') ?? '').trim();

  if (!id) return { error: 'Missing item.' };
  if (!code) return { error: 'Give the item a code.' };
  if (!name) return { error: 'Give the item a name.' };
  if (!categoryId) return { error: 'Choose a category.' };
  if (!uom) return { error: 'Give the item a unit of measure.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    // Only identity fields - cost stays versioned via set_item_cost(),
    // never touched here.
    await d.query(
      `update items set code = $3, name = $4, category_id = $5, uom = $6
        where tenant_id = $1 and id = $2`,
      [t.id, id, code, name, categoryId, uom],
    );
  } catch (err) {
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/items/${id}`);
  revalidatePath('/setup/items');
  revalidatePath('/setup');
  revalidatePath('/recipes');
  revalidatePath('/');
  return { error: null, ok: 'Saved.' };
}

export async function deleteItem(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing item.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`delete from items where tenant_id = $1 and id = $2`, [t.id, id]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23503') {
      return {
        error:
          'Can’t delete this item - it’s already used in a recipe, stock movement, or count.',
      };
    }
    return { error: `Could not delete: ${(err as Error).message}` };
  }

  revalidatePath('/setup/items');
  revalidatePath('/setup');
  redirect('/setup/items');
}

export type ParLevelFormState = { error: string | null; ok?: string };

const QTY = /^\d+(\.\d{1,6})?$/;

/**
 * One row per store, all saved together - the same bulk-save shape as
 * CountSheet.tsx: fields keyed by store id (`min_<storeId>`/`max_<storeId>`),
 * grouped out of FormData rather than one form per row (a <form> cannot
 * legally wrap individual <tr> children).
 */
export async function saveParLevels(
  _prev: ParLevelFormState,
  formData: FormData,
): Promise<ParLevelFormState> {
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return { error: 'Missing item.' };

  const storeIds = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith('min_')) storeIds.add(key.slice(4));
  }

  const rows: { storeId: string; minQty: string; maxQty: string }[] = [];
  for (const storeId of storeIds) {
    const minQty = String(formData.get(`min_${storeId}`) ?? '0').trim() || '0';
    const maxQty = String(formData.get(`max_${storeId}`) ?? '0').trim() || '0';
    if (!QTY.test(minQty)) return { error: `"${minQty}" is not a quantity.` };
    if (!QTY.test(maxQty)) return { error: `"${maxQty}" is not a quantity.` };
    rows.push({ storeId, minQty, maxQty });
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.transaction(async (tx) => {
      for (const r of rows) {
        await tx.query(
          `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
           values ($1, $2, $3, $4::numeric, $5::numeric)
           on conflict (tenant_id, store_id, item_id)
           do update set min_qty = excluded.min_qty, max_qty = excluded.max_qty`,
          [t.id, r.storeId, itemId, r.minQty, r.maxQty],
        );
      }
    });
  } catch (err) {
    return { error: `Could not save par levels: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/items/${itemId}`);
  return { error: null, ok: 'Par levels saved.' };
}
