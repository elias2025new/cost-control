'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type StoreFormState = { error: string | null; ok?: string };

const KINDS = ['main', 'kitchen', 'bar'] as const;

export async function createStore(
  _prev: StoreFormState,
  formData: FormData,
): Promise<StoreFormState> {
  const branchId = String(formData.get('branchId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');

  if (!branchId) return { error: 'Choose a branch.' };
  if (!code) return { error: 'Give the store a code.' };
  if (!name) return { error: 'Give the store a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose whether this is the main store, a kitchen, or a bar.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `insert into stores (tenant_id, branch_id, code, name, kind) values ($1, $2, $3, $4, $5)`,
      [t.id, branchId, code, name, kind],
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
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');

  if (!id) return { error: 'Missing store.' };
  if (!branchId) return { error: 'Choose a branch.' };
  if (!code) return { error: 'Give the store a code.' };
  if (!name) return { error: 'Give the store a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose whether this is the main store, a kitchen, or a bar.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `update stores set branch_id = $3, code = $4, name = $5, kind = $6
        where tenant_id = $1 and id = $2`,
      [t.id, id, branchId, code, name, kind],
    );
  } catch (err) {
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath('/setup/stores');
  revalidatePath('/setup');
  revalidatePath('/ledger');
  return { error: null, ok: 'Saved.' };
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
