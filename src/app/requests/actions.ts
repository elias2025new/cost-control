'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireTenant, requireUser } from '../../lib/queries';
import {
  createIssueRequest,
  cancelIssueRequest,
  IssueRequestError,
} from '../../domain/issueRequest';

export type RequestFormState = { error: string | null; ok?: string };

const QTY = /^\d+(\.\d{1,6})?$/;

export async function createRequest(
  _prev: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const storeId = String(formData.get('storeId') ?? '');
  const note = String(formData.get('note') ?? '').trim() || undefined;

  if (!storeId) return { error: 'Choose which store is asking.' };

  // Rows are client-managed (add/remove with no round trip), so the key set
  // comes from the form itself - same shape as RecipeLinesEditor.
  const keys = new Set<string>();
  for (const key of formData.keys()) {
    if (key.startsWith('item_')) keys.add(key.slice('item_'.length));
  }

  const lines: { itemId: string; qty: string; note?: string }[] = [];
  for (const key of keys) {
    const itemId = String(formData.get(`item_${key}`) ?? '');
    const qty = String(formData.get(`qty_${key}`) ?? '').trim();
    const lineNote = String(formData.get(`note_${key}`) ?? '').trim() || undefined;
    if (!itemId) continue; // a blank row the user added and never filled in
    if (!QTY.test(qty) || qty === '0') {
      return { error: `"${qty}" is not a quantity greater than zero.` };
    }
    lines.push({ itemId, qty, note: lineNote });
  }
  if (lines.length === 0) return { error: 'Add at least one item to request.' };

  let requestId: string;
  try {
    const d = await db();
    const user = await requireUser();
    if (user.role !== 'admin' && user.storeId !== storeId) {
      return { error: 'You can only request stock for your own store.' };
    }
    const t = await requireTenant();
    const result = await createIssueRequest(d, t.id, storeId, lines, user.uid, note);
    requestId = result.requestId;
  } catch (err) {
    if (err instanceof IssueRequestError) return { error: err.message };
    return { error: `Could not create the request: ${(err as Error).message}` };
  }

  revalidatePath('/requests');
  redirect(`/requests/${requestId}`);
}

export async function cancelRequest(
  _prev: RequestFormState,
  formData: FormData,
): Promise<RequestFormState> {
  const requestId = String(formData.get('requestId') ?? '');
  if (!requestId) return { error: 'No request to cancel.' };

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();
    await cancelIssueRequest(d, t.id, requestId, { role: user.role, storeId: user.storeId });
  } catch (err) {
    if (err instanceof IssueRequestError) return { error: err.message };
    return { error: `Could not cancel: ${(err as Error).message}` };
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath('/requests');
  return { error: null, ok: 'Request cancelled.' };
}
