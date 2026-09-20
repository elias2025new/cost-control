/**
 * Issue requests - an outlet asks the main store for stock, the main store
 * releases it, and the ledger records the move.
 *
 * Releasing writes a matched pair of movements per line: issue_out at the
 * fulfilling store, issue_in at the requesting one. Both legs carry the
 * SAME unit cost, read once from the fulfilling store's moving weighted
 * average. That is not an optimisation - issuing stock is a relocation, not
 * a revaluation: it must not create or destroy value, and only a receipt
 * ever moves an average. Pricing the inbound leg at the destination's own
 * average would make the two legs disagree and quietly drift total stock
 * value.
 *
 * Concurrency: fulfilling locks the header row and re-checks its status
 * inside the transaction, the same shape postStockCount uses, with a unique
 * index (009) as the backstop if that reasoning is ever wrong.
 *
 * Two fulfilments of *different* requests against the same store and item
 * cannot corrupt each other's pricing, because an issue never moves the
 * average - at worst both read the same pre-transaction figure, which is
 * correct. A receipt landing concurrently with a fulfilment WOULD need
 * serialising, but there is no receiving flow yet for that to happen
 * against; revisit this the day one is built.
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';

export class IssueRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'NO_MAIN_STORE'
      | 'AMBIGUOUS_MAIN_STORE'
      | 'SELF_REQUEST'
      | 'NOT_AUTHORISED'
      | 'ALREADY_FULFILLED'
      | 'CANCELLED'
      | 'NOTHING_REQUESTED',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'IssueRequestError';
  }
}

export interface RequestLineInput {
  itemId: string;
  qty: string;
  note?: string;
}

export interface CreateIssueRequestResult {
  requestId: string;
  fulfillingStoreId: string;
  lineCount: number;
}

/**
 * The main store that serves a given outlet: the kind='main' store in the
 * same branch. Branch matters - nothing guarantees one main store per
 * tenant once a second branch exists.
 */
async function resolveMainStore(tx: Tx, tenantId: string, requestingStoreId: string) {
  const { rows: requesting } = await tx.query<{ branch_id: string; kind: string; name: string }>(
    `select branch_id, kind, name from stores where tenant_id = $1 and id = $2`,
    [tenantId, requestingStoreId],
  );
  if (!requesting.length) {
    throw new IssueRequestError('That store does not exist.', 'REQUEST_NOT_FOUND', {
      requestingStoreId,
    });
  }
  if (requesting[0].kind === 'main') {
    throw new IssueRequestError(
      'The main store does not request stock from itself - it receives it.',
      'SELF_REQUEST',
      { requestingStoreId },
    );
  }

  const { rows: mains } = await tx.query<{ id: string; name: string }>(
    `select id, name from stores
      where tenant_id = $1 and branch_id = $2 and kind = 'main' and is_active`,
    [tenantId, requesting[0].branch_id],
  );
  if (mains.length === 0) {
    throw new IssueRequestError(
      `${requesting[0].name} has no main store in its branch to request from. Create one first.`,
      'NO_MAIN_STORE',
      { branchId: requesting[0].branch_id },
    );
  }
  if (mains.length > 1) {
    throw new IssueRequestError(
      'That branch has more than one main store, so there is no single place to request from.',
      'AMBIGUOUS_MAIN_STORE',
      { branchId: requesting[0].branch_id, found: mains.map((m) => m.name) },
    );
  }
  return mains[0].id;
}

