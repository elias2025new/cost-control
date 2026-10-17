/**
 * Production Batches & Butcher Yield Test Engine
 *
 * Re-engineers Oracle Hospitality Materials Control (HMC):
 * - Batch Production of Sub-Recipes (PRODUKTION / PRODPOS / ProductionDBusinessObject.cs)
 * - Butcher Tests & Yield Cut Calculations (YIELD / YIELDPOS / YieldBusinessObject.cs)
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';
import { explodeRecipe } from './costRecipe';

export class ProductionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'BATCH_NOT_FOUND'
      | 'YIELD_TEST_NOT_FOUND'
      | 'INVALID_STATUS'
      | 'ALREADY_POSTED'
      | 'INSUFFICIENT_STOCK'
      | 'RECIPE_NOT_FOUND'
      | 'INVALID_YIELD_INPUT',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProductionError';
  }
}

export interface YieldCutInput {
  cutName: string;
  itemId?: string;
  isByproduct?: boolean;
  weight: number | string | Decimal;
  marketPricePerKg?: number | string | Decimal;
}

export interface CalculatedYieldCut {
  cutName: string;
  itemId?: string;
  isByproduct: boolean;
  weight: Decimal;
  weightPercent: Decimal;
  marketPricePerKg: Decimal;
  allocatedCostPerKg: Decimal;
  totalLineCost: Decimal;
}

export interface YieldTestCalculationResult {
  grossWeight: Decimal;
  grossCostPerKg: Decimal;
  totalPrimalCost: Decimal;
  totalYieldedWeight: Decimal;
  wasteWeight: Decimal;
  lossPercent: Decimal;
  usableWeight: Decimal;
  usableYieldPercent: Decimal;
  byproductTotalValue: Decimal;
  netPrimeCost: Decimal;
  costFactor: Decimal;
  cuts: CalculatedYieldCut[];
}

/**
 * 1. Pure Mathematical Butcher / Yield Test Calculation (HMC YIELD algorithm)
 *
 * Breakdown of whole primal meat cuts (e.g. 50 kg Beef Hindquarter):
 * - Sum cut weights and determine trim/waste loss.
 * - Value byproducts (bones, fat) at market salvage price (Byproduct Credit Method).
 * - Net Prime Cost = Total Primal Cost - Byproduct Credit.
 * - Prime cuts absorb net prime cost proportionally by market value ratio or weight.
 * - Computes Cost Factor per kg = Prime Cut Cost / Primal Cost.
 */
