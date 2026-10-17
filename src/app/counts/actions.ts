'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/server-db';
import { requireTenant, requireUser, type CurrentUser } from '../../lib/queries';
import {
  createStockCount,
  saveCountedQuantities,
  postStockCount,
  StockCountError,
} from '../../domain/stockCount';

/** An admin counts anywhere; a store user only their own store. */
function assertStoreAccess(user: CurrentUser, storeId: string) {
  if (user.role === 'admin') return;
  if (user.storeId !== storeId) {
    throw new Error('You can only work on counts for your own store.');
  }
}

/**
 * The store a count belongs to - every count action is authorised against
 * this rather than against whatever the form claims, so a guessed count id
 * from another store is rejected.
 */
async function countStore(countId: string, tenantId: string): Promise<string> {
  const d = await db();
  const { rows } = await d.query<{ store_id: string }>(
    `select store_id from stock_counts where id = $1 and tenant_id = $2`,
    [countId, tenantId],
  );
  if (!rows.length) throw new Error('That count does not exist.');
  return rows[0].store_id;
}

export type NewCountState = { error: string | null };

export async function startCount(
  _prev: NewCountState,
  formData: FormData,
): Promise<NewCountState> {
  const storeId = String(formData.get('storeId') ?? '');
  const countDate = String(formData.get('countDate') ?? '');

  if (!storeId) return { error: 'Choose a store.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(countDate)) return { error: 'Choose a count date.' };

  let countId: string;
  try {
    const d = await db();
    const user = await requireUser();
    assertStoreAccess(user, storeId);
    const t = await requireTenant();
    // Counted-by is stamped from the session, not typed by hand.
    const result = await createStockCount(d, t.id, storeId, countDate, user.displayName);
    if (result.lineCount === 0) {
      return { error: 'That store holds no items, so there is nothing to count.' };
    }
    countId = result.countId;
  } catch (err) {
    if (err instanceof StockCountError) {
      return {
        error:
          err.code === 'ALREADY_EXISTS'
            ? `${err.message} Open it from the list below.`
            : err.message,
      };
    }
    return { error: `Could not start the count: ${(err as Error).message}` };
  }

  revalidatePath('/counts');
  redirect(`/counts/${countId}`);
}

export type CountEntryState = { error: string | null; ok?: string };

export async function saveCount(
  _prev: CountEntryState,
  formData: FormData,
): Promise<CountEntryState> {
  const countId = String(formData.get('countId') ?? '');
  if (!countId) return { error: 'No count to save.' };

  const entries: { lineId: string; countedQty: string | null; note: string | null; discrepancyReason?: string | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty_')) continue;
    const lineId = key.slice(4);
    const raw = String(value).trim();
    if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) {
      return { error: `"${raw}" is not a number.` };
    }
    const rawReason = String(formData.get(`reason_${lineId}`) ?? '').trim();
    entries.push({
      lineId,
      countedQty: raw === '' ? null : raw,
      note: (formData.get(`note_${lineId}`) as string | null) ?? null,
      discrepancyReason: rawReason || null,
    });
  }

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();
    assertStoreAccess(user, await countStore(countId, t.id));
    await saveCountedQuantities(d, countId, entries);
  } catch (err) {
    if (err instanceof StockCountError) return { error: err.message };
    return { error: `Could not save: ${(err as Error).message}` };
  }

  revalidatePath(`/counts/${countId}`);
  const counted = entries.filter((e) => e.countedQty !== null).length;
  return { error: null, ok: `Saved. ${counted} of ${entries.length} lines counted.` };
}

export async function postCount(
  _prev: CountEntryState,
  formData: FormData,
): Promise<CountEntryState> {
  const countId = String(formData.get('countId') ?? '');
  if (!countId) return { error: 'No count to post.' };

  try {
    const d = await db();
    const user = await requireUser();
    const t = await requireTenant();
    assertStoreAccess(user, await countStore(countId, t.id));
    const result = await postStockCount(d, countId, user.displayName);
    revalidatePath(`/counts/${countId}`);
    revalidatePath('/counts');
    revalidatePath('/variance');
    revalidatePath('/ledger');

    if (result.alreadyPosted) {
      return { error: null, ok: 'This count was already posted. Nothing changed.' };
    }
    return {
      error: null,
      ok:
        `Posted. ${result.adjustmentsWritten} adjustment${
          result.adjustmentsWritten === 1 ? '' : 's'
        } written across ${result.linesCounted} counted lines, ` +
        `net ${result.netValueAdjustment.toFixed(2)} ETB.`,
    };
  } catch (err) {
    if (err instanceof StockCountError) return { error: err.message };
    return { error: `Could not post: ${(err as Error).message}` };
  }
}
