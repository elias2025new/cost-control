import type { Database } from '../lib/db';
import { dec, Decimal, qtyParam, moneyParam } from '../lib/money';
import { explodeRecipe } from './costRecipe';

export type WasteReason = 'spoilage' | 'burnt' | 'spill' | 'expired' | 'comp' | 'staff_meal';

export class WasteLogError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'WASTE_LOG_NOT_FOUND'
      | 'ALREADY_APPROVED'
      | 'ALREADY_REJECTED'
      | 'NOT_SUBMITTED'
      | 'NOTHING_TO_POST'
      | 'INVALID_STATUS',
  ) {
    super(message);
    this.name = 'WasteLogError';
  }
}

export interface WasteLineInput {
  itemId?: string;
  recipeId?: string;
  portions?: string;
  qty?: string;
  reason: WasteReason;
  note?: string;
}

export async function createWasteLog(
  db: Database,
  tenantId: string,
  storeId: string,
  occurredOn: string,
  note: string | null,
  actorUserId: string | null,
): Promise<{ wasteLogId: string }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into waste_logs
         (tenant_id, store_id, occurred_on, note, logged_by_user_id, status)
       values ($1, $2, $3::date, $4, $5, 'draft')
       returning id`,
      [tenantId, storeId, occurredOn, note, actorUserId],
    );
    return { wasteLogId: rows[0].id };
  });
}

export async function setWasteLogLines(
  db: Database,
  tenantId: string,
  wasteLogId: string,
  lines: WasteLineInput[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from waste_logs where id = $1 and tenant_id = $2 for update`,
      [wasteLogId, tenantId],
    );
    if (!found.length) throw new WasteLogError('That waste log does not exist.', 'WASTE_LOG_NOT_FOUND');
    if (found[0].status === 'approved') {
      throw new WasteLogError('An approved waste log cannot be edited.', 'ALREADY_APPROVED');
    }
    if (found[0].status === 'rejected') {
      throw new WasteLogError('A rejected waste log cannot be edited.', 'ALREADY_REJECTED');
    }

    await tx.query(`delete from waste_log_lines where waste_log_id = $1 and tenant_id = $2`, [
      wasteLogId,
      tenantId,
    ]);

    for (const line of lines) {
      const lineQty = line.qty ?? line.portions ?? '1';
      await tx.query(
        `insert into waste_log_lines (tenant_id, waste_log_id, item_id, recipe_id, portions, qty, reason, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          wasteLogId,
          line.itemId ?? null,
          line.recipeId ?? null,
          line.portions ? qtyParam(line.portions) : null,
          qtyParam(lineQty),
          line.reason,
          line.note ?? null,
        ],
      );
    }
  });
}

export async function submitWasteLog(
  db: Database,
  tenantId: string,
  wasteLogId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from waste_logs where id = $1 and tenant_id = $2 for update`,
      [wasteLogId, tenantId],
    );
    if (!found.length) throw new WasteLogError('That waste log does not exist.', 'WASTE_LOG_NOT_FOUND');
    if (found[0].status !== 'draft') {
      throw new WasteLogError(`Only draft logs can be submitted (current status: ${found[0].status}).`, 'INVALID_STATUS');
    }

    const { rows: lineCount } = await tx.query<{ c: string }>(
      `select count(*)::text as c from waste_log_lines where waste_log_id = $1 and tenant_id = $2`,
      [wasteLogId, tenantId],
    );
    if (lineCount[0].c === '0') {
      throw new WasteLogError('Cannot submit a waste log with no items.', 'NOTHING_TO_POST');
    }

    await tx.query(
      `update waste_logs set status = 'submitted' where id = $1 and tenant_id = $2`,
      [wasteLogId, tenantId],
    );
  });
}

