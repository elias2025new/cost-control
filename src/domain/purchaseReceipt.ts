import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';

export class PurchaseError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PURCHASE_NOT_FOUND'
      | 'ALREADY_POSTED'
      | 'NOTHING_TO_POST'
      | 'NOT_AUTHORISED',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export interface PurchaseLineInput {
  itemId: string;
  qty: string;
  unitCost: string;
}

export interface CreatePurchaseResult {
  purchaseId: string;
}

export async function createPurchase(
  db: Database,
  tenantId: string,
  storeId: string,
  supplierId: string,
  referenceNumber: string | null,
  occurredOn: string,
  actorUserId: string,
): Promise<CreatePurchaseResult> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into purchases
         (tenant_id, store_id, supplier_id, reference_number, occurred_on, created_by)
       values ($1, $2, $3, $4, $5::date, $6) returning id`,
      [tenantId, storeId, supplierId, referenceNumber, occurredOn, actorUserId],
    );
    return { purchaseId: rows[0].id };
  });
}

export async function setPurchaseLines(
  db: Database,
  tenantId: string,
  purchaseId: string,
  lines: PurchaseLineInput[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from purchases where id = $1 and tenant_id = $2 for update`,
      [purchaseId, tenantId],
    );
    if (!found.length) {
      throw new PurchaseError('That purchase does not exist.', 'PURCHASE_NOT_FOUND');
    }
    if (found[0].status === 'posted') {
      throw new PurchaseError('A posted purchase cannot be edited.', 'ALREADY_POSTED');
    }

    await tx.query(`delete from purchase_lines where purchase_id = $1 and tenant_id = $2`, [
      purchaseId,
      tenantId,
    ]);

    for (const line of lines) {
      await tx.query(
        `insert into purchase_lines
           (tenant_id, purchase_id, item_id, qty, unit_cost)
         values ($1, $2, $3, $4, $5)`,
        [tenantId, purchaseId, line.itemId, qtyParam(line.qty), moneyParam(line.unitCost)],
      );
    }
  });
}

export interface PostPurchaseResult {
  purchaseId: string;
  linesPosted: number;
  totalValue: Decimal;
}

export async function postPurchase(
  db: Database,
  tenantId: string,
  purchaseId: string,
  actorUserId: string,
): Promise<PostPurchaseResult> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{
      status: string;
      store_id: string;
      occurred_on: string;
    }>(
      `select status, store_id, occurred_on::text as occurred_on
         from purchases where id = $1 and tenant_id = $2 for update`,
      [purchaseId, tenantId],
    );
    if (!found.length) {
      throw new PurchaseError('That purchase does not exist.', 'PURCHASE_NOT_FOUND');
    }
    const header = found[0];

    if (header.status === 'posted') {
      throw new PurchaseError('This purchase is already posted.', 'ALREADY_POSTED');
    }

    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string;
      qty: string;
      unit_cost: string;
    }>(
      `select id, item_id, qty::text as qty, unit_cost::text as unit_cost
         from purchase_lines
        where purchase_id = $1 and tenant_id = $2`,
      [purchaseId, tenantId],
    );

    if (lines.length === 0) {
      throw new PurchaseError('Cannot post a purchase with no items.', 'NOTHING_TO_POST');
    }

    const occurredOn = header.occurred_on.slice(0, 10);
    let totalValue = new Decimal(0);

    for (const line of lines) {
      const qty = dec(line.qty);
      const unitCost = dec(line.unit_cost);
      const value = qty.times(unitCost);

      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'receipt', $4, $5, $6, $7::date,
                 'purchase_receipt', $8, $9, $10, $11)`,
        [
          tenantId,
          header.store_id,
          line.item_id,
          qtyParam(qty),
          moneyParam(unitCost),
          moneyParam(value),
          occurredOn,
          purchaseId,
          line.id,
          'purchase receipt',
          actorUserId,
        ],
      );

      totalValue = totalValue.plus(value);
    }

    await tx.query(`update purchases set status = 'posted' where id = $1`, [purchaseId]);

    return { purchaseId, linesPosted: lines.length, totalValue };
  });
}

export async function deletePurchase(db: Database, tenantId: string, purchaseId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from purchases where id = $1 and tenant_id = $2 for update`,
      [purchaseId, tenantId],
    );
    if (!found.length) {
      throw new PurchaseError('That purchase does not exist.', 'PURCHASE_NOT_FOUND');
    }
    if (found[0].status === 'posted') {
      throw new PurchaseError('A posted purchase cannot be deleted. You must reverse it instead.', 'ALREADY_POSTED');
    }

    await tx.query(`delete from purchases where id = $1 and tenant_id = $2`, [purchaseId, tenantId]);
  });
}

export async function reversePurchase(
  db: Database,
  tenantId: string,
  purchaseId: string,
  actorUserId: string,
): Promise<void> {
  return db.transaction(async (tx: Tx) => {
    // 1. Lock the header and check status
    const { rows: found } = await tx.query<{
      status: string;
      store_id: string;
    }>(
      `select status, store_id from purchases where id = $1 and tenant_id = $2 for update`,
      [purchaseId, tenantId],
    );
    if (!found.length) {
      throw new PurchaseError('That purchase does not exist.', 'PURCHASE_NOT_FOUND');
    }
    if (found[0].status !== 'posted') {
      throw new PurchaseError('Only posted purchases can be reversed.', 'NOT_AUTHORISED');
    }

    // 2. Find all receipt movements caused by this purchase
    const { rows: movements } = await tx.query<{
      id: string;
      item_id: string;
      qty_delta: string;
      unit_cost: string;
      value_delta: string;
    }>(
      `select id, item_id, qty_delta::text, unit_cost::text, value_delta::text
         from stock_movements
        where source_doc_id = $1
          and tenant_id = $2
          and movement_type = 'receipt'`,
      [purchaseId, tenantId]
    );

    if (movements.length === 0) {
      throw new PurchaseError('No ledger entries found to reverse for this purchase.', 'NOTHING_TO_POST');
    }

    // 3. Post reversal movements
    for (const m of movements) {
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, reversal_of_id, note, created_by)
         values ($1, $2, $3, 'reversal', $4, $5, $6, current_date,
                 'purchase_receipt', $7, $8, 'Reversal of purchase', $9)`,
        [
          tenantId,
          found[0].store_id,
          m.item_id,
          qtyParam(dec(m.qty_delta).times(-1)),
          moneyParam(dec(m.unit_cost)),
          moneyParam(dec(m.value_delta).times(-1)),
          purchaseId,
          m.id,
          actorUserId,
        ],
      );
    }

    // 4. Update status
    await tx.query(`update purchases set status = 'reversed' where id = $1`, [purchaseId]);
  });
}
