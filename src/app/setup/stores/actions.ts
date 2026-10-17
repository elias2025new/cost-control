'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type StoreFormState = { error: string | null; ok?: string };

const KINDS = ['main', 'kitchen', 'bar', 'cellar', 'prep', 'outlet'] as const;

export async function createStore(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const branchId = String(formData.get('branchId') ?? '');
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  const description = String(formData.get('description') ?? '').trim() || null;
  const defaultFulfillingStoreId = String(formData.get('defaultFulfillingStoreId') ?? '').trim() || null;

  if (!branchId) return { error: 'Choose a branch.' };
  if (!code) return { error: 'Give the store a code.' };
  if (!name) return { error: 'Give the store a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose a valid store / cost center type.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `insert into stores (tenant_id, branch_id, code, name, kind, description, default_fulfilling_store_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, branchId, code, name, kind, description, defaultFulfillingStoreId],
    );
  } catch (err) {
    return { error: `Could not create the store: ${(err as Error).message}` };
  }

  revalidatePath('/setup/stores');
  revalidatePath('/setup');
  return { error: null, ok: `Store "${name}" created.` };
}

export async function updateStore(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const id = String(formData.get('id') ?? '');
  const branchId = String(formData.get('branchId') ?? '');
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  const description = String(formData.get('description') ?? '').trim() || null;
  const defaultFulfillingStoreId = String(formData.get('defaultFulfillingStoreId') ?? '').trim() || null;

  if (!id) return { error: 'Missing store.' };
  if (!branchId) return { error: 'Choose a branch.' };
  if (!code) return { error: 'Give the store a code.' };
  if (!name) return { error: 'Give the store a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose a valid store / cost center type.' };
  }

  if (defaultFulfillingStoreId === id) {
    return { error: 'A store cannot be its own fulfilling supplier.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `update stores
          set branch_id = $3,
              code = $4,
              name = $5,
              kind = $6,
              description = $7,
              default_fulfilling_store_id = $8
        where tenant_id = $1 and id = $2`,
      [t.id, id, branchId, code, name, kind, description, defaultFulfillingStoreId],
    );
  } catch (err) {
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath('/setup/stores');
  revalidatePath(`/setup/stores/${id}`);
  revalidatePath('/setup');
  revalidatePath('/ledger');
  return { error: null, ok: 'Store settings saved successfully.' };
}

export async function setStoreParLevel(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const storeId = String(formData.get('storeId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const minQty = Number(formData.get('minQty') ?? 0);
  const maxQty = Number(formData.get('maxQty') ?? 0);

  if (!storeId) return { error: 'Missing store.' };
  if (!itemId) return { error: 'Select an inventory item.' };
  if (isNaN(minQty) || minQty < 0) return { error: 'Minimum par quantity must be >= 0.' };
  if (isNaN(maxQty) || maxQty < 0) return { error: 'Maximum par quantity must be >= 0.' };
  if (maxQty > 0 && maxQty < minQty) return { error: 'Max par quantity must be greater than or equal to minimum par.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, store_id, item_id)
       do update set min_qty = excluded.min_qty, max_qty = excluded.max_qty`,
      [t.id, storeId, itemId, minQty, maxQty],
    );
  } catch (err) {
    return { error: `Could not save par level: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/stores/${storeId}`);
  revalidatePath('/setup/stores');
  revalidatePath('/requests');
  return { error: null, ok: 'Par stock level saved.' };
}

export async function deleteStoreParLevel(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const storeId = String(formData.get('storeId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');

  if (!storeId || !itemId) return { error: 'Missing store or item.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `delete from store_item_levels where tenant_id = $1 and store_id = $2 and item_id = $3`,
      [t.id, storeId, itemId],
    );
  } catch (err) {
    return { error: `Could not remove par level: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/stores/${storeId}`);
  revalidatePath('/setup/stores');
  revalidatePath('/requests');
  return { error: null, ok: 'Par stock item removed.' };
}

export async function deleteStore(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing store.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`delete from stores where tenant_id = $1 and id = $2`, [t.id, id]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23503') {
      return {
        error: 'Can’t delete this store - it already has stock movements, counts, or par levels against it.',
      };
    }
    return { error: `Could not delete: ${(err as Error).message}` };
  }

  revalidatePath('/setup/stores');
  revalidatePath('/setup');
  redirect('/setup/stores');
}