export function calculateYieldTest(opts: {
  grossWeight: number | string | Decimal;
  grossCostPerKg: number | string | Decimal;
  cuts: YieldCutInput[];
}): YieldTestCalculationResult {
  const grossWeight = new Decimal(opts.grossWeight);
  const grossCostPerKg = new Decimal(opts.grossCostPerKg);

  if (grossWeight.lte(0)) {
    throw new ProductionError('Gross primal weight must be greater than zero.', 'INVALID_YIELD_INPUT');
  }
  if (grossCostPerKg.lt(0)) {
    throw new ProductionError('Gross cost per kg cannot be negative.', 'INVALID_YIELD_INPUT');
  }

  const totalPrimalCost = grossWeight.mul(grossCostPerKg);

  let totalCutWeight = new Decimal(0);
  let byproductWeight = new Decimal(0);
  let byproductValue = new Decimal(0);
  let primeWeight = new Decimal(0);
  let primeMarketTotal = new Decimal(0);

  const parsedCuts = opts.cuts.map((c) => {
    const w = new Decimal(c.weight);
    const isByproduct = Boolean(c.isByproduct);
    const mPrice = new Decimal(c.marketPricePerKg ?? 0);

    totalCutWeight = totalCutWeight.plus(w);
    if (isByproduct) {
      byproductWeight = byproductWeight.plus(w);
      byproductValue = byproductValue.plus(w.mul(mPrice));
    } else {
      primeWeight = primeWeight.plus(w);
      primeMarketTotal = primeMarketTotal.plus(w.mul(mPrice));
    }

    return {
      cutName: c.cutName,
      itemId: c.itemId,
      isByproduct,
      weight: w,
      marketPrice: mPrice,
    };
  });

  if (totalCutWeight.gt(grossWeight)) {
    throw new ProductionError(
      `Total cut weights (${totalCutWeight.toString()} kg) exceed gross primal weight (${grossWeight.toString()} kg).`,
      'INVALID_YIELD_INPUT',
    );
  }

  const wasteWeight = grossWeight.minus(totalCutWeight);
  const lossPercent = wasteWeight.div(grossWeight).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const usableWeight = primeWeight;
  const usableYieldPercent = grossWeight.gt(0)
    ? usableWeight.div(grossWeight).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);

  // Net cost to allocate among prime cuts
  const netPrimeCost = totalPrimalCost.minus(byproductValue);

  const calculatedCuts: CalculatedYieldCut[] = parsedCuts.map((c) => {
    const weightPct = grossWeight.gt(0)
      ? c.weight.div(grossWeight).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);

    let allocatedUnitCost: Decimal;
    let totalLineCost: Decimal;

    if (c.isByproduct) {
      allocatedUnitCost = c.marketPrice;
      totalLineCost = c.weight.mul(allocatedUnitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else {
      // Allocate net prime cost based on relative market value if available, else by weight
      if (primeMarketTotal.gt(0)) {
        const lineMarketShare = c.weight.mul(c.marketPrice).div(primeMarketTotal);
        totalLineCost = netPrimeCost.mul(lineMarketShare).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        allocatedUnitCost = c.weight.gt(0)
          ? totalLineCost.div(c.weight).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : new Decimal(0);
      } else {
        allocatedUnitCost = primeWeight.gt(0)
          ? netPrimeCost.div(primeWeight).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : new Decimal(0);
        totalLineCost = c.weight.mul(allocatedUnitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      }
    }

    return {
      cutName: c.cutName,
      itemId: c.itemId,
      isByproduct: c.isByproduct,
      weight: c.weight,
      weightPercent: weightPct,
      marketPricePerKg: c.marketPrice,
      allocatedCostPerKg: allocatedUnitCost,
      totalLineCost,
    };
  });

  // Average prime cost factor = Average Prime Cost / Gross Primal Cost
  const avgPrimeCost = usableWeight.gt(0) ? netPrimeCost.div(usableWeight) : grossCostPerKg;
  const costFactor = grossCostPerKg.gt(0)
    ? avgPrimeCost.div(grossCostPerKg).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    : new Decimal(1);

  return {
    grossWeight,
    grossCostPerKg,
    totalPrimalCost: totalPrimalCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    totalYieldedWeight: totalCutWeight,
    wasteWeight,
    lossPercent,
    usableWeight,
    usableYieldPercent,
    byproductTotalValue: byproductValue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    netPrimeCost: netPrimeCost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    costFactor,
    cuts: calculatedCuts,
  };
}

/**
 * 2. Create and Record Butcher Yield Test in Database (HMC YIELD)
 */
export async function createYieldTestRecord(
  db: Database,
  opts: {
    tenantId: string;
    storeId: string;
    primalItemId: string;
    testNumber: string;
    grossWeight: number | string | Decimal;
    grossCostPerKg: number | string | Decimal;
    cuts: YieldCutInput[];
    notes?: string;
    createdBy?: string;
  },
): Promise<{ yieldTestId: string; result: YieldTestCalculationResult }> {
  const calc = calculateYieldTest({
    grossWeight: opts.grossWeight,
    grossCostPerKg: opts.grossCostPerKg,
    cuts: opts.cuts,
  });

  return db.transaction(async (tx) => {
    const { rows: y } = await tx.query<{ id: string }>(
      `insert into yield_tests
         (tenant_id, test_number, store_id, primal_item_id, test_date, gross_weight,
          gross_cost_per_kg, total_primal_cost, usable_weight, waste_weight, yield_percent,
          loss_percent, cost_factor, status, notes, created_by)
       values ($1, $2, $3, $4, current_date, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $14)
       returning id`,
      [
        opts.tenantId,
        opts.testNumber,
        opts.storeId,
        opts.primalItemId,
        qtyParam(calc.grossWeight),
        moneyParam(calc.grossCostPerKg),
        moneyParam(calc.totalPrimalCost),
        qtyParam(calc.usableWeight),
        qtyParam(calc.wasteWeight),
        calc.usableYieldPercent.toNumber(),
        calc.lossPercent.toNumber(),
        calc.costFactor.toNumber(),
        opts.notes ?? null,
        opts.createdBy ?? 'system',
      ],
    );
    const yieldTestId = y[0].id;

    let lineNo = 1;
    for (const cut of calc.cuts) {
      await tx.query(
        `insert into yield_test_lines
           (tenant_id, yield_test_id, line_no, cut_name, item_id, is_byproduct, weight,
            weight_percent, market_price_per_kg, allocated_cost_per_kg, total_line_cost)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          opts.tenantId,
          yieldTestId,
          lineNo++,
          cut.cutName,
          cut.itemId ?? null,
          cut.isByproduct,
          qtyParam(cut.weight),
          cut.weightPercent.toNumber(),
          moneyParam(cut.marketPricePerKg),
          moneyParam(cut.allocatedCostPerKg),
          moneyParam(cut.totalLineCost),
        ],
      );
    }

    return { yieldTestId, result: calc };
  });
}

/**
 * 3. Post Butcher Yield Test into Stock Ledger
 * - Issues gross primal carcass from store inventory (butcher_primal_issue)
 * - Books yielded cuts & byproducts into store inventory (butcher_cut_receipt)
 */
export async function postButcherYieldBatch(
  db: Database,
  tenantId: string,
  yieldTestId: string,
  actorUserId: string = 'system',
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows: yRows } = await tx.query<{
      id: string;
      store_id: string;
      primal_item_id: string;
      test_date: string;
      gross_weight: string;
      gross_cost_per_kg: string;
      total_primal_cost: string;
      status: string;
    }>(
      `select id, store_id, primal_item_id, test_date::text as test_date, gross_weight::text,
              gross_cost_per_kg::text, total_primal_cost::text, status
         from yield_tests where id = $1 and tenant_id = $2 for update`,
      [yieldTestId, tenantId],
    );
    if (!yRows.length) throw new ProductionError('Yield test not found.', 'YIELD_TEST_NOT_FOUND');
    const yt = yRows[0];
    if (yt.status === 'posted') throw new ProductionError('Yield test already posted.', 'ALREADY_POSTED');

    // 1. Issue primal cut
    const primalQty = dec(yt.gross_weight);
    const primalUnitCost = dec(yt.gross_cost_per_kg);
    const primalTotalVal = dec(yt.total_primal_cost);

    await tx.query(
      `insert into stock_movements
         (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
          occurred_on, source_doc_type, source_doc_id, note, created_by)
       values ($1, $2, $3, 'butcher_primal_issue', $4, $5, $6, $7::date,
               'yield_test', $8, 'Primal cut issued to butchery', $9)`,
      [
        tenantId,
        yt.store_id,
        yt.primal_item_id,
        qtyParam(primalQty.negated()),
        moneyParam(primalUnitCost),
        moneyParam(primalTotalVal.negated()),
        yt.test_date.slice(0, 10),
        yieldTestId,
        actorUserId,
      ],
    );

    // 2. Book yielded cuts into inventory
    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string | null;
      cut_name: string;
      weight: string;
      allocated_cost_per_kg: string;
      total_line_cost: string;
    }>(
      `select id, item_id, cut_name, weight::text, allocated_cost_per_kg::text, total_line_cost::text
         from yield_test_lines where yield_test_id = $1`,
      [yieldTestId],
    );

    for (const line of lines) {
      if (line.item_id) {
        const cutQty = dec(line.weight);
        const cutUnitCost = dec(line.allocated_cost_per_kg);
        const cutVal = dec(line.total_line_cost);

        await tx.query(
          `insert into stock_movements
             (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
              occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
           values ($1, $2, $3, 'butcher_cut_receipt', $4, $5, $6, $7::date,
                   'yield_test', $8, $9, $10, $11)`,
          [
            tenantId,
            yt.store_id,
            line.item_id,
            qtyParam(cutQty),
            moneyParam(cutUnitCost),
            moneyParam(cutVal),
            yt.test_date.slice(0, 10),
            yieldTestId,
            line.id,
            `Yielded from butcher test: ${line.cut_name}`,
            actorUserId,
          ],
        );
      }
    }

    await tx.query(
      `update yield_tests set status = 'posted', posted_at = now() where id = $1`,
      [yieldTestId],
    );
  });
}

/**
 * 4. Create Batch Production for Sub-Recipe (HMC PRODUKTION)
 * - Explodes sub-recipe lines to determine component quantities
 * - Supports batch multipliers (e.g. producing 5 batches of Niter Kibbeh)
 */
export async function createProductionBatch(
  db: Database,
  opts: {
    tenantId: string;
    storeId: string;
    recipeId: string;
    targetItemId: string; // The inventory item representing the finished prep good
    batchNumber: string;
    batchMultiplier?: number | string | Decimal; // Number of batches, default 1
    productionDate?: string;
    notes?: string;
    createdBy?: string;
  },
): Promise<{ batchId: string; plannedQty: Decimal; lineCount: number }> {
  const {
    tenantId,
    storeId,
    recipeId,
    targetItemId,
    batchNumber,
    batchMultiplier = 1,
    productionDate = new Date().toISOString().slice(0, 10),
    notes,
    createdBy = 'system',
  } = opts;

  return db.transaction(async (tx) => {
    // 1. Verify recipe is a sub-recipe
    const { rows: rRows } = await tx.query<{
      id: string;
      code: string;
      name: string;
      kind: string;
      batch_yield_qty: string | null;
      batch_yield_uom: string | null;
    }>(
      `select id, code, name, kind, batch_yield_qty::text, batch_yield_uom
         from recipes where id = $1 and tenant_id = $2`,
      [recipeId, tenantId],
    );
    if (!rRows.length) throw new ProductionError('Recipe not found.', 'RECIPE_NOT_FOUND');
    const rec = rRows[0];
    if (rec.kind !== 'sub') {
      throw new ProductionError('Only sub-recipes can be produced in production batches.', 'RECIPE_NOT_FOUND');
    }

    const mult = new Decimal(batchMultiplier);
    const singleYield = rec.batch_yield_qty ? dec(rec.batch_yield_qty) : new Decimal(1);
    const totalProducedQty = singleYield.mul(mult);
    const producedUom = rec.batch_yield_uom || 'Unit';

    // 2. Explode raw components for this batch quantity
    const components = await explodeRecipe(tx, tenantId, recipeId, productionDate, mult);

    const { rows: bRows } = await tx.query<{ id: string }>(
      `insert into production_batches
         (tenant_id, batch_number, store_id, recipe_id, target_item_id, batch_qty,
          produced_qty, produced_uom, status, production_date, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9::date, $10, $11)
       returning id`,
      [
        tenantId,
        batchNumber,
        storeId,
        recipeId,
        targetItemId,
        qtyParam(mult),
        qtyParam(totalProducedQty),
        producedUom,
        productionDate,
        notes ?? null,
        createdBy,
      ],
    );
    const batchId = bRows[0].id;

    let lineNo = 1;
    for (const [itemId, rawQty] of components.entries()) {
      // Get item base UOM
      const { rows: iRow } = await tx.query<{ uom: string }>(
        `select uom from items where id = $1 and tenant_id = $2`,
        [itemId, tenantId],
      );
      const uom = iRow[0]?.uom || 'Unit';

      await tx.query(
        `insert into production_batch_lines
           (tenant_id, batch_id, line_no, item_id, planned_qty, actual_qty, uom)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, batchId, lineNo++, itemId, qtyParam(rawQty), qtyParam(rawQty), uom],
      );
    }

    return { batchId, plannedQty: totalProducedQty, lineCount: components.size };
  });
}

/**
 * 5. Post Production Batch into Stock Ledger (HMC Production Booking)
 * - Consumes raw components from store stock (production_issue)
 * - Books produced finished prep item into store stock (production_receipt)
 * - Is strictly value-neutral: Output Value = Sum(Input Values)
 */
export async function postProductionBatch(
  db: Database,
  tenantId: string,
  batchId: string,
  actorUserId: string = 'system',
): Promise<{ totalCost: Decimal; unitCost: Decimal; producedQty: Decimal }> {
  return db.transaction(async (tx) => {
    const { rows: bRows } = await tx.query<{
      id: string;
      store_id: string;
      target_item_id: string;
      produced_qty: string;
      production_date: string;
      status: string;
    }>(
      `select id, store_id, target_item_id, produced_qty::text,
              production_date::text as production_date, status
         from production_batches where id = $1 and tenant_id = $2 for update`,
      [batchId, tenantId],
    );
    if (!bRows.length) throw new ProductionError('Production batch not found.', 'BATCH_NOT_FOUND');
    const batch = bRows[0];
    if (batch.status === 'posted') {
      throw new ProductionError('Production batch already posted.', 'ALREADY_POSTED');
    }

    const { rows: lines } = await tx.query<{
      id: string;
      item_id: string;
      actual_qty: string;
    }>(
      `select id, item_id, actual_qty::text from production_batch_lines where batch_id = $1`,
      [batchId],
    );

    let totalBatchCost = new Decimal(0);
    const prodDate = batch.production_date.slice(0, 10);

    // 1. Issue raw components at current store weighted average cost
    for (const l of lines) {
      const { rows: avgRows } = await tx.query<{ avg: string }>(
        `select current_avg_cost($1, $2, $3) as avg`,
        [tenantId, batch.store_id, l.item_id],
      );
      const unitCost = dec(avgRows[0]?.avg ?? 0);
      const qty = dec(l.actual_qty);
      const lineCost = qty.mul(unitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      totalBatchCost = totalBatchCost.plus(lineCost);

      // Record line cost
      await tx.query(
        `update production_batch_lines set unit_cost = $2, line_cost = $3 where id = $1`,
        [l.id, moneyParam(unitCost), moneyParam(lineCost)],
      );

      // Stock movement: production_issue (negative qty out of store)
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'production_issue', $4, $5, $6, $7::date,
                 'production_batch', $8, $9, 'Raw ingredient consumed in batch production', $10)`,
        [
          tenantId,
          batch.store_id,
          l.item_id,
          qtyParam(qty.negated()),
          moneyParam(unitCost),
          moneyParam(lineCost.negated()),
          prodDate,
          batchId,
          l.id,
          actorUserId,
        ],
      );
    }

    const producedQty = dec(batch.produced_qty);
    const unitCost = producedQty.gt(0)
      ? totalBatchCost.div(producedQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);

    // 2. Book produced finished prep good into store stock: production_receipt
    await tx.query(
      `insert into stock_movements
         (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
          occurred_on, source_doc_type, source_doc_id, note, created_by)
       values ($1, $2, $3, 'production_receipt', $4, $5, $6, $7::date,
               'production_batch', $8, 'Finished prep batch receipt', $9)`,
      [
        tenantId,
        batch.store_id,
        batch.target_item_id,
        qtyParam(producedQty),
        moneyParam(unitCost),
        moneyParam(totalBatchCost),
        prodDate,
        batchId,
        actorUserId,
      ],
    );

    // 3. Mark batch as posted
    await tx.query(
      `update production_batches
          set status = 'posted', total_cost = $2, unit_cost = $3, posted_at = now()
        where id = $1`,
      [batchId, moneyParam(totalBatchCost), moneyParam(unitCost)],
    );

    return { totalCost: totalBatchCost, unitCost, producedQty };
  });
}
