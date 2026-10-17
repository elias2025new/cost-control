/**
 * Phase 6: Materials Control Executive Cost Control Reporting Suite Tests
 *
 * Covers:
 *  1. Comprehensive Food & Beverage Cost Reconciliation (Actual vs. Theoretical / Potential Savings)
 *  2. Cost Center Comparison Matrix across Outlets (Kitchen vs. Bar vs. Central Store)
 *  3. ABC Inventory Valuation Analysis (Pareto Capital Efficiency)
 *  4. Forward-Only Article Transaction History Ledger (Stock Card / Audit Trail)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import { importCnetFile } from '../src/domain/importCnet';
import { postSalesImport } from '../src/domain/postSalesImport';
import {
  getFbCostReconciliation,
  getCostCenterSummary,
  getAbcInventoryValuation,
  getArticleTransactionHistory,
} from '../src/domain/executiveReporting';
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

  // Ingest and post the client's CNet sales export to establish real trading data
  const imported = await importCnetFile(db, tenantId, CNET_PATH);
  await postSalesImport(db, imported.importId);
});

afterAll(async () => {
  await h?.close();
});

describe('Phase 6: Materials Control Executive Reporting Suite', () => {
  describe('1. Food & Beverage Cost Reconciliation (Actual vs Theoretical)', () => {
    it('reports Food and Beverage separately, computing actual vs theoretical cost % and potential savings', async () => {
      const reports = await getFbCostReconciliation(
        db,
        tenantId,
        '2026-07-08',
        '2026-08-04',
      );

      expect(reports).toHaveLength(2);
      const food = reports.find((r) => r.kind === 'food');
      const bev = reports.find((r) => r.kind === 'beverage');

      expect(food).toBeDefined();
      expect(bev).toBeDefined();

      // Verify Food metrics
      expect(food!.revenueTotal.toNumber()).toBeGreaterThan(0);
      expect(food!.revenueCosted.toNumber()).toBeGreaterThan(0);
      expect(food!.coveragePct?.toNumber()).toBeGreaterThan(0);
      expect(food!.openingStock.toNumber()).toBeGreaterThan(0);
      expect(food!.purchases.toNumber()).toBeGreaterThanOrEqual(0);
      expect(food!.closingStock.toNumber()).toBeGreaterThan(0);
      expect(food!.grossConsumption.toNumber()).toBeGreaterThan(0);
      expect(food!.netCostOfSales.toNumber()).toBeGreaterThan(0);
      expect(food!.actualCostPct).not.toBeNull();
      expect(food!.theoreticalCost.toNumber()).toBeGreaterThan(0);
      expect(food!.theoreticalCostPct).not.toBeNull();
      expect(food!.varianceValue).toBeDefined();
      expect(food!.potentialSavings.toNumber()).toBeGreaterThanOrEqual(0);

      // Verify Beverage metrics
      expect(bev!.revenueTotal.toNumber()).toBeGreaterThan(0);
      expect(bev!.revenueCosted.toNumber()).toBeGreaterThan(0);
      expect(bev!.coveragePct?.toNumber()).toBeGreaterThan(0);
      expect(bev!.openingStock.toNumber()).toBeGreaterThan(0);
      expect(bev!.closingStock.toNumber()).toBeGreaterThan(0);
      expect(bev!.netCostOfSales.toNumber()).toBeGreaterThan(0);
      expect(bev!.actualCostPct).not.toBeNull();
      expect(bev!.theoreticalCost.toNumber()).toBeGreaterThan(0);
      expect(bev!.theoreticalCostPct).not.toBeNull();

      // Food and Beverage are never merged into a single blended row
      expect(food!.kind).toBe('food');
      expect(bev!.kind).toBe('beverage');
    });
  });

  describe('2. Cost Center Comparison Matrix across Outlets', () => {
    it('summarizes deliveries, internal transfers, production, depletions, and turnover ratios per store', async () => {
      const centers = await getCostCenterSummary(
        db,
        tenantId,
        '2026-07-08',
        '2026-08-04',
      );

      expect(centers.length).toBeGreaterThanOrEqual(2);

      const kitchen = centers.find((c) => c.storeId === stores.KITCHEN);
      const bar = centers.find((c) => c.storeId === stores.BAR);

      expect(kitchen).toBeDefined();
      expect(bar).toBeDefined();

      // Kitchen receives food deliveries and has opening balance
      expect(kitchen!.openingValue.toNumber()).toBeGreaterThan(0);
      expect(kitchen!.purchasesValue.toNumber()).toBeGreaterThanOrEqual(0);
      expect(kitchen!.closingValue.toNumber()).toBeGreaterThan(0);
      expect(kitchen!.netConsumptionValue.toNumber()).toBeGreaterThan(0);
      expect(kitchen!.turnoverRatio.toNumber()).toBeGreaterThanOrEqual(0);

      // Bar receives beverages and has sales depletions
      expect(bar!.openingValue.toNumber()).toBeGreaterThan(0);
      expect(bar!.closingValue.toNumber()).toBeGreaterThan(0);
      expect(bar!.depletionValue.toNumber()).toBeGreaterThan(0);
      expect(bar!.netConsumptionValue.toNumber()).toBeGreaterThan(0);
    });
  });

  describe('3. ABC Inventory Valuation Analysis (Pareto Capital Efficiency)', () => {
    it('classifies stock capital distribution according to HMC 80/15/5 Pareto rule', async () => {
      const valuation = await getAbcInventoryValuation(db, tenantId);

      expect(valuation.totalInventoryValue.toNumber()).toBeGreaterThan(0);
      expect(valuation.classes.length).toBeGreaterThan(0);

      const classA = valuation.classes.find((c) => c.abcClass === 'A');
      const classB = valuation.classes.find((c) => c.abcClass === 'B');
      const classC = valuation.classes.find((c) => c.abcClass === 'C');

      expect(classA).toBeDefined();
      expect(classA!.itemCount).toBeGreaterThan(0);
      expect(classA!.totalStockValue.toNumber()).toBeGreaterThan(0);

      // Class A represents the primary capital investment (>50% of stock capital)
      expect(classA!.percentageOfCapital.toNumber()).toBeGreaterThan(50);

      if (classB) {
        expect(classB.itemCount).toBeGreaterThan(0);
        expect(classB.totalStockValue.toNumber()).toBeGreaterThan(0);
      }
      if (classC) {
        expect(classC.itemCount).toBeGreaterThan(0);
      }

      // Sum of percentages equals 100%
      const sumPct = valuation.classes.reduce(
        (sum, c) => sum.plus(c.percentageOfCapital),
        dec(0),
      );
      expect(sumPct.toNumber()).toBeCloseTo(100, 1);
    });
  });

  describe('4. Forward-Only Article Transaction History Ledger (Stock Card / Audit Trail)', () => {
    it('returns chronological audit trail with exact running on-hand quantities and moving weighted average costs', async () => {
      const history = await getArticleTransactionHistory(
        db,
        tenantId,
        stores.BAR,
        items['RM-COFFEE'],
        '2026-07-01',
        '2026-08-30',
      );

      expect(history.length).toBeGreaterThanOrEqual(2);

      // First movement must be opening, receipt, or issue_in
      const first = history[0];
      expect(['opening', 'receipt', 'issue_in']).toContain(first.movementType);
      expect(first.qtyDelta.toNumber()).toBeGreaterThan(0);
      expect(first.runningQty.toNumber()).toBe(first.qtyDelta.toNumber());
      expect(first.runningAvgCost.toNumber()).toBe(first.unitCost.toNumber());

      // Should include second receipt and sales depletions
      const depletions = history.filter((h) => h.movementType === 'sale_depletion');
      expect(depletions.length).toBeGreaterThan(0);

      // Verify mathematical progression across rows: runningQty[i] = runningQty[i-1] + qtyDelta[i]
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];

        const expectedQty = prev.runningQty.plus(curr.qtyDelta);
        expect(curr.runningQty.toNumber()).toBeCloseTo(expectedQty.toNumber(), 5);

        // Average cost must never be negative
        expect(curr.runningAvgCost.toNumber()).toBeGreaterThan(0);
        expect(curr.runningValue.toNumber()).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
