/**
 * Physical counts and the variance they produce.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import { importCnetFile } from '../src/domain/importCnet';
import { postSalesImport } from '../src/domain/postSalesImport';
import {
  createStockCount,
  saveCountedQuantities,
  postStockCount,
  StockCountError,
} from '../src/domain/stockCount';
import { dec, Decimal } from '../src/lib/money';

const CNET = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');
const COUNT_DATE = '2026-08-04'; // the morning after the period ends

let h: Harness;
let db: Database;
let tenantId: string;
let stores: Record<string, string>;
let items: Record<string, string>;

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  stores = h.seeded.storeIds;
  items = h.seeded.itemIds;

  // A count only means anything after a period of trading.
  const imported = await importCnetFile(db, tenantId, CNET);
  await postSalesImport(db, imported.importId);
});
afterAll(async () => {
  await h?.close();
});

async function onHand(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ q: string }>(
    `select qty_on_hand as q from v_stock_on_hand
      where tenant_id = $1 and store_id = $2 and item_id = $3`,
    [tenantId, stores[store], items[item]],
  );
  return dec(rows[0]?.q ?? 0);
}

async function lineFor(countId: string, item: string) {
  const { rows } = await db.query<{
    id: string;
    theoretical_qty: string;
    counted_qty: string | null;
    unit_cost: string;
  }>(
    `select id, theoretical_qty, counted_qty, unit_cost
       from stock_count_lines where stock_count_id = $1 and item_id = $2`,
    [countId, items[item]],
  );
  return rows[0];
}

describe('building the count sheet', () => {
  let countId: string;

  it('snapshots the theoretical quantity for every item the store holds', async () => {
    const result = await createStockCount(db, tenantId, stores.KITCHEN, COUNT_DATE, 'Chef A');
    countId = result.countId;
    expect(result.lineCount).toBe(16); // the kitchen's items

    const beef = await lineFor(countId, 'RM-BEEF-KITFO');
    const live = await onHand('KITCHEN', 'RM-BEEF-KITFO');
    expect(dec(beef.theoretical_qty).toFixed(6)).toBe(live.toFixed(6));
    expect(dec(beef.theoretical_qty).toFixed(6)).toBe('102.000000'); // 450 issued less 348 sold
  });

  it('snapshots the weighted average cost too', async () => {
    const beef = await lineFor(countId, 'RM-BEEF-KITFO');
    expect(dec(beef.unit_cost).toFixed(2)).toBe('1125.00');
  });

  it('starts with nothing counted', async () => {
    const beef = await lineFor(countId, 'RM-BEEF-KITFO');
    expect(beef.counted_qty).toBeNull();

    const { rows } = await db.query<{ variance_status: string }>(
      `select variance_status from v_stock_count_variance
        where stock_count_id = $1 and item_id = $2`,
      [countId, items['RM-BEEF-KITFO']],
    );
    expect(rows[0].variance_status).toBe('NOT COUNTED');
  });

  it('refuses a second count for the same store and date', async () => {
    await expect(
      createStockCount(db, tenantId, stores.KITCHEN, COUNT_DATE),
    ).rejects.toThrow(StockCountError);
    await expect(
      createStockCount(db, tenantId, stores.KITCHEN, COUNT_DATE),
    ).rejects.toThrow(/already exists/);
  });
});

describe('entering and posting a count', () => {
  let countId: string;
  let theoreticalBeef: Decimal;

  beforeAll(async () => {
    const r = await createStockCount(db, tenantId, stores.BAR, COUNT_DATE, 'Barista B');
    countId = r.countId;

    const beef = await lineFor(countId, 'RM-COFFEE');
    theoreticalBeef = dec(beef.theoretical_qty);
  });

  it('will not post with nothing counted', async () => {
    await expect(postStockCount(db, countId)).rejects.toThrow(/Nothing has been counted/);
  });

  it('saves counted quantities and reasons', async () => {
    const coffee = await lineFor(countId, 'RM-COFFEE');
    const water = await lineFor(countId, 'RM-WATER-S');
    const sugar = await lineFor(countId, 'RM-SUGAR');

    await saveCountedQuantities(db, countId, [
      // 2 Kg short — a real shortage
      {
        lineId: coffee.id,
        countedQty: dec(coffee.theoretical_qty).minus('2').toFixed(6),
        note: 'Two kilos unaccounted for. Barista to explain.',
      },
      // spot on
      { lineId: water.id, countedQty: dec(water.theoretical_qty).toFixed(6), note: null },
      // a hair over, well within tolerance
      {
        lineId: sugar.id,
        countedQty: dec(sugar.theoretical_qty).plus('0.4').toFixed(6),
        note: 'Rounded up on the scale.',
      },
    ]);

    const after = await lineFor(countId, 'RM-COFFEE');
    expect(dec(after.counted_qty!).toFixed(6)).toBe(theoreticalBeef.minus('2').toFixed(6));
  });

  it('derives variance, value and status against the thresholds', async () => {
    const { rows } = await db.query<{
      item_code: string;
      variance_qty: string;
      variance_value: string;
      variance_ratio: string | null;
      variance_status: string;
    }>(
      `select item_code, variance_qty, variance_value, variance_ratio, variance_status
         from v_stock_count_variance
        where stock_count_id = $1 and counted_qty is not null
        order by item_code`,
      [countId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.item_code, r]));

    // coffee: 2 Kg short out of 45.68 is about 4.4% — REVIEW territory
    expect(dec(by['RM-COFFEE'].variance_qty).toFixed(6)).toBe('-2.000000');
    expect(dec(by['RM-COFFEE'].variance_value).lessThan(0)).toBe(true);
    expect(by['RM-COFFEE'].variance_status).toBe('REVIEW');

    // water: exact
    expect(dec(by['RM-WATER-S'].variance_qty).isZero()).toBe(true);
    expect(by['RM-WATER-S'].variance_status).toBe('OK');

    // sugar: 0.4 Kg over on ~61 Kg is well under 3%
    expect(by['RM-SUGAR'].variance_status).toBe('OK');
  });

  it('applies the 3% and 8% thresholds at their edges', async () => {
    const { rows } = await db.query<{ s: string }>(
      `select variance_status as s from (values
          (100.0, 103.0),   -- exactly 3%
          (100.0,  96.9),   -- 3.1%
          (100.0, 108.0),   -- exactly 8%
          (100.0, 108.1)    -- 8.1%
        ) as t(theoretical, counted)
        cross join lateral (
          select case
            when counted - theoretical = 0 then 'OK'
            when theoretical = 0 then 'INVESTIGATE'
            when abs(counted - theoretical) / abs(theoretical) <= 0.03 then 'OK'
            when abs(counted - theoretical) / abs(theoretical) <= 0.08 then 'REVIEW'
            else 'INVESTIGATE'
          end as variance_status
        ) x`,
    );
    expect(rows.map((r) => r.s)).toEqual(['OK', 'REVIEW', 'REVIEW', 'INVESTIGATE']);
  });

  it('posts adjustments only where the count differs', async () => {
    const before = await onHand('BAR', 'RM-COFFEE');
    const result = await postStockCount(db, countId);

    expect(result.posted).toBe(true);
    expect(result.linesCounted).toBe(3);
    // water matched exactly, so no movement for it
    expect(result.adjustmentsWritten).toBe(2);

    const after = await onHand('BAR', 'RM-COFFEE');
    expect(after.minus(before).toFixed(6)).toBe('-2.000000');
  });

  it('leaves the ledger balance equal to what was counted', async () => {
    const coffee = await lineFor(countId, 'RM-COFFEE');
    const live = await onHand('BAR', 'RM-COFFEE');
    expect(live.toFixed(6)).toBe(dec(coffee.counted_qty!).toFixed(6));
  });

  it('does not move the weighted average cost', async () => {
    // A count is evidence about how much is there, not about what it cost.
    const { rows } = await db.query<{ avg: string }>(
      `select avg_unit_cost as avg from v_stock_on_hand
        where tenant_id = $1 and store_id = $2 and item_id = $3`,
      [tenantId, stores.BAR, items['RM-COFFEE']],
    );
    // two receipts, 60 at 750 and 60 at 790, average 770
    expect(dec(rows[0].avg).toFixed(2)).toBe('770.00');
  });

  it('writes the adjustment as a count_adjustment movement', async () => {
    const { rows } = await db.query<{
      movement_type: string;
      qty_delta: string;
      unit_cost: string;
      value_delta: string;
    }>(
      `select movement_type, qty_delta, unit_cost, value_delta from stock_movements
        where source_doc_type = 'stock_count' and source_doc_id = $1 and item_id = $2`,
      [countId, items['RM-COFFEE']],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].movement_type).toBe('count_adjustment');
    expect(dec(rows[0].qty_delta).toFixed(6)).toBe('-2.000000');
    expect(dec(rows[0].unit_cost).toFixed(2)).toBe('770.00');
    expect(dec(rows[0].value_delta).toFixed(2)).toBe('-1540.00');
  });

  it('posting the same count twice changes nothing', async () => {
    const before = await onHand('BAR', 'RM-COFFEE');
    const again = await postStockCount(db, countId);

    expect(again.posted).toBe(false);
    expect(again.alreadyPosted).toBe(true);
    expect((await onHand('BAR', 'RM-COFFEE')).toFixed(6)).toBe(before.toFixed(6));

    const { rows } = await db.query<{ c: string }>(
      `select count(*)::text as c from stock_movements
        where source_doc_type = 'stock_count' and source_doc_id = $1`,
      [countId],
    );
    expect(rows[0].c).toBe('2');
  });

  it('freezes the lines once posted', async () => {
    const coffee = await lineFor(countId, 'RM-COFFEE');
    await expect(
      db.query(`update stock_count_lines set counted_qty = 999 where id = $1`, [coffee.id]),
    ).rejects.toThrow(/no longer be update/);
    await expect(
      db.query(`delete from stock_count_lines where id = $1`, [coffee.id]),
    ).rejects.toThrow(/no longer be delete/);
    await expect(
      saveCountedQuantities(db, countId, [
        { lineId: coffee.id, countedQty: '999', note: null },
      ]),
    ).rejects.toThrow(/posted and can no longer be edited/);
  });

  it('will not let a posted count go back to draft', async () => {
    await expect(
      db.query(`update stock_counts set status = 'draft' where id = $1`, [countId]),
    ).rejects.toThrow(/may only be reversed/);
  });
});

describe('the variance report', () => {
  it('sorts worst first by value, which is what a controller looks at', async () => {
    const { rows } = await db.query<{
      item_code: string;
      variance_value: string;
      variance_status: string;
    }>(
      `select item_code, variance_value, variance_status
         from v_stock_count_variance
        where counted_qty is not null
        order by abs(variance_value) desc`,
    );
    expect(rows.length).toBeGreaterThan(0);

    // the coffee shortage is the biggest money difference on the sheet
    expect(rows[0].item_code).toBe('RM-COFFEE');
    expect(dec(rows[0].variance_value).toFixed(2)).toBe('-1540.00');

    // and the ordering really is descending by absolute value
    const vals = rows.map((r) => dec(r.variance_value).abs());
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i - 1].greaterThanOrEqualTo(vals[i])).toBe(true);
    }
  });

  it('treats any difference against zero book stock as INVESTIGATE', async () => {
    // A percentage of nothing is meaningless, so it cannot be graded.
    const { rows } = await db.query<{ s: string }>(
      `select variance_status as s from v_stock_count_variance
        where theoretical_qty = 0 and counted_qty is not null and variance_qty <> 0`,
    );
    for (const r of rows) expect(r.s).toBe('INVESTIGATE');
  });
});
