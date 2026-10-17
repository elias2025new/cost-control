/**
 * Physical counts.
 *
 * A count is taken against a snapshot: the theoretical quantity the ledger
 * says should be on the shelf at that date, frozen at the moment the count
 * sheet is created. Freezing it matters - if the theoretical figure were
 * recomputed when the count is posted, later movements would quietly move the
 * target and the variance would stop meaning anything.
 *
 * Posting writes one count_adjustment movement per line that actually differs.
 * Nothing is overwritten: the adjustment is a signed row like everything else,
 * and after posting the ledger balance equals what was counted.
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';

export class StockCountError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'COUNT_NOT_FOUND'
      | 'ALREADY_EXISTS'
      | 'ALREADY_POSTED'
      | 'REVERSED'
      | 'NOTHING_COUNTED',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StockCountError';
  }
}

export interface CreateCountResult {
  countId: string;
  lineCount: number;
}

/**
 * Build a count sheet for a store on a date, snapshotting the theoretical
 * quantity and the moving weighted average cost of every item that store
 * holds or is expected to hold.
 */
export async function createStockCount(
  db: Database,
  tenantId: string,
  storeId: string,
  countDate: string,
  countedBy?: string,
  isBlind: boolean = true,
): Promise<CreateCountResult> {
  return db.transaction(async (tx) => {
    const { rows: existing } = await tx.query<{ id: string; status: string }>(
      `select id, status from stock_counts
        where tenant_id = $1 and store_id = $2 and count_date = $3::date`,
      [tenantId, storeId, countDate],
    );
    if (existing.length) {
      throw new StockCountError(
        `A count already exists for this store on ${countDate}.`,
        'ALREADY_EXISTS',
        { countId: existing[0].id, status: existing[0].status },
      );
    }

    const { rows: created } = await tx.query<{ id: string }>(
      `insert into stock_counts (tenant_id, store_id, count_date, status, counted_by, is_blind)
       values ($1, $2, $3::date, 'draft', $4, $5) returning id`,
      [tenantId, storeId, countDate, countedBy ?? null, isBlind],
    );
    const countId = created[0].id;

    // Everything this store has ever moved, plus anything it is supposed to
    // carry a par level of. An item that should be there and is not is exactly
    // the thing a count is looking for.
    const { rowCount } = await tx.query(
      `insert into stock_count_lines
         (tenant_id, stock_count_id, item_id, theoretical_qty, unit_cost)
       select $1,
              $2,
              i.id,
              coalesce((select sum(m.qty_delta) from stock_movements m
                         where m.tenant_id = $1 and m.store_id = $3 and m.item_id = i.id
                           and m.occurred_on <= $4::date), 0),
              coalesce(current_avg_cost($1, $3, i.id), 0)
         from items i
        where i.tenant_id = $1
          and i.is_active
          and (
            exists (select 1 from stock_movements m
                     where m.tenant_id = $1 and m.store_id = $3 and m.item_id = i.id)
            or exists (select 1 from store_item_levels l
                        where l.tenant_id = $1 and l.store_id = $3 and l.item_id = i.id)
          )`,
      [tenantId, countId, storeId, countDate],
    );

    return { countId, lineCount: rowCount };
  });
}

/** Save entered quantities and reasons. Only while the count is draft or recount_required. */
export async function saveCountedQuantities(
  db: Database,
  countId: string,
  entries: { lineId: string; countedQty: string | null; note?: string | null; discrepancyReason?: string | null }[],
): Promise<{ saved: number }> {
  return db.transaction(async (tx) => {
    const status = await countStatus(tx, countId);
    if (status === 'posted') {
      throw new StockCountError(
        'This count is posted and can no longer be edited.',
        'ALREADY_POSTED',
        { countId },
      );
    }

    let saved = 0;
    for (const e of entries) {
      const q = e.countedQty === null || e.countedQty === '' ? null : qtyParam(e.countedQty);
      await tx.query(
        `update stock_count_lines
            set counted_qty = $2,
                first_counted_qty = coalesce(first_counted_qty, $2),
                note = $3,
                discrepancy_reason = coalesce($5, discrepancy_reason)
          where id = $1 and stock_count_id = $4`,
        [
          e.lineId,
          q,
          e.note && e.note.trim() ? e.note.trim() : null,
          countId,
          e.discrepancyReason ?? null,
        ],
      );
      saved += 1;
    }
    return { saved };
  });
}

export interface BlindCountLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
}

/**
 * HMC Blind Count Sheet: Returns items to count WITHOUT disclosing theoretical book stock.
 * Prevents bias or fabricated counts during physical stocktaking.
 */
