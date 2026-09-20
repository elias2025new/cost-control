'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireTenant, requireUser } from '../../../lib/queries';
import { fulfillIssueRequest, IssueRequestError } from '../../../domain/issueRequest';

export type FulfillFormState = { error: string | null; ok?: string };

const QTY = /^\d+(\.\d{1,6})?$/;

export async function fulfillRequest(
  _prev: FulfillFormState,
  formData: FormData,
): Promise<FulfillFormState> {
  const requestId = String(formData.get('requestId') ?? '');
  if (!requestId) return { error: 'No request to release.' };

  const lines: { lineId: string; fulfilledQty: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty_')) continue;
    const lineId = key.slice(4);
    const raw = String(value).trim() || '0';
    if (!QTY.test(raw)) return { error: `"${raw}" is not a quantity.` };
    lines.push({ lineId, fulfilledQty: raw });
  }
  if (lines.length === 0) return { error: 'Nothing to release.' };

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();
    const result = await fulfillIssueRequest(d, t.id, requestId, lines, {
      userId: user.uid,
      role: user.role,
      storeId: user.storeId,
      name: user.displayName,
    });

    revalidatePath(`/requests/${requestId}`);
    revalidatePath('/requests');
    revalidatePath('/ledger');

    if (result.alreadyFulfilled) {
      return { error: null, ok: 'This request was already released. Nothing changed.' };
    }
    return {
      error: null,
      ok:
        `Released. ${result.linesReleased} line${result.linesReleased === 1 ? '' : 's'} moved, ` +
        `${result.totalValue.toFixed(2)} ETB of stock.`,
    };
  } catch (err) {
    if (err instanceof IssueRequestError) return { error: err.message };
    return { error: `Could not release: ${(err as Error).message}` };
  }
}