export async function approveWasteLog(
  db: Database,
  tenantId: string,
  wasteLogId: string,
  approverUserId: string | null,
): Promise<{ linesApproved: number }> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{
      status: string;
      store_id: string;
      occurred_on: string;
    }>(
      `select status, store_id, occurred_on::text as occurred_on
         from waste_logs where id = $1 and tenant_id = $2 for update`,
      [wasteLogId, tenantId],
    );
    if (!found.length) throw new WasteLogError('That waste log does not exist.', 'WASTE_LOG_NOT_FOUND');
    const header = found[0];
    if (header.status === 'approved') {
      throw new WasteLogError('This waste log is already approved.', 'ALREADY_APPROVED');
    }
    if (header.status === 'rejected') {
      throw new WasteLogError('A rejected waste log cannot be approved.', 'ALREADY_REJECTED');
    }

    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string | null;
      recipe_id: string | null;
      portions: string | null;
      qty: string;
      reason: WasteReason;
    }>(
      `select id, item_id, recipe_id, portions::text as portions, qty::text as qty, reason
         from waste_log_lines
        where waste_log_id = $1 and tenant_id = $2`,
      [wasteLogId, tenantId],
    );
    if (lines.length === 0) throw new WasteLogError('Cannot approve a waste log with no items.', 'NOTHING_TO_POST');

    const occurredOn = header.occurred_on.slice(0, 10);

    for (const line of lines) {
      // Map waste reason to stock_movements movement_type
      let movementType: 'wastage' | 'comp' | 'staff_meal' = 'wastage';
      if (line.reason === 'comp') movementType = 'comp';
      else if (line.reason === 'staff_meal') movementType = 'staff_meal';

      if (line.recipe_id) {
        const portions = dec(line.portions || line.qty);
        const compExplosion = await explodeRecipe(tx, tenantId, line.recipe_id, occurredOn, portions);
        let recipeTotalCost = new Decimal(0);
        let subIdx = 1;

        for (const [rawItemId, rawQty] of compExplosion.entries()) {
          const { rows: costRows } = await tx.query<{ avg_cost: string }>(
            `select current_avg_cost($1, $2, $3) as avg_cost`,
            [tenantId, header.store_id, rawItemId],
          );
          const unitCost = dec(costRows[0]?.avg_cost ?? '0');
          const rawTotal = rawQty.times(unitCost);
          recipeTotalCost = recipeTotalCost.plus(rawTotal);

          await tx.query(
            `insert into stock_movements
               (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
                occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8::date,
                     'waste_log', $9, $10, $11, $12)`,
            [
              tenantId,
              header.store_id,
              rawItemId,
              movementType,
              qtyParam(rawQty.negated()),
              moneyParam(unitCost),
              moneyParam(rawTotal.negated()),
              occurredOn,
              wasteLogId,
              line.id,
              `recipe waste write-off (${line.reason})`,
              approverUserId ?? 'system',
            ],
          );
        }

        const unitCost = portions.gt(0) ? recipeTotalCost.div(portions) : new Decimal(0);
        await tx.query(
          `update waste_log_lines
              set unit_cost = $1, total_cost = $2
            where id = $3 and tenant_id = $4`,
          [moneyParam(unitCost), moneyParam(recipeTotalCost), line.id, tenantId],
        );
      } else if (line.item_id) {
        const qty = dec(line.qty);
        const { rows: costRows } = await tx.query<{ avg_cost: string }>(
          `select current_avg_cost($1, $2, $3) as avg_cost`,
          [tenantId, header.store_id, line.item_id],
        );
        const unitCost = dec(costRows[0]?.avg_cost ?? '0');
        const totalCost = qty.times(unitCost);

        await tx.query(
          `insert into stock_movements
             (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
              occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8::date,
                   'waste_log', $9, $10, $11, $12)`,
          [
            tenantId,
            header.store_id,
            line.item_id,
            movementType,
            qtyParam(qty.negated()),
            moneyParam(unitCost),
            moneyParam(totalCost.negated()),
            occurredOn,
            wasteLogId,
            line.id,
            `waste write-off (${line.reason})`,
            approverUserId ?? 'system',
          ],
        );

        await tx.query(
          `update waste_log_lines
              set unit_cost = $1, total_cost = $2
            where id = $3 and tenant_id = $4`,
          [moneyParam(unitCost), moneyParam(totalCost), line.id, tenantId],
        );
      }
    }

    await tx.query(
      `update waste_logs
          set status = 'approved', approved_by_user_id = $1, approved_at = now()
        where id = $2 and tenant_id = $3`,
      [approverUserId, wasteLogId, tenantId],
    );

    return { linesApproved: lines.length };
  });
}

export async function rejectWasteLog(
  db: Database,
  tenantId: string,
  wasteLogId: string,
  rejectorUserId: string | null,
  rejectionReason: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: found } = await tx.query<{ status: string }>(
      `select status from waste_logs where id = $1 and tenant_id = $2 for update`,
      [wasteLogId, tenantId],
    );
    if (!found.length) throw new WasteLogError('That waste log does not exist.', 'WASTE_LOG_NOT_FOUND');
    if (found[0].status === 'approved') {
      throw new WasteLogError('An approved waste log cannot be rejected.', 'ALREADY_APPROVED');
    }
    await tx.query(
      `update waste_logs
          set status = 'rejected', rejection_reason = $1, approved_by_user_id = $2, approved_at = now()
        where id = $3 and tenant_id = $4`,
      [rejectionReason, rejectorUserId, wasteLogId, tenantId],
    );
  });
}