export async function getBlindCountSheet(
  db: Database,
  tenantId: string,
  countId: string,
): Promise<BlindCountLine[]> {
  const { rows } = await db.query<{
    id: string;
    item_id: string;
    code: string;
    name: string;
    uom: string;
  }>(
    `select l.id, l.item_id, i.code, i.name, i.uom
       from stock_count_lines l
       join items i on i.id = l.item_id
      where l.stock_count_id = $1 and l.tenant_id = $2
      order by i.code`,
    [countId, tenantId],
  );

  return rows.map((r) => ({
    lineId: r.id,
    itemId: r.item_id,
    itemCode: r.code,
    itemName: r.name,
    uom: r.uom,
  }));
}

/**
 * Evaluates Count Recount Flags (HMC InventoryBusinessProcessObject.cs)
 * Flags lines where variance exceeds threshold and updates status to 'recount_required' if needed.
 */
export async function submitCountForRecountEvaluation(
  db: Database,
  tenantId: string,
  countId: string,
  opts?: { valThreshold?: number; pctThreshold?: number },
): Promise<{ status: string; flaggedLines: number; totalVarianceVal: Decimal }> {
  const valThreshold = opts?.valThreshold ?? 500.0;
  const pctThreshold = opts?.pctThreshold ?? 5.0;

  const { rows } = await db.query<{
    status: string;
    flagged_lines: number;
    total_variance_val: string;
  }>(`select * from evaluate_count_recounts($1, $2, $3)`, [countId, valThreshold, pctThreshold]);

  return {
    status: rows[0].status,
    flaggedLines: Number(rows[0].flagged_lines),
    totalVarianceVal: dec(rows[0].total_variance_val),
  };
}

/**
 * Records Blind Recount Entry with Discrepancy Classification
 * Updates recount_qty and resolves recount_status to 'recounted' or 'waived'.
 */
export async function recordRecount(
  db: Database,
  tenantId: string,
  countId: string,
  recounts: {
    lineId: string;
    recountQty: string;
    discrepancyReason?: string;
    waive?: boolean;
  }[],
  supervisorUserId?: string,
): Promise<{ resolvedLines: number; status: string }> {
  return db.transaction(async (tx) => {
    let resolved = 0;
    for (const r of recounts) {
      const recountStatus = r.waive ? 'waived' : 'recounted';
      await tx.query(
        `update stock_count_lines
            set recount_qty = $2,
                counted_qty = case when $3 = 'waived' then counted_qty else $2 end,
                recount_status = $3,
                discrepancy_reason = coalesce($4, discrepancy_reason)
          where id = $1 and stock_count_id = $5`,
        [
          r.lineId,
          qtyParam(r.recountQty),
          recountStatus,
          r.discrepancyReason ?? null,
          countId,
        ],
      );
      resolved++;
    }

    const { rows: remaining } = await tx.query<{ c: string }>(
      `select count(*)::text as c
         from stock_count_lines
        where stock_count_id = $1 and recount_status = 'flagged'`,
      [countId],
    );

    const hasFlagged = Number(remaining[0].c) > 0;
    const newStatus = hasFlagged ? 'recount_required' : 'approved';

    await tx.query(
      `update stock_counts
          set status = $2, recount_by = coalesce($3, recount_by)
        where id = $1`,
      [countId, newStatus, supervisorUserId ?? 'supervisor'],
    );

    return { resolvedLines: resolved, status: newStatus };
  });
}

export interface PostCountResult {
  countId: string;
  posted: boolean;
  alreadyPosted: boolean;
  linesCounted: number;
  adjustmentsWritten: number;
  netQtyAdjustment: Decimal;
  netValueAdjustment: Decimal;
}

/**
 * Post the count. One count_adjustment movement per line whose counted
 * quantity differs from the snapshot.
 *
 * Adjustments are valued at the store's current weighted average, which leaves
 * the average untouched and moves only the quantity - a count is evidence
 * about how much is there, not about what it cost.
 */
