'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireUser, requireTenant } from '../../lib/queries';
import {
  createPurchaseRequest,
  setPurchaseRequestLines,
  submitPurchaseRequest,
  resolvePurchaseRequest,
  cancelPurchaseRequest,
  PurchaseRequestError,
} from '../../domain/purchaseRequest';
import type { PurchaseRequestLineInput } from '../../domain/purchaseRequest';

interface ActionState {
  error: string | null;
}

export async function createPurchaseRequestAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const tenant = await requireTenant();

  const requestingStoreId = formData.get('requestingStoreId')?.toString();

  if (!requestingStoreId) {
    return { error: 'Requesting Store is required.' };
  }

  // Auth: only admins and the requesting store users can create requests for that store.
  if (user.role !== 'admin' && user.storeId !== requestingStoreId) {
    return { error: 'You are not authorised to request purchases for this store.' };
  }

  const database = await db();
  let newId: string | undefined;
  try {
    const res = await createPurchaseRequest(database, tenant.id, requestingStoreId, user.uid);
    newId = res.requestId;
    revalidatePath('/purchase-requests');
  } catch (err) {
    if (err instanceof PurchaseRequestError) return { error: err.message };
    console.error(err);
    return { error: 'An unexpected error occurred.' };
  }

  if (newId) {
    redirect(`/purchase-requests/${newId}`);
  }
  return { error: null };
}

export async function savePurchaseRequestLinesAction(
  requestId: string,
  lines: PurchaseRequestLineInput[],
): Promise<ActionState> {
  const user = await requireUser();
  const tenant = await requireTenant();

  const database = await db();
  try {
    const { rows } = await database.query<{ requesting_store_id: string }>(
      `select requesting_store_id from purchase_requests where id = $1 and tenant_id = $2`,
      [requestId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].requesting_store_id) {
      return { error: 'You are not authorised to edit this request.' };
    }

    await setPurchaseRequestLines(database, tenant.id, requestId, lines);
    revalidatePath(`/purchase-requests/${requestId}`);
    return { error: null };
  } catch (err) {
    if (err instanceof PurchaseRequestError) return { error: err.message };
    console.error(err);
    return { error: 'An unexpected error occurred.' };
  }
}

export async function submitPurchaseRequestAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const requestId = formData.get('requestId')?.toString();

  if (!requestId) throw new Error('Missing request ID.');

  const database = await db();
  try {
    const { rows } = await database.query<{ requesting_store_id: string }>(
      `select requesting_store_id from purchase_requests where id = $1 and tenant_id = $2`,
      [requestId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].requesting_store_id) {
      throw new Error('You are not authorised to submit this request.');
    }

    await submitPurchaseRequest(database, tenant.id, requestId);
    revalidatePath('/purchase-requests');
    revalidatePath(`/purchase-requests/${requestId}`);
  } catch (err) {
    if (err instanceof PurchaseRequestError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
}

export async function resolvePurchaseRequestAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const requestId = formData.get('requestId')?.toString();

  if (!requestId) throw new Error('Missing request ID.');

  // Only admins or main store can resolve (purchasing department)
  if (user.role !== 'admin') {
    const database = await db();
    const { rows } = await database.query<{ kind: string }>(
      `select kind from stores where id = $1 and tenant_id = $2`,
      [user.storeId, tenant.id],
    );
    if (!rows.length || rows[0].kind !== 'main') {
      throw new Error('Only the Purchasing Department (Main Store) can resolve requests.');
    }
  }

  const database = await db();
  try {
    await resolvePurchaseRequest(database, tenant.id, requestId);
    revalidatePath('/purchase-requests');
    revalidatePath(`/purchase-requests/${requestId}`);
  } catch (err) {
    if (err instanceof PurchaseRequestError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
}

export async function cancelPurchaseRequestAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();
  const requestId = formData.get('requestId')?.toString();

  if (!requestId) throw new Error('Missing request ID.');

  const database = await db();
  try {
    const { rows } = await database.query<{ requesting_store_id: string }>(
      `select requesting_store_id from purchase_requests where id = $1 and tenant_id = $2`,
      [requestId, tenant.id],
    );
    if (rows.length && user.role !== 'admin' && user.storeId !== rows[0].requesting_store_id) {
      // Main store CAN cancel a request.
      const { rows: userStore } = await database.query<{ kind: string }>(
        `select kind from stores where id = $1`,
        [user.storeId]
      );
      if (!userStore.length || userStore[0].kind !== 'main') {
         throw new Error('You are not authorised to cancel this request.');
      }
    }

    await cancelPurchaseRequest(database, tenant.id, requestId);
    revalidatePath('/purchase-requests');
    revalidatePath(`/purchase-requests/${requestId}`);
  } catch (err) {
    if (err instanceof PurchaseRequestError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }
}
