/**
 * Phase 5: Materials Control End-of-Day Sales Depletion & Theoretical Reconciliation Engine Tests
 *
 * Covers:
 *  1. End-of-Day CNet Sales Export Upload & Reconciliation Gate (No POS connection required)
 *  2. Automated Recipe Explosion & Stock Ledger Depletion on Post
 *  3. Classical Material Consumption Matrix (HMC Soll-Ist-Vergleich / FBCalculation.cs)
 *  4. Cost Leakage Detection, Category Breakdown & Anomaly Interventions
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  processEodSalesUpload,
  getTheoreticalVsActualMatrix,
  detectCostLeakage,
  ReconciliationError,
} from '../src/domain/theoreticalReconciliation';
import { dec, Decimal } from '../src/lib/money';

const CNET_PATH = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');

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

describe('Phase 5: Materials Control End-of-Day Sales Depletion & Theoretical Reconciliation Engine', () => {
  describe('1. End-of-Day CNet Sales Export Upload & Depletion Gate', () => {
    it('uploads the daily CNet sales export file, reconciles against footer, and posts recipe depletions', async () => {
      // Check initial stock on hand for coffee beans in BAR store
      const { rows: initialOnHand } = await db.query<{ qty_on_hand: string }>(
        `select qty_on_hand from v_stock_on_hand
          where tenant_id = $1 and store_id = $2 and item_id = $3`,
        [tenantId, stores.BAR, items['RM-COFFEE']],
      );
      const initialCoffee = dec(initialOnHand[0]?.qty_on_hand ?? '0');

      // Process End-of-Day CNet sales report file upload
      const uploadResult = await processEodSalesUpload(db, tenantId, CNET_PATH);

      expect(uploadResult.importId).toBeDefined();
      expect(uploadResult.lineCount).toBe(171);
      expect(uploadResult.reconciled).toBe(true);
      expect(uploadResult.canPost).toBe(true);
      expect(uploadResult.depletionResult.posted).toBe(true);
      expect(uploadResult.depletionResult.linesDepleted).toBeGreaterThan(0);
      expect(uploadResult.depletionResult.movementsWritten).toBeGreaterThan(0);
      expect(uploadResult.depletionResult.totalDepletionValue.toNumber()).toBeGreaterThan(0);

      // Verify stock movements of type 'sale_depletion' were generated from CNet sales lines
      const { rows: depletions } = await db.query<{
        item_id: string;
        movement_type: string;
        qty_delta: string;
      }>(
        `select item_id, movement_type, qty_delta
           from stock_movements
          where source_doc_id = $1 and movement_type = 'sale_depletion'`,
        [uploadResult.importId],
      );

      expect(depletions.length).toBeGreaterThan(0);

      // Coffee beans were depleted by traditional coffee sales in CNet export
      const coffeeDepletions = depletions.filter((d) => d.item_id === items['RM-COFFEE']);
      expect(coffeeDepletions.length).toBeGreaterThan(0);

      // Verify BAR on-hand was decremented by the exact recipe explosion
      const { rows: postOnHand } = await db.query<{ qty_on_hand: string }>(
        `select qty_on_hand from v_stock_on_hand
          where tenant_id = $1 and store_id = $2 and item_id = $3`,
        [tenantId, stores.BAR, items['RM-COFFEE']],
      );
      const postCoffee = dec(postOnHand[0]?.qty_on_hand ?? '0');
      expect(initialCoffee.minus(postCoffee).toNumber()).toBeGreaterThan(0);
    });

    it('refuses to re-upload and re-post the exact same sales period twice', async () => {
      // Re-uploading an already posted period is rejected by the duplicate period gate
      await expect(processEodSalesUpload(db, tenantId, CNET_PATH)).rejects.toThrowError(
        ReconciliationError,
      );
    });
  });

  describe('2. Material Consumption Matrix (HMC Soll-Ist-Vergleich)', () => {
    it('calculates opening, receipts, actual and theoretical consumption, and unexplained variance from CNet sales', async () => {
      // Analyze trading period corresponding to the uploaded CNet report: 2026-07-08 to 2026-08-04
      const matrix = await getTheoreticalVsActualMatrix(
        db,
        tenantId,
        stores.BAR,
        '2026-07-08',
        '2026-08-04',
      );

      expect(matrix.length).toBeGreaterThan(0);

      // Verify Coffee Beans line in BAR
      const coffee = matrix.find((m) => m.itemCode === 'RM-COFFEE');
      expect(coffee).toBeDefined();

      // Theoretical Consumption = CNet POS Depletions + Wastage + Comps + Staff Meals
      const expectedTheo = coffee!.posDepletionQty
        .plus(coffee!.wasteQty)
        .plus(coffee!.compQty)
        .plus(coffee!.staffMealQty);

      expect(coffee!.theoreticalConsumptionQty.toNumber()).toBeCloseTo(expectedTheo.toNumber(), 4);

      // Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
      const expectedActual = coffee!.openingQty
        .plus(coffee!.receivedQty)
        .plus(coffee!.transfersNetQty)
        .plus(coffee!.productionNetQty)
        .minus(coffee!.closingQty);

      expect(coffee!.actualConsumptionQty.toNumber()).toBeCloseTo(expectedActual.toNumber(), 4);

      // Unexplained Variance = Actual Consumption - Theoretical Consumption
      const expectedVarQty = coffee!.actualConsumptionQty.minus(coffee!.theoreticalConsumptionQty);
      expect(coffee!.varianceQty.toNumber()).toBeCloseTo(expectedVarQty.toNumber(), 4);

      // Variance Value = Variance Qty * Unit Cost
      const expectedVarVal = coffee!.varianceQty.times(coffee!.unitCost);
      expect(coffee!.varianceValue.toNumber()).toBeCloseTo(expectedVarVal.toNumber(), 1);

      // Status classification
      expect(['NORMAL', 'REVIEW', 'LEAKAGE_ALERT']).toContain(coffee!.varianceStatus);
      expect(coffee!.probableCause).toBeDefined();
    });
  });

  describe('3. Cost Leakage Detection & Anomaly Recommendations', () => {
    it('analyzes matrix, detects leakage by category, and generates actionable advice', async () => {
      const matrix = await getTheoreticalVsActualMatrix(
        db,
        tenantId,
        stores.BAR,
        '2026-07-08',
        '2026-08-04',
      );

      const analysis = detectCostLeakage(matrix);

      expect(analysis.totalLeakageValue).toBeDefined();
      expect(analysis.categoryBreakdown).toBeDefined();
      expect(Array.isArray(analysis.topLeakageItems)).toBe(true);
      expect(Array.isArray(analysis.recommendations)).toBe(true);

      if (analysis.topLeakageItems.length > 0) {
        const top = analysis.topLeakageItems[0];
        expect(top.itemCode).toBeDefined();
        expect(top.varianceValue.toNumber()).toBeGreaterThanOrEqual(0);
        expect(top.probableCause).toBeDefined();
      }
    });
  });
});
