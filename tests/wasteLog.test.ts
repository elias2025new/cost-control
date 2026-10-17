import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  createWasteLog,
  setWasteLogLines,
  submitWasteLog,
  approveWasteLog,
  rejectWasteLog,
} from '../src/domain/wasteLog';
import { dec, Decimal } from '../src/lib/money';

let h: Harness;
let db: Database;
let tenantId: string;
let stores: Record<string, string>;
let items: Record<string, string>;
let testUserId: string | null = null;

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  stores = h.seeded.storeIds;
  items = h.seeded.itemIds;

  const { rows: u } = await db.query<{ id: string }>('select id from users limit 1');
  testUserId = u[0]?.id ?? null;
});

afterAll(async () => {
  await h?.close();
});

async function onHand(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ q: string }>(
    `select coalesce(qty_on_hand, 0) as q from v_stock_on_hand
      where tenant_id = $1 and store_id = $2 and item_id = $3`,
    [tenantId, stores[store], items[item]],
  );
  return dec(rows[0]?.q ?? 0);
}

describe('Waste & Leakage Logging', () => {
  it('creates draft, sets lines, submits, and approves with ledger movements', async () => {
    // 1. Give Kitchen some initial stock of RM-BEEF-KITFO
    await db.query(
      `insert into stock_movements
         (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta, occurred_on, source_doc_type, note)
       values ($1, $2, $3, 'receipt', 10, 500, 5000, '2026-08-01'::date, 'seed_test', 'test stock')`,
      [tenantId, stores.KITCHEN, items['RM-BEEF-KITFO']],
    );

    const initialStock = await onHand('KITCHEN', 'RM-BEEF-KITFO');
    expect(initialStock.toNumber()).toBeGreaterThanOrEqual(10);

    // 2. Kitchen logs burnt beef and staff meal
    const { wasteLogId } = await createWasteLog(
      db,
      tenantId,
      stores.KITCHEN,
      '2026-08-02',
      'Burnt during evening rush',
      testUserId ?? null,
    );

    await setWasteLogLines(db, tenantId, wasteLogId, [
      { itemId: items['RM-BEEF-KITFO'], qty: '1.5', reason: 'burnt', note: 'overcooked' },
      { itemId: items['RM-BEEF-KITFO'], qty: '0.5', reason: 'staff_meal', note: 'dinner break' },
    ]);

    // 3. Submit for Controller review
    await submitWasteLog(db, tenantId, wasteLogId);

    // 4. Controller approves the write-off
    const result = await approveWasteLog(db, tenantId, wasteLogId, testUserId ?? null);
    expect(result.linesApproved).toBe(2);

    // 5. Verify stock reduction in stock_movements
    const newStock = await onHand('KITCHEN', 'RM-BEEF-KITFO');
    expect(newStock.toNumber()).toBe(initialStock.minus(2.0).toNumber());

    // 6. Verify movement types in ledger
    const { rows: movs } = await db.query<{ movement_type: string; qty_delta: string }>(
      `select movement_type, qty_delta::text from stock_movements
        where source_doc_type = 'waste_log' and source_doc_id = $1
        order by movement_type`,
      [wasteLogId],
    );
    expect(movs.length).toBe(2);
    expect(movs[0].movement_type).toBe('staff_meal');
    expect(Number(movs[0].qty_delta)).toBe(-0.5);
    expect(movs[1].movement_type).toBe('wastage');
    expect(Number(movs[1].qty_delta)).toBe(-1.5);
  });

  it('rejects a waste log without moving stock', async () => {
    const { wasteLogId } = await createWasteLog(
      db,
      tenantId,
      stores.BAR,
      '2026-08-02',
      'Dropped bottle claim',
      testUserId ?? null,
    );

    await setWasteLogLines(db, tenantId, wasteLogId, [
      { itemId: items['RM-TEFF'], qty: '5', reason: 'spoilage' },
    ]);

    await submitWasteLog(db, tenantId, wasteLogId);
    await rejectWasteLog(db, tenantId, wasteLogId, testUserId ?? null, 'Insufficient evidence');

    const { rows } = await db.query<{ status: string; rejection_reason: string }>(
      `select status, rejection_reason from waste_logs where id = $1`,
      [wasteLogId],
    );
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].rejection_reason).toBe('Insufficient evidence');

    // Verify no movements recorded
    const { rows: movs } = await db.query(
      `select 1 from stock_movements where source_doc_type = 'waste_log' and source_doc_id = $1`,
      [wasteLogId],
    );
    expect(movs.length).toBe(0);
  });
});
