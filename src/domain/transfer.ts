import type { Database } from '../lib/db';
import { dec, qtyParam, moneyParam } from '../lib/money';

export class TransferError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'TRANSFER_NOT_FOUND'
      | 'ALREADY_POSTED'
      | 'NOTHING_TO_POST'
      | 'SAME_STORE'
      | 'INSUFFICIENT_STOCK',
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

export interface TransferLineInput {
  itemId: string;
  qty: string;
}

export async function createTransfer(
  db: Database,
  tenantId: string,
  fromStoreId: string,
  toStoreId: string,
  occurredOn: string,
  note: string | null,
  actorUserId: string,
): Promise<{ transferId: string }> {
  if (fromStoreId === toStoreId) {
    throw new TransferError('Source and destination stores must be different.', 'SAME_STORE');
  }
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into transfers
         (tenant_id, from_store_id, to_store_id, occurred_on, note, created_by)
       values ($1, $2, $3, $4::date, $5, $6) returning id`,
      [tenantId, fromStoreId, toStoreId, occurredOn, note, actorUserId],
    );
    return { transferId: rows[0].id };
  });
}

export async function setTransferLines(
  db: Database,
  tenantId: string,
  transferId: string,
  lines: TransferLineInput[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from transfers where id = $1 and tenant_id = $2 for update`,
      [transferId, tenantId],
    );
    if (!found.length) throw new TransferError('That transfer does not exist.', 'TRANSFER_NOT_FOUND');
    if (found[0].status === 'posted') throw new TransferError('A posted transfer cannot be edited.', 'ALREADY_POSTED');

    await tx.query(`delete from transfer_lines where transfer_id = $1 and tenant_id = $2`, [
      transferId, tenantId,
    ]);

    for (const line of lines) {
      await tx.query(
        `insert into transfer_lines (tenant_id, transfer_id, item_id, qty)
         values ($1, $2, $3, $4)`,
        [tenantId, transferId, line.itemId, qtyParam(line.qty)],
      );
    }
  });
}

export async function postTransfer(
  db: Database,
  tenantId: string,
  transferId: string,
  actorUserId: string,
): Promise<{ linesPosted: number }> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{
      status: string;
      from_store_id: string;
      to_store_id: string;
      occurred_on: string;
    }>(
      `select status, from_store_id, to_store_id, occurred_on::text as occurred_on
         from transfers where id = $1 and tenant_id = $2 for update`,
      [transferId, tenantId],
    );
    if (!found.length) throw new TransferError('That transfer does not exist.', 'TRANSFER_NOT_FOUND');
    const header = found[0];
    if (header.status === 'posted') throw new TransferError('This transfer is already posted.', 'ALREADY_POSTED');

    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string;
      qty: string;
    }>(
      `select id, item_id, qty::text as qty
         from transfer_lines
        where transfer_id = $1 and tenant_id = $2`,
      [transferId, tenantId],
    );
    if (lines.length === 0) throw new TransferError('Cannot post a transfer with no items.', 'NOTHING_TO_POST');

    const occurredOn = header.occurred_on.slice(0, 10);

    for (const line of lines) {
      const qty = dec(line.qty);

      // Look up the current Moving Weighted Average cost in the source store
      const { rows: costRows } = await tx.query<{ avg_cost: string }>(
        `select coalesce(
           case when sum(qty_delta) = 0 then 0
                else round(sum(value_delta) / sum(qty_delta), 2)
           end, 0
         )::text as avg_cost
         from stock_movements
        where tenant_id = $1 and store_id = $2 and item_id = $3`,
        [tenantId, header.from_store_id, line.item_id],
      );
      const unitCost = dec(costRows[0]?.avg_cost ?? '0');
      const value = qty.times(unitCost);

      // Transfer OUT from source store (negative qty)
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'transfer_out', $4, $5, $6, $7::date,
                 'transfer', $8, $9, 'store transfer out', $10)`,
        [
          tenantId, header.from_store_id, line.item_id,
          qtyParam(qty.negated()), moneyParam(unitCost), moneyParam(value.negated()),
          occurredOn, transferId, line.id, actorUserId,
        ],
      );

      // Transfer IN to destination store (positive qty)
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'transfer_in', $4, $5, $6, $7::date,
                 'transfer', $8, $9, 'store transfer in', $10)`,
        [
          tenantId, header.to_store_id, line.item_id,
          qtyParam(qty), moneyParam(unitCost), moneyParam(value),
          occurredOn, transferId, line.id, actorUserId,
        ],
      );
    }

    await tx.query(`update transfers set status = 'posted' where id = $1`, [transferId]);

    return { linesPosted: lines.length };
  });
}

export async function deleteTransfer(
  db: Database,
  tenantId: string,
  transferId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from transfers where id = $1 and tenant_id = $2 for update`,
      [transferId, tenantId],
    );
    if (!found.length) throw new TransferError('That transfer does not exist.', 'TRANSFER_NOT_FOUND');
    if (found[0].status === 'posted') {
      throw new TransferError('A posted transfer cannot be deleted.', 'ALREADY_POSTED');
    }
    await tx.query(`delete from transfers where id = $1 and tenant_id = $2`, [transferId, tenantId]);
  });
}
