'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireUser, requireTenant } from '../../lib/queries';
import {
  createPurchase,
  setPurchaseLines,
  postPurchase,
  PurchaseError,
} from '../../domain/purchaseReceipt';
import type { PurchaseLineInput } from '../../domain/purchaseReceipt';

interface ActionState {
  error: string | null;
}

export async function createPurchaseAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const tenant = await requireTenant();

  const storeId        = formData.get('storeId')?.toString();
  const supplierId     = formData.get('supplierId')?.toString();
  const referenceNumber = formData.get('referenceNumber')?.toString().trim() || null;
  const occurredOn     = formData.get('occurredOn')?.toString();

  if (!storeId || !supplierId || !occurredOn) {
    return { error: 'Store, Supplier, and Date are required.' };
  }

  // Authorisation: only admins and store users belonging to the receiving store
  if (user.role !== 'admin' && user.storeId !== storeId) {
    return { error: 'You are not authorised to receive purchases for this store.' };
  }

  const database = await db();
  let newId: string | undefined;
  try {
    const res = await createPurchase(
      database,
      tenant.id,
      storeId,
      supplierId,
      referenceNumber,
      occurredOn,
      user.uid,
    );
    newId = res.purchaseId;
    revalidatePath('/purchases');
  } catch (err) {
    if (err instanceof PurchaseError) return { error: err.message };
    console.error(err);
    return { error: 'An unexpected error occurred.' };
  }

  // Must redirect outside the try-catch block for Next.js Server Actions
  if (newId) {
    redirect(`/purchases/${newId}`);
  }
  return { error: null };
}

export async function savePurchaseLinesAction(
  purchaseId: string,
  lines: PurchaseLineInput[],
): Promise<ActionState> {
  const user = await requireUser();
  const tenant = await requireTenant();

  const database = await db();
  try {
    const { rows } = await database.query<{ store_id: string }>(
      `select store_id from purchases where id = $1 and tenant_id = $2`,
      [purchaseId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].store_id) {
      return { error: 'You are not authorised to edit purchases for this store.' };
    }

    await setPurchaseLines(database, tenant.id, purchaseId, lines);
    revalidatePath(`/purchases/${purchaseId}`);
    return { error: null };
  } catch (err) {
    if (err instanceof PurchaseError) return { error: err.message };
    console.error(err);
    return { error: 'An unexpected error occurred.' };
  }
}

export async function postPurchaseAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const purchaseId = formData.get('purchaseId')?.toString();

  if (!purchaseId) throw new Error('Missing purchase ID.');

  const database = await db();
  try {
    const { rows } = await database.query<{ store_id: string }>(
      `select store_id from purchases where id = $1 and tenant_id = $2`,
      [purchaseId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].store_id) {
      throw new Error('You are not authorised to post purchases for this store.');
    }

    await postPurchase(database, tenant.id, purchaseId, user.uid);
    revalidatePath('/purchases');
    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath('/ledger');
    revalidatePath('/dashboard');
    return;
  } catch (err) {
    const { PurchaseError } = await import('../../domain/purchaseReceipt');
    if (err instanceof PurchaseError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
}

export async function deletePurchaseAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const purchaseId = formData.get('purchaseId')?.toString();

  if (!purchaseId) throw new Error('Missing purchase ID.');

  const database = await db();
  try {
    const { rows } = await database.query<{ store_id: string }>(
      `select store_id from purchases where id = $1 and tenant_id = $2`,
      [purchaseId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].store_id) {
      throw new Error('You are not authorised to delete purchases for this store.');
    }

    const { deletePurchase } = await import('../../domain/purchaseReceipt');
    await deletePurchase(database, tenant.id, purchaseId);
    
  } catch (err) {
    const { PurchaseError } = await import('../../domain/purchaseReceipt');
    if (err instanceof PurchaseError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
  
  revalidatePath('/purchases');
  redirect('/purchases');
}

export async function reversePurchaseAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const purchaseId = formData.get('purchaseId')?.toString();

  if (!purchaseId) throw new Error('Missing purchase ID.');

  const database = await db();
  try {
    const { rows } = await database.query<{ store_id: string }>(
      `select store_id from purchases where id = $1 and tenant_id = $2`,
      [purchaseId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].store_id) {
      throw new Error('You are not authorised to reverse purchases for this store.');
    }

    const { reversePurchase } = await import('../../domain/purchaseReceipt');
    await reversePurchase(database, tenant.id, purchaseId, user.uid);
    
    revalidatePath('/purchases');
    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath('/ledger');
    revalidatePath('/dashboard');
  } catch (err) {
    const { PurchaseError } = await import('../../domain/purchaseReceipt');
    if (err instanceof PurchaseError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
}

