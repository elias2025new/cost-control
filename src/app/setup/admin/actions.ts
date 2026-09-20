'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/server-db';
import { requireTenant } from '../../../lib/queries';
import {
  hashPassword,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../../../lib/session';

export type CreateAdminFormState = { error: string | null };

export async function createAdmin(
  _prev: CreateAdminFormState,
  formData: FormData,
): Promise<CreateAdminFormState> {
  const username = String(formData.get('username') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!username) return { error: 'Choose a username.' };
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    return { error: 'Use letters, numbers, . _ or - only for the username.' };
  }
  if (!displayName) return { error: 'Enter your name.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };

  let redirectTo: string;
  try {
    const d = await db();
    const t = await requireTenant();

    const { rows: existing } = await d.query<{ n: string }>(
      `select count(*)::text as n from users where tenant_id = $1`,
      [t.id],
    );
    if (existing[0].n !== '0') {
      return { error: 'An admin account already exists - sign in instead.' };
    }

    const { rows } = await d.query<{ id: string }>(
      `insert into users (tenant_id, username, password_hash, display_name, role)
       values ($1, $2, $3, $4, 'admin') returning id`,
      [t.id, username, hashPassword(password), displayName],
    );

    const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
    const cookieValue = signSession({
      uid: rows[0].id,
      tenantId: t.id,
      role: 'admin',
      storeId: null,
      displayName,
      permissions: ['all'],
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

    redirectTo = '/';
  } catch (err) {
    return { error: `Could not create the admin account: ${(err as Error).message}` };
  }

  redirect(redirectTo);
}
