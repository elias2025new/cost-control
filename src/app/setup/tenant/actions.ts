'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { currentTenant } from '../../../lib/queries';

export type TenantFormState = { error: string | null };

export async function createTenant(
  _prev: TenantFormState,
  formData: FormData,
): Promise<TenantFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();

  if (!code) return { error: 'Give the tenant a short code.' };
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return { error: 'Use letters, numbers, - or _ only for the code.' };
  }
  if (!name) return { error: 'Give the tenant a name.' };

  try {
    const existing = await currentTenant();
    if (existing) return { error: 'A tenant already exists.' };

    const d = await db();
    await d.query(`insert into tenants (code, name) values ($1, $2)`, [code, name]);
  } catch (err) {
    return { error: `Could not create the tenant: ${(err as Error).message}` };
  }

  revalidatePath('/', 'layout');
  redirect('/setup');
}

/**
 * Loads the same fixture the test suite runs against (db/seed/seed.ts), so
 * there is never a second, drifting definition of "the demo data." Guarded
 * to an empty database: currentTenant() picks "first tenant by created_at,"
 * so a second tenant would just be silent, unreachable data.
 */
export async function loadDemoData(
  _prev: TenantFormState,
  _formData: FormData,
): Promise<TenantFormState> {
  try {
    const existing = await currentTenant();
    if (existing) {
      return {
        error: 'A tenant already exists - demo data can only be loaded into an empty database.',
      };
    }

    const d = await db();
    const { seed } = await import('../../../../db/seed/seed');
    await seed(d, { quiet: true });
  } catch (err) {
    return { error: `Could not load demo data: ${(err as Error).message}` };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}
