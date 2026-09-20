/**
 * Opening stock - the first quantity of an item a store ever holds.
 *
 * A dedicated movement_type = 'opening' row, deliberately not 'receipt'.
 * 'receipt' is reserved for the real future purchasing/receiving flow; using
 * a distinct type keeps the boundary explicit in the data itself rather than
 * in a comment. This function stays intentionally small - no document
 * header, no supplier, no approval - and should stay a neighbour of the
 * future receiving domain module, not grow into it.
 */

import type { Database } from '../lib/db';
import { dec, moneyParam, qtyParam } from '../lib/money';
import { categoryAllowedInStore } from '../lib/storeCompat';

export class OpeningStockError extends Error {
  constructor(
    message: string,
    readonly code: 'ALREADY_OPENED' | 'CATEGORY_STORE_MISMATCH',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'OpeningStockError';
  }
}

export interface PostOpeningStockResult {
  movementId: string;
}

export async function postOpeningStock(
  db: Database,
  tenantId: string,
  storeId: string,
  itemId: string,
  qty: string,
  unitCost: string,
  occurredOn: string,
  note?: string,
): Promise<PostOpeningStockResult> {
  return db.transaction(async (tx) => {
    const { rows: compat } = await tx.query<{ category_kind: string; store_kind: string }>(
      `select c.kind as category_kind, s.kind as store_kind
         from items i
         join item_categories c on c.id = i.category_id
         cross join stores s
        where i.tenant_id = $1 and i.id = $2 and s.tenant_id = $1 and s.id = $3`,
      [tenantId, itemId, storeId],
    );
    if (!compat.length) {
      throw new OpeningStockError('Item or store not found.', 'CATEGORY_STORE_MISMATCH');
    }
    if (!categoryAllowedInStore(compat[0].category_kind, compat[0].store_kind)) {
      throw new OpeningStockError(
        `A ${compat[0].category_kind} item can't be stocked in a ${compat[0].store_kind} store.`,
        'CATEGORY_STORE_MISMATCH',
      );
    }

    const { rows: existing } = await tx.query<{ id: string }>(
      `select id from stock_movements
        where tenant_id = $1 and store_id = $2 and item_id = $3 and movement_type = 'opening'`,
      [tenantId, storeId, itemId],
    );
    if (existing.length) {
      throw new OpeningStockError(
        'This store already has an opening balance for this item. Correct it with a count adjustment instead.',
        'ALREADY_OPENED',
        { movementId: existing[0].id },
      );
    }

    const value = dec(qty).times(unitCost);
    const { rows } = await tx.query<{ id: string }>(
      `insert into stock_movements
         (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
          occurred_on, source_doc_type, note)
       values ($1, $2, $3, 'opening', $4, $5, $6, $7::date, 'opening_stock', $8)
       returning id`,
      [
        tenantId,
        storeId,
        itemId,
        qtyParam(qty),
        moneyParam(unitCost),
        moneyParam(value),
        occurredOn,
        note ?? null,
      ],
    );
    return { movementId: rows[0].id };
  });
}
