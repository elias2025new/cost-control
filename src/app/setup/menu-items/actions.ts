'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';

export type MenuItemFormState = { error: string | null; ok?: string };

const KINDS = ['food', 'beverage', 'other'] as const;

export async function createMenuItem(
  _prev: MenuItemFormState,
  formData: FormData,
): Promise<MenuItemFormState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  const uom = String(formData.get('uom') ?? '').trim() || 'Portion';

  if (!code) return { error: 'Give the menu item a code.' };
  if (!name) return { error: 'Give the menu item a name.' };
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: 'Choose food, beverage, or other.' };
  }

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await d.query(
      `insert into menu_items (tenant_id, code, name, kind, uom) values ($1, $2, $3, $4, $5)`,
      [t.id, code, name, kind, uom],
    );
  } catch (err) {
    return { error: `Could not create the menu item: ${(err as Error).message}` };
  }

  revalidatePath('/setup/menu-items');
  revalidatePath('/setup');
  return { error: null, ok: `Menu item "${name}" created.` };
}