export async function createIssueRequest(
  db: Database,
  tenantId: string,
  requestingStoreId: string,
  lines: RequestLineInput[],
  requestedByUserId: string | null,
  note?: string,
): Promise<CreateIssueRequestResult> {
  if (lines.length === 0) {
    throw new IssueRequestError('Add at least one item to request.', 'NOTHING_REQUESTED');
  }

  return db.transaction(async (tx) => {
    const fulfillingStoreId = await resolveMainStore(tx, tenantId, requestingStoreId);

    const { rows } = await tx.query<{ id: string }>(
      `insert into issue_requests
         (tenant_id, requesting_store_id, fulfilling_store_id, requested_by_user_id, note)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, requestingStoreId, fulfillingStoreId, requestedByUserId, note ?? null],
    );
    const requestId = rows[0].id;

    for (const line of lines) {
      await tx.query(
        `insert into issue_request_lines
           (tenant_id, issue_request_id, item_id, requested_qty, note)
         values ($1, $2, $3, $4, $5)`,
        [tenantId, requestId, line.itemId, qtyParam(line.qty), line.note ?? null],
      );
    }

    return { requestId, fulfillingStoreId, lineCount: lines.length };
  });
}

export interface FulfillLineInput {
  lineId: string;
  fulfilledQty: string;
}

export interface FulfillResult {
  requestId: string;
  fulfilled: boolean;
  alreadyFulfilled: boolean;
  linesReleased: number;
  totalValue: Decimal;
}

/**
 * Release the stock. `actor` is checked here rather than only in the
 * calling action: a Server Function stays reachable independently of the
 * page that renders its form, so the store check has to live where the
 * work happens.
 */
export async function fulfillIssueRequest(
  db: Database,
  tenantId: string,
  requestId: string,
  lines: FulfillLineInput[],
  actor: { userId: string | null; role: 'admin' | 'store_user'; storeId: string | null; name: string },
): Promise<FulfillResult> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{
      id: string;
      status: string;
      requesting_store_id: string;
      fulfilling_store_id: string;
      requested_at: string;
    }>(
      `select id, status, requesting_store_id, fulfilling_store_id,
              requested_at::text as requested_at
         from issue_requests where id = $1 and tenant_id = $2 for update`,
      [requestId, tenantId],
    );
    if (!found.length) {
      throw new IssueRequestError('That request does not exist.', 'REQUEST_NOT_FOUND', {
        requestId,
      });
    }
    const req = found[0];

    if (actor.role !== 'admin' && actor.storeId !== req.fulfilling_store_id) {
      throw new IssueRequestError(
        'Only the store being asked for the stock can release it.',
        'NOT_AUTHORISED',
        { requestId },
      );
    }

    if (req.status === 'fulfilled') {
      const { rows: prior } = await tx.query<{ n: string; value: string | null }>(
        `select count(*)::text as n, sum(abs(value_delta))::text as value
           from stock_movements
          where source_doc_type = 'issue_request' and source_doc_id = $1
            and movement_type = 'issue_out'`,
        [requestId],
      );
      return {
        requestId,
        fulfilled: false,
        alreadyFulfilled: true,
        linesReleased: Number(prior[0]?.n ?? 0),
        totalValue: dec(prior[0]?.value ?? 0),
      };
    }
    if (req.status === 'cancelled') {
      throw new IssueRequestError('This request was cancelled.', 'CANCELLED', { requestId });
    }

    const occurredOn = req.requested_at.slice(0, 10);
    let released = 0;
    let totalValue = new Decimal(0);

    for (const line of lines) {
      const qty = dec(line.fulfilledQty);

      // Double-keyed: a fulfilment is a different session from the one that
      // created the lines, so the line must be proven to belong to this
      // request rather than trusted from the form.
      const { rows: lineRows } = await tx.query<{ id: string; item_id: string }>(
        `select id, item_id from issue_request_lines
          where id = $1 and issue_request_id = $2 and tenant_id = $3`,
        [line.lineId, requestId, tenantId],
      );
      if (!lineRows.length) {
        throw new IssueRequestError(
          'A line on this request could not be found.',
          'REQUEST_NOT_FOUND',
          { lineId: line.lineId, requestId },
        );
      }
      const itemId = lineRows[0].item_id;

      await tx.query(
        `update issue_request_lines set fulfilled_qty = $3
          where id = $1 and issue_request_id = $2`,
        [line.lineId, requestId, qtyParam(qty)],
      );

      if (qty.isZero()) continue;

      // One cost, from the source, stamped on both legs. See the note at
      // the top of this file.
      const { rows: avgRows } = await tx.query<{ avg: string }>(
        `select current_avg_cost($1, $2, $3) as avg`,
        [tenantId, req.fulfilling_store_id, itemId],
      );
      const unitCost = dec(avgRows[0]?.avg ?? 0);
      const value = qty.times(unitCost);

      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'issue_out', $4, $5, $6, $7::date,
                 'issue_request', $8, $9, $10, $11)`,
        [
          tenantId,
          req.fulfilling_store_id,
          itemId,
          qtyParam(qty.negated()),
          moneyParam(unitCost),
          moneyParam(value.negated()),
          occurredOn,
          requestId,
          line.lineId,
          'issued on request',
          actor.name,
        ],
      );
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'issue_in', $4, $5, $6, $7::date,
                 'issue_request', $8, $9, $10, $11)`,
        [
          tenantId,
          req.requesting_store_id,
          itemId,
          qtyParam(qty),
          moneyParam(unitCost),
          moneyParam(value),
          occurredOn,
          requestId,
          line.lineId,
          'received on request',
          actor.name,
        ],
      );

      released += 1;
      totalValue = totalValue.plus(value);
    }

    const { rowCount } = await tx.query(
      `update issue_requests
          set status = 'fulfilled', fulfilled_at = now(), fulfilled_by_user_id = $2
        where id = $1 and status <> 'fulfilled'`,
      [requestId, actor.userId],
    );
    if (rowCount === 0) {
      throw new IssueRequestError(
        'This request was released concurrently; the attempt was rolled back.',
        'ALREADY_FULFILLED',
        { requestId },
      );
    }

    return { requestId, fulfilled: true, alreadyFulfilled: false, linesReleased: released, totalValue };
  });
}

export async function cancelIssueRequest(
  db: Database,
  tenantId: string,
  requestId: string,
  actor: { role: 'admin' | 'store_user'; storeId: string | null },
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      status: string;
      requesting_store_id: string;
    }>(
      `select status, requesting_store_id from issue_requests
        where id = $1 and tenant_id = $2 for update`,
      [requestId, tenantId],
    );
    if (!rows.length) {
      throw new IssueRequestError('That request does not exist.', 'REQUEST_NOT_FOUND', {
        requestId,
      });
    }
    const req = rows[0];

    if (actor.role !== 'admin' && actor.storeId !== req.requesting_store_id) {
      throw new IssueRequestError(
        'Only the store that made the request can cancel it.',
        'NOT_AUTHORISED',
        { requestId },
      );
    }
    if (req.status === 'fulfilled') {
      throw new IssueRequestError(
        'This request was already released - it cannot be cancelled. Reverse the movements instead.',
        'ALREADY_FULFILLED',
        { requestId },
      );
    }
    if (req.status === 'cancelled') return;

    await tx.query(`update issue_requests set status = 'cancelled' where id = $1`, [requestId]);
  });
}
