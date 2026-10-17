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
  const departmentGroup = String(formData.get('departmentGroup') ?? 'custom');
  const role = departmentGroup === 'admin' ? 'admin' : String(formData.get('role') ?? 'store_user');
  const allStoresAccess = departmentGroup === 'admin' || formData.get('allStoresAccess') === 'on' || formData.get('allStoresAccess') === 'true';
  const storeId = String(formData.get('storeId') ?? '') || null;
  const assignedStoreIds = formData.getAll('assignedStoreIds').map(String);
  const documentVisibility = String(formData.get('documentVisibility') ?? (allStoresAccess ? 'all' : 'department'));
  const permissions = formData.getAll('permissions').map(String);

  if (!username) return { error: 'Choose a username.' };
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    return { error: 'Use letters, numbers, . _ or - only for the username.' };
  }
  if (!displayName) return { error: 'Enter the person’s name.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (!allStoresAccess && !storeId && assignedStoreIds.length === 0) {
    return { error: 'Choose which store(s) this user has access to.' };
  }

  // Ensure primary storeId is in assignedStoreIds if present
  const finalAssignedStores = Array.from(new Set([...assignedStoreIds, ...(storeId ? [storeId] : [])]));

  try {
    await requireAdmin();
    const d = await db();
    const t = await requireTenant();
    await d.query(
      `insert into users (
         tenant_id, username, password_hash, display_name, role, store_id, permissions,
         department_group, all_stores_access, assigned_store_ids, document_visibility
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        t.id,
        username,
        hashPassword(password),
        displayName,
        role,
        storeId,
        JSON.stringify(departmentGroup === 'admin' ? ['all'] : permissions),
        departmentGroup,
        allStoresAccess,
        JSON.stringify(allStoresAccess ? [] : finalAssignedStores),
        documentVisibility,
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
  const departmentGroup = String(formData.get('departmentGroup') ?? 'custom');
  const role = departmentGroup === 'admin' ? 'admin' : String(formData.get('role') ?? 'store_user');
  const allStoresAccess = departmentGroup === 'admin' || formData.get('allStoresAccess') === 'on' || formData.get('allStoresAccess') === 'true';
  const storeId = String(formData.get('storeId') ?? '') || null;
  const assignedStoreIds = formData.getAll('assignedStoreIds').map(String);
  const documentVisibility = String(formData.get('documentVisibility') ?? (allStoresAccess ? 'all' : 'department'));
  const permissions = formData.getAll('permissions').map(String);

  if (!id) return { error: 'Missing account.' };
  if (!username) return { error: 'Choose a username.' };
  if (!displayName) return { error: 'Enter the person’s name.' };
  if (!allStoresAccess && !storeId && assignedStoreIds.length === 0) {
    return { error: 'Choose which store(s) this user has access to.' };
  }
  if (password && password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const finalAssignedStores = Array.from(new Set([...assignedStoreIds, ...(storeId ? [storeId] : [])]));

  try {
    await requireAdmin();
    const d = await db();
    const t = await requireTenant();
    const permsJson = JSON.stringify(departmentGroup === 'admin' ? ['all'] : permissions);
    const assignedStoresJson = JSON.stringify(allStoresAccess ? [] : finalAssignedStores);

    if (password) {
      await d.query(
        `update users
            set username = $3, display_name = $4, role = $5, store_id = $6,
                password_hash = $7, permissions = $8, department_group = $9,
                all_stores_access = $10, assigned_store_ids = $11, document_visibility = $12
          where tenant_id = $1 and id = $2`,
        [
          t.id,
          id,
          username,
          displayName,
          role,
          storeId,
          hashPassword(password),
          permsJson,
          departmentGroup,
          allStoresAccess,
          assignedStoresJson,
          documentVisibility,
        ],
      );
    } else {
      await d.query(
        `update users
            set username = $3, display_name = $4, role = $5, store_id = $6,
                permissions = $7, department_group = $8, all_stores_access = $9,
                assigned_store_ids = $10, document_visibility = $11
          where tenant_id = $1 and id = $2`,
        [
          t.id,
          id,
          username,
          displayName,
          role,
          storeId,
          permsJson,
          departmentGroup,
          allStoresAccess,
          assignedStoresJson,
          documentVisibility,
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
