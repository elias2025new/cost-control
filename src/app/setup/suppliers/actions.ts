'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireUser, requireTenant } from '../../../lib/queries';

export async function createSupplierAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== 'admin') throw new Error('Only administrators can add suppliers.');

  const tenant = await requireTenant();
  const name    = formData.get('name')?.toString().trim();
  const code    = formData.get('code')?.toString().trim().toUpperCase();
  const contact = formData.get('contact')?.toString().trim() || null;

  if (!name || !code) throw new Error('Name and Code are required.');

  const database = await db();
  await database.query(
    `insert into suppliers (tenant_id, code, name, contact)
     values ($1, $2, $3, $4)`,
    [tenant.id, code, name, contact],
  );

  revalidatePath('/setup/suppliers');
}

export async function toggleSupplierAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== 'admin') throw new Error('Only administrators can edit suppliers.');

  const tenant     = await requireTenant();
  const supplierId = formData.get('supplierId')?.toString();
  const isActive   = formData.get('isActive')?.toString() === 'true';

  if (!supplierId) throw new Error('Missing supplier ID.');

  const database = await db();
  await database.query(
    `update suppliers set is_active = $1 where id = $2 and tenant_id = $3`,
    [!isActive, supplierId, tenant.id],
  );

  revalidatePath('/setup/suppliers');
}
