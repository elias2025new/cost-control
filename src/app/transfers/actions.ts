'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireUser, requireTenant } from '../../lib/queries';
import {
  createTransfer,
  setTransferLines,
  postTransfer,
  deleteTransfer,
  TransferError,
} from '../../domain/transfer';

// ── Create a new draft transfer ───────────────────────────────────────────────
export async function createTransferAction(formData: FormData) {
  const user = await requireUser();
  const tenant = await requireTenant();

  const fromStoreId = formData.get('fromStoreId')?.toString() ?? '';
  const toStoreId   = formData.get('toStoreId')?.toString()   ?? '';
  const occurredOn  = formData.get('occurredOn')?.toString()  ?? '';
  const note        = formData.get('note')?.toString() || null;

  if (!fromStoreId || !toStoreId || !occurredOn) {
    throw new Error('All fields are required.');
  }
  if (fromStoreId === toStoreId) {
    throw new Error('Source and destination stores must be different.');
  }

  const database = await db();
  const { transferId } = await createTransfer(
    database, tenant.id, fromStoreId, toStoreId, occurredOn, note, user.uid,
  );

  revalidatePath('/transfers');
  redirect(`/transfers/${transferId}`);
}

// ── Save lines on a draft transfer ────────────────────────────────────────────
export async function setTransferLinesAction(
  transferId: string,
  lines: { itemId: string; qty: string }[],
): Promise<{ error: string | null }> {
  const tenant = await requireTenant();
  const database = await db();
  try {
    await setTransferLines(database, tenant.id, transferId, lines);
    revalidatePath(`/transfers/${transferId}`);
    return { error: null };
  } catch (err) {
    if (err instanceof TransferError) return { error: err.message };
    console.error(err);
    return { error: 'An unexpected error occurred.' };
  }
}

// ── Post a transfer to the ledger ─────────────────────────────────────────────
export async function postTransferAction(formData: FormData) {
  const user   = await requireUser();
  const tenant = await requireTenant();
  const transferId = formData.get('transferId')?.toString();

  if (!transferId) throw new Error('Missing transfer ID.');

  const database = await db();
  try {
    await postTransfer(database, tenant.id, transferId, user.uid);
    revalidatePath('/transfers');
    revalidatePath(`/transfers/${transferId}`);
    revalidatePath('/ledger');
  } catch (err) {
    if (err instanceof TransferError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }

  redirect(`/transfers/${transferId}`);
}

// ── Delete a draft transfer ───────────────────────────────────────────────────
export async function deleteTransferAction(formData: FormData) {
  const tenant = await requireTenant();
  const transferId = formData.get('transferId')?.toString();

  if (!transferId) throw new Error('Missing transfer ID.');

  const database = await db();
  try {
    await deleteTransfer(database, tenant.id, transferId);
  } catch (err) {
    if (err instanceof TransferError) throw new Error(err.message);
    console.error(err);
    throw new Error('An unexpected error occurred.');
  }

  revalidatePath('/transfers');
  redirect('/transfers');
}
