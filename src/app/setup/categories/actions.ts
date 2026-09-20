'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type CategoryFormState = { error: string | null; ok?: string };

const KINDS = ['food', 'beverage', 'other'] as const;

export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');

  if (!code) return { error: 'Give the category a code.' };
  if (!name) return { error: 'Give the category a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose food, beverage, or other.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `insert into item_categories (tenant_id, code, name, kind) values ($1, $2, $3, $4)`,
      [t.id, code, name, kind],
    );
  } catch (err) {
    return { error: `Could not create the category: ${(err as Error).message}` };
  }

  revalidatePath('/setup/categories');
  revalidatePath('/setup');
  return { error: null, ok: `Category "${name}" created.` };
}

export async function updateCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const id = String(formData.get('id') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');

  if (!id) return { error: 'Missing category.' };
  if (!code) return { error: 'Give the category a code.' };
  if (!name) return { error: 'Give the category a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose food, beverage, or other.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `update item_categories set code = $3, name = $4, kind = $5
        where tenant_id = $1 and id = $2`,
      [t.id, id, code, name, kind],
    );
  } catch (err) {
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath('/setup/categories');
  revalidatePath('/setup');
  return { error: null, ok: 'Saved.' };
}

export async function deleteCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing category.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`delete from item_categories where tenant_id = $1 and id = $2`, [t.id, id]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23503') {
      return { error: 'Can’t delete this category - it still has items in it.' };
    }
    return { error: `Could not delete: ${(err as Error).message}` };
  }

  revalidatePath('/setup/categories');
  revalidatePath('/setup');
  redirect('/setup/categories');
}