export async function postStockCount(
  db: Database,
  countId: string,
  postedBy?: string,
): Promise<PostCountResult> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{
      id: string;
      tenant_id: string;
      store_id: string;
      count_date: string;
      status: string;
    }>(
      `select id, tenant_id, store_id, count_date::text as count_date, status
         from stock_counts where id = $1 for update`,
      [countId],
    );
    if (!found.length) {
      throw new StockCountError(`Stock count ${countId} not found.`, 'COUNT_NOT_FOUND', {
        countId,
      });
    }
    const sc = found[0];

    if (sc.status === 'posted') {
      const summary = await postedSummary(tx, countId);
      return { countId, posted: false, alreadyPosted: true, ...summary };
    }
    if (sc.status === 'recount_required') {
      throw new StockCountError('Count has unresolved discrepancy recounts and cannot be posted.', 'ALREADY_EXISTS');
    }

    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string;
      theoretical_qty: string;
      counted_qty: string | null;
      discrepancy_reason: string | null;
    }>(
      `select id, item_id, theoretical_qty, counted_qty, discrepancy_reason
         from stock_count_lines
        where stock_count_id = $1 and counted_qty is not null
        order by id`,
      [countId],
    );

    if (!lines.length) {
      throw new StockCountError(
        'Nothing has been counted yet. Enter at least one counted quantity before posting.',
        'NOTHING_COUNTED',
        { countId },
      );
    }

    let adjustments = 0;
    let netQty = new Decimal(0);
    let netValue = new Decimal(0);

    for (const line of lines) {
      const delta = dec(line.counted_qty).minus(dec(line.theoretical_qty));

      // Re-read the average now rather than trusting the snapshot: movements
      // may have landed between building the sheet and posting it, and the
      // report must show the same figure the ledger records.
      const { rows: avgRows } = await tx.query<{ avg: string }>(
        `select current_avg_cost($1, $2, $3) as avg`,
        [sc.tenant_id, sc.store_id, line.item_id],
      );
      const unitCost = dec(avgRows[0]?.avg ?? 0);

      // Written while the count is still a draft, so the frozen-when-posted
      // trigger allows it and the report agrees with the ledger afterwards.
      await tx.query(`update stock_count_lines set unit_cost = $2 where id = $1`, [
        line.id,
        moneyParam(unitCost),
      ]);

      if (delta.isZero()) continue;

      const valueDelta = delta.times(unitCost);
      const movementNote = line.discrepancy_reason
        ? `physical count ${sc.count_date} (${line.discrepancy_reason})`
        : `physical count ${sc.count_date}`;

      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'count_adjustment', $4, $5, $6, $7::date,
                 'stock_count', $8, $9, $10, coalesce($11, 'system'))`,
        [
          sc.tenant_id,
          sc.store_id,
          line.item_id,
          qtyParam(delta),
          moneyParam(unitCost),
          moneyParam(valueDelta),
          sc.count_date,
          countId,
          line.id,
          movementNote,
          postedBy ?? null,
        ],
      );
      adjustments += 1;
      netQty = netQty.plus(delta);
      netValue = netValue.plus(valueDelta);
    }

    const { rowCount } = await tx.query(
      `update stock_counts set status = 'posted', posted_at = now(),
                               posted_by = coalesce($2, posted_by)
        where id = $1 and status <> 'posted'`,
      [countId, postedBy ?? null],
    );
    if (rowCount === 0) {
      throw new StockCountError(
        'This count was posted concurrently; the attempt was rolled back.',
        'ALREADY_POSTED',
        { countId },
      );
    }

    return {
      countId,
      posted: true,
      alreadyPosted: false,
      linesCounted: lines.length,
      adjustmentsWritten: adjustments,
      netQtyAdjustment: netQty,
      netValueAdjustment: netValue,
    };
  });
}

/* ----------------------------------------------------------------- helpers */

async function countStatus(tx: Tx, countId: string): Promise<string> {
  const { rows } = await tx.query<{ status: string }>(
    `select status from stock_counts where id = $1`,
    [countId],
  );
  if (!rows.length) {
    throw new StockCountError(`Stock count ${countId} not found.`, 'COUNT_NOT_FOUND', { countId });
  }
  return rows[0].status;
}

async function postedSummary(tx: Tx, countId: string) {
  const { rows } = await tx.query<{ n: string; qty: string; value: string; counted: string }>(
    `select count(*)::text                                as n,
            coalesce(sum(m.qty_delta), 0)::text           as qty,
            coalesce(sum(m.value_delta), 0)::text         as value,
            (select count(*)::text from stock_count_lines l
              where l.stock_count_id = $1 and l.counted_qty is not null) as counted
       from stock_movements m
      where m.source_doc_type = 'stock_count' and m.source_doc_id = $1`,
    [countId],
  );
  return {
    linesCounted: Number(rows[0]?.counted ?? 0),
    adjustmentsWritten: Number(rows[0]?.n ?? 0),
    netQtyAdjustment: dec(rows[0]?.qty ?? 0),
    netValueAdjustment: dec(rows[0]?.value ?? 0),
  };
}
