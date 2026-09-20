'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/server-db';
import { requireTenant, requireAdmin } from '../../../lib/queries';
import { postOpeningStock, OpeningStockError } from '../../../domain/openingStock';

export type OpeningStockFormState = { error: string | null; ok?: string };

export async function recordOpeningStock(
  _prev: OpeningStockFormState,
  formData: FormData,
): Promise<OpeningStockFormState> {
  const storeId = String(formData.get('storeId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const qty = String(formData.get('qty') ?? '').trim();
  const unitCost = String(formData.get('unitCost') ?? '').trim();
  const occurredOn = String(formData.get('occurredOn') ?? '');
  const note = String(formData.get('note') ?? '').trim() || undefined;

  if (!storeId) return { error: 'Choose a store.' };
  if (!itemId) return { error: 'Choose an item.' };
  if (!/^\d+(\.\d{1,6})?$/.test(qty) || qty === '0') {
    return { error: `"${qty}" is not a quantity greater than zero.` };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(unitCost)) {
    return { error: `"${unitCost}" is not a cost in birr.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return { error: 'Choose a date.' };

  try {
    const d = await db();
    await requireAdmin();
    const t = await requireTenant();
    await postOpeningStock(d, t.id, storeId, itemId, qty, unitCost, occurredOn, note);
  } catch (err) {
    if (err instanceof OpeningStockError) return { error: err.message };
    return { error: `Could not record opening stock: ${(err as Error).message}` };
  }

  revalidatePath('/setup/opening-stock');
  revalidatePath('/setup');
  revalidatePath('/ledger');
  return { error: null, ok: 'Opening stock recorded.' };
}
