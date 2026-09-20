'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireTenant } from '../../lib/queries';
import {
  verifyPassword,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../../lib/session';

export type LoginFormState = { error: string | null };

export async function login(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!username) return { error: 'Enter your username.' };
  if (!password) return { error: 'Enter your password.' };

  let redirectTo: string;
  try {
    const d = await db();
    const t = await requireTenant();
    const { rows } = await d.query<{
      id: string;
      password_hash: string;
      display_name: string;
      role: 'admin' | 'store_user';
      store_id: string | null;
      is_active: boolean;
      permissions: string[];
    }>(
      `select id, password_hash, display_name, role, store_id, is_active, permissions
         from users where tenant_id = $1 and username = $2`,
      [t.id, username],
    );
    const user = rows[0];
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      return { error: 'Wrong username or password.' };
    }

    const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
    const cookieValue = signSession({
      uid: user.id,
      tenantId: t.id,
      role: user.role,
      storeId: user.store_id,
      displayName: user.display_name,
      permissions: user.permissions || [],
      exp,
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    });

    redirectTo = user.role === 'admin' ? '/' : '/requests';
  } catch (err) {
    return { error: `Could not sign in: ${(err as Error).message}` };
  }

  redirect(redirectTo);
}

export async function logout(_formData: FormData): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
