'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant, requireUser } from '../../../lib/queries';
import { hashPassword } from '../../../lib/session';

export type UserFormState = { error: string | null; ok?: string };

/**
 * Managing accounts is admin-only, checked here rather than relying on
 * proxy.ts's path matcher - per Next's own guidance, a Server Action is
 * reachable independently of the route protection in front of the page
 * that renders its form.
 */
async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== 'admin') throw new Error('Only an administrator can manage accounts.');
  return u;
}

export async function createUser(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  const username = String(formData.get('username') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role') ?? '');
  const storeId = String(formData.get('storeId') ?? '') || null;
  const permissions = formData.getAll('permissions').map(String);

  if (!username) return { error: 'Choose a username.' };
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    return { error: 'Use letters, numbers, . _ or - only for the username.' };
  }
  if (!displayName) return { error: 'Enter the person’s name.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (role !== 'admin' && role !== 'store_user') return { error: 'Choose a role.' };
  if (role === 'store_user' && !storeId) return { error: 'Choose which store this user works in.' };

  try {
    await requireAdmin();
    const d = await db();
    const t = await requireTenant();
    await d.query(
      `insert into users (tenant_id, username, password_hash, display_name, role, store_id, permissions)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        t.id,
        username,
        hashPassword(password),
        displayName,
        role,
        role === 'store_user' ? storeId : null,
        JSON.stringify(role === 'store_user' ? permissions : []),
      ],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') return { error: `The username "${username}" is already taken.` };
    return { error: `Could not create the account: ${(err as Error).message}` };
  }

  revalidatePath('/setup/users');
  revalidatePath('/setup');
  return { error: null, ok: `Account for ${displayName} created.` };
}

export async function updateUser(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  const id = String(formData.get('id') ?? '');
  const username = String(formData.get('username') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role') ?? '');
  const storeId = String(formData.get('storeId') ?? '') || null;
  const permissions = formData.getAll('permissions').map(String);

  if (!id) return { error: 'Missing account.' };
  if (!username) return { error: 'Choose a username.' };
  if (!displayName) return { error: 'Enter the person’s name.' };
  if (role !== 'admin' && role !== 'store_user') return { error: 'Choose a role.' };
  if (role === 'store_user' && !storeId) return { error: 'Choose which store this user works in.' };
  // Blank password means "leave it as it is" - the form never round-trips
  // the existing hash, so there is nothing to accidentally overwrite with.
  if (password && password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  try {
    await requireAdmin();
    const d = await db();
    const t = await requireTenant();
    if (password) {
      await d.query(
        `update users set username = $3, display_name = $4, role = $5, store_id = $6,
                          password_hash = $7, permissions = $8
          where tenant_id = $1 and id = $2`,
        [
          t.id,
          id,
          username,
          displayName,
          role,
          role === 'store_user' ? storeId : null,
          hashPassword(password),
          JSON.stringify(role === 'store_user' ? permissions : []),
        ],
      );
    } else {
      await d.query(
        `update users set username = $3, display_name = $4, role = $5, store_id = $6, permissions = $7
          where tenant_id = $1 and id = $2`,
        [
          t.id,
          id,
          username,
          displayName,
          role,
          role === 'store_user' ? storeId : null,
          JSON.stringify(role === 'store_user' ? permissions : []),
        ],
      );
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') return { error: `The username "${username}" is already taken.` };
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/users/${id}`);
  revalidatePath('/setup/users');
  return { error: null, ok: 'Saved.' };
}

/**
 * Deactivate rather than delete. An account that has ever acted is
 * referenced by issue requests and counts almost immediately, so a delete
 * button would reliably fail - and the audit trail is worth keeping anyway.
 */
export async function setUserActive(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const id = String(formData.get('id') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!id) return { error: 'Missing account.' };

  try {
    const me = await requireAdmin();
    if (id === me.uid && !active) {
      return { error: 'You can’t deactivate your own account while signed in with it.' };
    }
    const d = await db();
    const t = await requireTenant();
    await d.query(`update users set is_active = $3 where tenant_id = $1 and id = $2`, [
      t.id,
      id,
      active,
    ]);
  } catch (err) {
    return { error: `Could not update the account: ${(err as Error).message}` };
  }

  revalidatePath(`/setup/users/${id}`);
  revalidatePath('/setup/users');
  redirect('/setup/users');
}
