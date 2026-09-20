import type { Database, Tx } from '../lib/db';

export class PurchaseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseRequestError';
  }
}

export type CreatePurchaseRequestResult = {
  requestId: string;
};

export async function createPurchaseRequest(
  db: Database,
  tenantId: string,
  requestingStoreId: string,
  actorUserId: string,
): Promise<CreatePurchaseRequestResult> {
  const { rows } = await db.query<{ id: string }>(
    `insert into purchase_requests (tenant_id, requesting_store_id, requested_by_user_id)
     values ($1, $2, $3) returning id`,
    [tenantId, requestingStoreId, actorUserId],
  );
  return { requestId: rows[0].id };
}

export type PurchaseRequestLineInput = {
  itemId: string;
  qty: string;
  note?: string;
};

export async function setPurchaseRequestLines(
  db: Database,
  tenantId: string,
  requestId: string,
  lines: PurchaseRequestLineInput[],
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    // 1. Lock the header and check it's still draft
    const { rows } = await tx.query<{ status: string }>(
      `select status from purchase_requests where id = $1 and tenant_id = $2 for update`,
      [requestId, tenantId],
    );

    if (rows.length === 0) {
      throw new PurchaseRequestError('Purchase Request not found.');
    }
    if (rows[0].status !== 'draft') {
      throw new PurchaseRequestError('Cannot edit lines on a submitted purchase request.');
    }

    // 2. Erase old lines
    await tx.query(
      `delete from purchase_request_lines where request_id = $1 and tenant_id = $2`,
      [requestId, tenantId],
    );

    if (lines.length === 0) return;

    // 3. Insert new lines
    for (const line of lines) {
      const qty = parseFloat(line.qty);
      if (isNaN(qty) || qty <= 0) {
        throw new PurchaseRequestError('Quantities must be greater than zero.');
      }
      try {
        await tx.query(
          `insert into purchase_request_lines (tenant_id, request_id, item_id, requested_qty, note)
           values ($1, $2, $3, $4, $5)`,
          [tenantId, requestId, line.itemId, line.qty, line.note || null],
        );
      } catch (err: any) {
        if (err.code === '23505') {
          throw new PurchaseRequestError('Duplicate item in request.');
        }
        throw err;
      }
    }
  });
}

export async function submitPurchaseRequest(
  db: Database,
  tenantId: string,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    const { rows } = await tx.query<{ status: string; line_count: string }>(
      `select r.status, count(l.id) as line_count
         from purchase_requests r
         left join purchase_request_lines l on l.request_id = r.id
        where r.id = $1 and r.tenant_id = $2
        group by r.id
          for update`,
      [requestId, tenantId],
    );

    if (rows.length === 0) throw new PurchaseRequestError('Purchase Request not found.');
    if (rows[0].status !== 'draft') {
      throw new PurchaseRequestError('Can only submit draft requests.');
    }
    if (parseInt(rows[0].line_count, 10) === 0) {
      throw new PurchaseRequestError('Cannot submit an empty request.');
    }

    await tx.query(
      `update purchase_requests set status = 'requested', requested_at = now() where id = $1`,
      [requestId],
    );
  });
}

export async function resolvePurchaseRequest(
  db: Database,
  tenantId: string,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `select status from purchase_requests where id = $1 and tenant_id = $2 for update`,
      [requestId, tenantId],
    );

    if (rows.length === 0) throw new PurchaseRequestError('Purchase Request not found.');
    if (rows[0].status !== 'requested') {
      throw new PurchaseRequestError('Can only resolve an active request.');
    }

    await tx.query(
      `update purchase_requests set status = 'resolved' where id = $1`,
      [requestId],
    );
  });
}

export async function cancelPurchaseRequest(
  db: Database,
  tenantId: string,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `select status from purchase_requests where id = $1 and tenant_id = $2 for update`,
      [requestId, tenantId],
    );

    if (rows.length === 0) throw new PurchaseRequestError('Purchase Request not found.');
    if (rows[0].status !== 'draft' && rows[0].status !== 'requested') {
      throw new PurchaseRequestError('Can only cancel draft or requested requests.');
    }

    await tx.query(
      `update purchase_requests set status = 'cancelled' where id = $1`,
      [requestId],
    );
  });
}
