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

export async function addSupplierPriceAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== 'admin' && !user.permissions?.includes('po_create')) {
    throw new Error('You do not have permission to edit supplier price catalogs.');
  }

  const tenant = await requireTenant();
  const supplierId = String(formData.get('supplierId') ?? '').trim();
  const itemId = String(formData.get('itemId') ?? '').trim();
  const purchaseUom = String(formData.get('purchaseUom') ?? '').trim();
  const packFactor = String(formData.get('packFactor') ?? '1.0').trim();
  const contractPrice = String(formData.get('contractPrice') ?? '0.0').trim();
  const minOrderQty = String(formData.get('minOrderQty') ?? '1.0').trim();
  const leadTimeDays = Number(formData.get('leadTimeDays') ?? 1);
  const isPreferred = formData.get('isPreferred') === 'on' || formData.get('isPreferred') === 'true';

  if (!supplierId || !itemId || !purchaseUom) {
    throw new Error('Item and Purchase Packaging UOM are required.');
  }
  if (Number(packFactor) <= 0) {
    throw new Error('Pack factor must be greater than 0.');
  }
  if (Number(contractPrice) < 0) {
    throw new Error('Contract price cannot be negative.');
  }

  const database = await db();
  await database.query(
    `insert into supplier_item_prices
       (tenant_id, supplier_id, item_id, purchase_uom, pack_factor, contract_price,
        min_order_qty, lead_time_days, is_preferred)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (tenant_id, supplier_id, item_id, purchase_uom)
     do update set
       pack_factor = excluded.pack_factor,
       contract_price = excluded.contract_price,
       min_order_qty = excluded.min_order_qty,
       lead_time_days = excluded.lead_time_days,
       is_preferred = excluded.is_preferred`,
    [
      tenant.id,
      supplierId,
      itemId,
      purchaseUom,
      packFactor,
      contractPrice,
      minOrderQty,
      leadTimeDays,
      isPreferred,
    ],
  );

  revalidatePath(`/setup/suppliers/${supplierId}`);
  revalidatePath('/setup/suppliers');
}

export async function deleteSupplierPriceAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== 'admin') {
    throw new Error('Only administrators can remove price catalog items.');
  }

  const tenant = await requireTenant();
  const priceId = String(formData.get('priceId') ?? '').trim();
  const supplierId = String(formData.get('supplierId') ?? '').trim();

  if (!priceId) throw new Error('Missing price ID.');

  const database = await db();
  await database.query(
    `delete from supplier_item_prices where id = $1 and tenant_id = $2`,
    [priceId, tenant.id],
  );

  if (supplierId) {
    revalidatePath(`/setup/suppliers/${supplierId}`);
  }
  revalidatePath('/setup/suppliers');
}

