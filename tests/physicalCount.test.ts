/**
 * Phase 4: Materials Control Stock Movement & Physical Count Engine Tests
 *
 * Covers:
 *  1. Blind Count Sheets (HMC Inventur Zählliste ohne Sollbestand)
 *  2. Count Recount Threshold Evaluation (HMC InventoryBusinessProcessObject.cs)
 *  3. Supervisor Recount & Reason Code Resolution
 *  4. Posting Count Adjustments with Discrepancy Reasons
 *  5. Recipe Waste Explosion Write-off (HMC AddRecipeToWastePos.cs)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  createStockCount,
  saveCountedQuantities,
  getBlindCountSheet,
  submitCountForRecountEvaluation,
  recordRecount,
  postStockCount,
  StockCountError,
} from '../src/domain/stockCount';
import {
  createWasteLog,
  setWasteLogLines,
  submitWasteLog,
  approveWasteLog,
} from '../src/domain/wasteLog';
import { dec, Decimal } from '../src/lib/money';

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
});

afterAll(async () => {
  await h?.close();
});

describe('Phase 4: Materials Control Stock Movement & Physical Count Engine', () => {
  describe('1. Blind Physical Stocktaking (HMC Inventur Zählliste)', () => {
    it('creates a blind stock count and yields a blind count sheet omitting theoretical stock', async () => {
      const count = await createStockCount(
        db,
        tenantId,
        stores.BAR,
        '2026-08-10',
        'tester',
        true, // isBlind
      );

      expect(count.countId).toBeDefined();

      // Check DB record
      const { rows } = await db.query<{ is_blind: boolean; status: string }>(
        `select is_blind, status from stock_counts where id = $1`,
        [count.countId],
      );
      expect(rows[0].is_blind).toBe(true);
      expect(rows[0].status).toBe('draft');

      // Fetch the blind count sheet for stocktakers
      const sheet = await getBlindCountSheet(db, tenantId, count.countId);
      expect(sheet.length).toBeGreaterThan(0);

      for (const line of sheet) {
        expect(line.lineId).toBeDefined();
        expect(line.itemCode).toBeDefined();
        expect(line.itemName).toBeDefined();
        expect(line.uom).toBeDefined();
        // Assert theoretical book quantity is omitted from blind sheet to prevent biased counting
        expect((line as unknown as Record<string, unknown>).theoreticalQty).toBeUndefined();
        expect((line as unknown as Record<string, unknown>).theoretical_qty).toBeUndefined();
      }
    });
  });

  describe('2. Recount Evaluation & Supervisor Recount Resolution (HMC InventoryBusinessProcessObject)', () => {
    it('evaluates variances against threshold, halts posting when recount required, and approves after recount', async () => {
      const count = await createStockCount(
        db,
        tenantId,
        stores.BAR,
        '2026-08-11',
        'tester',
        true,
      );

      // Fetch lines to know IDs and items
      const { rows: lines } = await db.query<{
        id: string;
        item_id: string;
        theoretical_qty: string;
        unit_cost: string;
      }>(
        `select id, item_id, theoretical_qty, unit_cost from stock_count_lines where stock_count_id = $1`,
        [count.countId],
      );

      expect(lines.length).toBeGreaterThan(0);

      // Find coffee beans (high value item)
      const coffeeLine = lines.find((l) => l.item_id === items['RM-COFFEE']) ?? lines[0];
      const theoQty = dec(coffeeLine.theoretical_qty);

      // Simulate first count: count coffee 10 units short (at ~750 ETB/kg = 7500 ETB variance)
      const countedQty = theoQty.minus(10).toString();

      await saveCountedQuantities(db, count.countId, [
        {
          lineId: coffeeLine.id,
          countedQty: countedQty,
          discrepancyReason: 'portion_error',
        },
      ]);

      // Count evaluated against HMC thresholds: 500 ETB or 5%
      const evalResult = await submitCountForRecountEvaluation(db, tenantId, count.countId, {
        valThreshold: 500,
        pctThreshold: 5,
      });

      expect(evalResult.status).toBe('recount_required');
      expect(evalResult.flaggedLines).toBeGreaterThanOrEqual(1);
      expect(evalResult.totalVarianceVal.abs().toNumber()).toBeGreaterThan(500);

      // Attempting to post now must be blocked by HMC recount gate
      await expect(postStockCount(db, count.countId, 'controller')).rejects.toThrowError(
        StockCountError,
      );

      // Supervisor performs recount: verify counted quantity was actually only 2 units short
      const verifiedRecountQty = theoQty.minus(2).toString();
      const recountRes = await recordRecount(
        db,
        tenantId,
        count.countId,
        [
          {
            lineId: coffeeLine.id,
            recountQty: verifiedRecountQty,
            discrepancyReason: 'portion_error',
          },
        ],
        'supervisor_user',
      );

      expect(recountRes.resolvedLines).toBe(1);
      expect(recountRes.status).toBe('approved');

      // Verify DB line state
      const { rows: updatedLine } = await db.query<{
        counted_qty: string;
        recount_qty: string;
        recount_status: string;
        discrepancy_reason: string;
      }>(`select counted_qty, recount_qty, recount_status, discrepancy_reason from stock_count_lines where id = $1`, [
        coffeeLine.id,
      ]);

      expect(dec(updatedLine[0].counted_qty).toString()).toBe(verifiedRecountQty);
      expect(dec(updatedLine[0].recount_qty).toString()).toBe(verifiedRecountQty);
      expect(updatedLine[0].recount_status).toBe('recounted');
      expect(updatedLine[0].discrepancy_reason).toBe('portion_error');

      // Now posting succeeds
      const posted = await postStockCount(db, count.countId, 'controller');
      expect(posted.posted).toBe(true);

      // Check stock movement records contain the discrepancy reason
      const { rows: movements } = await db.query<{
        movement_type: string;
        qty_delta: string;
        note: string;
      }>(
        `select movement_type, qty_delta, note from stock_movements
          where source_doc_type = 'stock_count' and source_doc_id = $1 and item_id = $2`,
        [count.countId, coffeeLine.item_id],
      );

      expect(movements.length).toBe(1);
      expect(movements[0].movement_type).toBe('count_adjustment');
      expect(dec(movements[0].qty_delta).abs().toString()).toBe('2');
      expect(movements[0].note).toContain('portion_error');
    });

    it('allows a supervisor to waive a flagged recount with an explanation', async () => {
      const count = await createStockCount(
        db,
        tenantId,
        stores.BAR,
        '2026-08-12',
        'tester',
        false,
      );

      const { rows: lines } = await db.query<{ id: string; theoretical_qty: string; item_id: string }>(
        `select id, theoretical_qty, item_id from stock_count_lines where stock_count_id = $1`,
        [count.countId],
      );

      const coffeeLine = lines.find((l) => l.item_id === items['RM-COFFEE']) ?? lines[0];
      const theoQty = dec(coffeeLine.theoretical_qty);

      // Save count with large shortage
      await saveCountedQuantities(db, count.countId, [
        {
          lineId: coffeeLine.id,
          countedQty: theoQty.minus(15).toString(),
        },
      ]);

      // Recount evaluation flags the count
      const evalResult = await submitCountForRecountEvaluation(db, tenantId, count.countId, {
        valThreshold: 500,
        pctThreshold: 5,
      });
      expect(evalResult.status).toBe('recount_required');

      // Supervisor waives the recount after confirming actual loss occurred
      const recountRes = await recordRecount(
        db,
        tenantId,
        count.countId,
        [
          {
            lineId: coffeeLine.id,
            recountQty: theoQty.minus(15).toString(),
            discrepancyReason: 'spoilage',
            waive: true,
          },
        ],
        'supervisor_user',
      );

      expect(recountRes.resolvedLines).toBe(1);
      expect(recountRes.status).toBe('approved');

      const { rows: updated } = await db.query<{ recount_status: string }>(
        `select recount_status from stock_count_lines where id = $1`,
        [coffeeLine.id],
      );
      expect(updated[0].recount_status).toBe('waived');

      const posted = await postStockCount(db, count.countId, 'controller');
      expect(posted.posted).toBe(true);
    });
  });

  describe('3. Recipe Waste Explosion (HMC AddRecipeToWastePos)', () => {
    it('explodes finished recipe into raw ingredients and writes off inventory at ingredient level', async () => {
      // Find recipe for Traditional Coffee (RC-TRADCOF)
      const { rows: recipes } = await db.query<{ id: string; code: string }>(
        `select id, code from recipes where code = 'RC-TRADCOF' and tenant_id = $1`,
        [tenantId],
      );
      expect(recipes.length).toBe(1);
      const tradCof = recipes[0];

      // Measure starting stock for Coffee Beans and Sugar in BAR store
      const { rows: initialOnHand } = await db.query<{ item_id: string; qty_on_hand: string }>(
        `select item_id, qty_on_hand from v_stock_on_hand
          where tenant_id = $1 and store_id = $2 and item_id in ($3, $4)`,
        [tenantId, stores.BAR, items['RM-COFFEE'], items['RM-SUGAR']],
      );

      const initialCoffee = dec(
        initialOnHand.find((r) => r.item_id === items['RM-COFFEE'])?.qty_on_hand ?? '0',
      );
      const initialSugar = dec(
        initialOnHand.find((r) => r.item_id === items['RM-SUGAR'])?.qty_on_hand ?? '0',
      );

      // Create a draft waste log
      const { wasteLogId } = await createWasteLog(
        db,
        tenantId,
        stores.BAR,
        '2026-08-15',
        'Customer sent back 10 burned coffees',
        null,
      );

      // Log 10 portions of RC-TRADCOF
      await setWasteLogLines(db, tenantId, wasteLogId, [
        {
          recipeId: tradCof.id,
          portions: '10',
          reason: 'burnt',
          note: 'Burnt extraction batch',
        },
      ]);

      // Submit waste log
      await submitWasteLog(db, tenantId, wasteLogId);

      // Approve waste log (triggers explosion)
      const approveResult = await approveWasteLog(db, tenantId, wasteLogId, null);
      expect(approveResult.linesApproved).toBe(1);

      // Verify line in DB has exploded cost populated
      const { rows: wasteLines } = await db.query<{
        unit_cost: string;
        total_cost: string;
      }>(`select unit_cost, total_cost from waste_log_lines where waste_log_id = $1`, [wasteLogId]);

      expect(wasteLines.length).toBe(1);
      expect(dec(wasteLines[0].unit_cost).toNumber()).toBeGreaterThan(0);
      expect(dec(wasteLines[0].total_cost).toNumber()).toBeGreaterThan(0);

      // Verify stock movements were created for the exploded raw components (Coffee and Sugar)
      const { rows: movements } = await db.query<{
        item_id: string;
        movement_type: string;
        qty_delta: string;
        note: string;
      }>(
        `select item_id, movement_type, qty_delta, note
           from stock_movements
          where source_doc_type = 'waste_log' and source_doc_id = $1
          order by item_id`,
        [wasteLogId],
      );

      // RC-TRADCOF recipe has 2 components: RM-COFFEE (0.022 kg x 10 = 0.22 kg) and RM-SUGAR (0.012 kg x 10 = 0.12 kg)
      expect(movements.length).toBe(2);

      const coffeeMv = movements.find((m) => m.item_id === items['RM-COFFEE']);
      const sugarMv = movements.find((m) => m.item_id === items['RM-SUGAR']);

      expect(coffeeMv).toBeDefined();
      expect(dec(coffeeMv!.qty_delta).toString()).toBe('-0.22');
      expect(coffeeMv!.movement_type).toBe('wastage');

      expect(sugarMv).toBeDefined();
      expect(dec(sugarMv!.qty_delta).toString()).toBe('-0.12');
      expect(sugarMv!.movement_type).toBe('wastage');

      // Check on-hand reduction in BAR
      const { rows: postOnHand } = await db.query<{ item_id: string; qty_on_hand: string }>(
        `select item_id, qty_on_hand from v_stock_on_hand
          where tenant_id = $1 and store_id = $2 and item_id in ($3, $4)`,
        [tenantId, stores.BAR, items['RM-COFFEE'], items['RM-SUGAR']],
      );

      const postCoffee = dec(
        postOnHand.find((r) => r.item_id === items['RM-COFFEE'])?.qty_on_hand ?? '0',
      );
      const postSugar = dec(
        postOnHand.find((r) => r.item_id === items['RM-SUGAR'])?.qty_on_hand ?? '0',
      );

      expect(initialCoffee.minus(postCoffee).toString()).toBe('0.22');
      expect(initialSugar.minus(postSugar).toString()).toBe('0.12');
    });
  });
});
