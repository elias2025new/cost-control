'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type BranchFormState = { error: string | null; ok?: string };

export async function createBranch(
  _prev: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!code) return { error: 'Give the branch a code.' };
  if (!name) return { error: 'Give the branch a name.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`insert into branches (tenant_id, code, name) values ($1, $2, $3)`, [
      t.id,
      code,
      name,
    ]);
  } catch (err) {
    return { error: `Could not create the branch: ${(err as Error).message}` };
  }

  revalidatePath('/setup/branches');
  revalidatePath('/setup');
  return { error: null, ok: `Branch "${name}" created.` };
}

export async function updateBranch(
  _prev: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const id = String(formData.get('id') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!id) return { error: 'Missing branch.' };
  if (!code) return { error: 'Give the branch a code.' };
  if (!name) return { error: 'Give the branch a name.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`update branches set code = $3, name = $4 where tenant_id = $1 and id = $2`, [
      t.id,
      id,
      code,
      name,
    ]);
  } catch (err) {
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath('/setup/branches');
  revalidatePath('/setup');
  revalidatePath('/', 'layout');
  return { error: null, ok: 'Saved.' };
}

export async function deleteBranch(
  _prev: BranchFormState,
  formData: FormData,
): Promise<BranchFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing branch.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(`delete from branches where tenant_id = $1 and id = $2`, [t.id, id]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23503') {
      return {
        error: 'Can’t delete this branch - it already has stores or other data under it.',
      };
    }
    return { error: `Could not delete: ${(err as Error).message}` };
  }

  revalidatePath('/setup/branches');
  revalidatePath('/setup');
  redirect('/setup/branches');
}
