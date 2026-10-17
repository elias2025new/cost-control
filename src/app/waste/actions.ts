'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/server-db';
import { requireTenant, requireUser, requireAdmin } from '../../lib/queries';
import {
  createWasteLog,
  setWasteLogLines,
  submitWasteLog,
  approveWasteLog,
  rejectWasteLog,
  type WasteReason,
} from '../../domain/wasteLog';

export interface WasteFormState {
  error: string | null;
  ok?: string;
  wasteLogId?: string;
}

export async function createWasteLogAction(
  _prev: WasteFormState,
  formData: FormData,
): Promise<WasteFormState> {
  try {
    const user = await requireUser();
    const tenant = await requireTenant();
    const d = await db();

    const storeId = String(formData.get('storeId') || '');
    const occurredOn = String(formData.get('occurredOn') || '');
    const note = formData.get('note') ? String(formData.get('note')) : null;

    if (!storeId) return { error: 'Please select a store (Kitchen or Bar).' };
    if (!occurredOn) return { error: 'Please choose the occurrence date.' };

    const rawItems = formData.getAll('itemId') as string[];
    const rawQtys = formData.getAll('qty') as string[];
    const rawReasons = formData.getAll('reason') as WasteReason[];
    const rawNotes = formData.getAll('lineNote') as string[];

    const lines = rawItems
      .map((itemId, i) => ({
        itemId,
        qty: rawQtys[i] || '',
        reason: rawReasons[i] || ('spoilage' as WasteReason),
        note: rawNotes[i] || undefined,
      }))
      .filter((l) => l.itemId && l.qty && Number(l.qty) > 0);

    if (lines.length === 0) {
      return { error: 'Add at least one item with a valid quantity.' };
    }

    const { wasteLogId } = await createWasteLog(
      d,
      tenant.id,
      storeId,
      occurredOn,
      note,
      user.uid,
    );

    await setWasteLogLines(d, tenant.id, wasteLogId, lines);

    // Auto-submit if requested
    const shouldSubmit = formData.get('autoSubmit') === 'true';
    if (shouldSubmit) {
      await submitWasteLog(d, tenant.id, wasteLogId);
    }

    revalidatePath('/waste');
    revalidatePath('/ledger');
    return {
      error: null,
      ok: shouldSubmit ? 'Waste log submitted for Controller review.' : 'Waste log saved as draft.',
      wasteLogId,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save waste log.';
    return { error: msg };
  }
}

export async function approveWasteLogAction(wasteLogId: string): Promise<{ error?: string; ok?: string }> {
  try {
    const user = await requireUser();
    const tenant = await requireTenant();
    const d = await db();

    // Controller or Admin signoff
    if (user.role !== 'admin' && !user.permissions?.includes('approve_waste')) {
      return { error: 'Only the F&B Cost Controller or Administrator can approve waste write-offs.' };
    }

    await approveWasteLog(d, tenant.id, wasteLogId, user.uid);

    revalidatePath('/waste');
    revalidatePath(`/waste/${wasteLogId}`);
    revalidatePath('/ledger');
    revalidatePath('/dashboard');
    return { ok: 'Waste log approved and written to the stock ledger.' };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Failed to approve waste log.' };
  }
}

export async function rejectWasteLogAction(
  wasteLogId: string,
  rejectionReason: string,
): Promise<{ error?: string; ok?: string }> {
  try {
    const user = await requireUser();
    const tenant = await requireTenant();
    const d = await db();

    if (user.role !== 'admin' && !user.permissions?.includes('approve_waste')) {
      return { error: 'Only the F&B Cost Controller or Administrator can reject waste logs.' };
    }

    await rejectWasteLog(d, tenant.id, wasteLogId, user.uid, rejectionReason);

    revalidatePath('/waste');
    revalidatePath(`/waste/${wasteLogId}`);
    return { ok: 'Waste log rejected.' };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Failed to reject waste log.' };
  }
}
