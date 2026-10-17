/**
 * Phase 6: Materials Control Executive Cost Control Reporting Suite
 *
 * Implements:
 *  - Comprehensive Food & Beverage Cost Reconciliation (Actual vs. Theoretical / Potential Savings)
 *  - Cost Center Performance & Inter-Outlet Transfer Matrix (Kitchen vs. Bar vs. Central Store)
 *  - ABC Inventory Valuation Analysis (Pareto 80/15/5 Capital Efficiency)
 *  - Forward-Only Article Transaction History Ledger (Stock Card / Audit Trail)
 */

import type { Database } from '../lib/db';
import { Decimal, dec } from '../lib/money';

export interface FbCostReconciliationLine {
  kind: 'food' | 'beverage';
  revenueTotal: Decimal;
  revenueCosted: Decimal;
  coveragePct: Decimal | null;
  openingStock: Decimal;
  purchases: Decimal;
  transfersIn: Decimal;
  transfersOut: Decimal;
  productionNet: Decimal;
  closingStock: Decimal;
  grossConsumption: Decimal;
  staffMeals: Decimal;
  comps: Decimal;
  waste: Decimal;
  netCostOfSales: Decimal;
  actualCostPct: Decimal | null;
  theoreticalCost: Decimal;
  theoreticalCostPct: Decimal | null;
  varianceValue: Decimal;
  costVariancePct: Decimal | null;
  potentialSavings: Decimal;
}

export interface CostCenterSummaryLine {
  storeId: string;
  storeName: string;
  storeKind: string;
  openingValue: Decimal;
  purchasesValue: Decimal;
  transfersInValue: Decimal;
  transfersOutValue: Decimal;
  productionNetValue: Decimal;
  depletionValue: Decimal;
  wasteValue: Decimal;
  closingValue: Decimal;
  netConsumptionValue: Decimal;
  turnoverRatio: Decimal;
}

export interface AbcValuationLine {
  abcClass: 'A' | 'B' | 'C';
  itemCount: number;
  totalStockValue: Decimal;
  percentageOfCapital: Decimal;
}

export interface ArticleHistoryMovement {
  movementId: string;
  occurredOn: string;
  occurredAt: string;
  movementType: string;
  sourceDocType: string;
  sourceDocId: string | null;
  note: string | null;
  qtyDelta: Decimal;
  unitCost: Decimal;
  valueDelta: Decimal;
  runningQty: Decimal;
  runningAvgCost: Decimal;
  runningValue: Decimal;
}

/**
 * Executes the Classical Materials Control F&B Cost Reconciliation
 * Computes Actual vs. Theoretical Cost of Sales % and Potential Leakage Savings
 */
export async function getFbCostReconciliation(
  db: Database,
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<FbCostReconciliationLine[]> {
  const { rows } = await db.query<{
    kind: string;
    revenue_total: string;
    revenue_costed: string;
    coverage_pct: string | null;
    opening_stock: string;
    purchases: string;
    transfers_in: string;
    transfers_out: string;
    production_net: string;
    closing_stock: string;
    gross_consumption: string;
    staff_meals: string;
    comps: string;
    waste: string;
    net_cost_of_sales: string;
    actual_cost_pct: string | null;
    theoretical_cost: string;
    theoretical_cost_pct: string | null;
    variance_value: string;
    cost_variance_pct: string | null;
    potential_savings: string;
  }>(`select * from get_fb_cost_reconciliation($1, $2::date, $3::date)`, [
    tenantId,
    startDate,
    endDate,
  ]);

  return rows.map((r) => ({
    kind: r.kind as 'food' | 'beverage',
    revenueTotal: dec(r.revenue_total),
    revenueCosted: dec(r.revenue_costed),
    coveragePct: r.coverage_pct ? dec(r.coverage_pct) : null,
    openingStock: dec(r.opening_stock),
    purchases: dec(r.purchases),
    transfersIn: dec(r.transfers_in),
    transfersOut: dec(r.transfers_out),
    productionNet: dec(r.production_net),
    closingStock: dec(r.closing_stock),
    grossConsumption: dec(r.gross_consumption),
    staffMeals: dec(r.staff_meals),
    comps: dec(r.comps),
    waste: dec(r.waste),
    netCostOfSales: dec(r.net_cost_of_sales),
    actualCostPct: r.actual_cost_pct ? dec(r.actual_cost_pct) : null,
    theoreticalCost: dec(r.theoretical_cost),
    theoreticalCostPct: r.theoretical_cost_pct ? dec(r.theoretical_cost_pct) : null,
    varianceValue: dec(r.variance_value),
    costVariancePct: r.cost_variance_pct ? dec(r.cost_variance_pct) : null,
    potentialSavings: dec(r.potential_savings),
  }));
}

/**
 * Generates Cost Center Comparison Matrix across Outlets (Kitchen vs Bar vs Central Store)
 */
export async function getCostCenterSummary(
  db: Database,
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<CostCenterSummaryLine[]> {
  const { rows } = await db.query<{
    store_id: string;
    store_name: string;
    store_kind: string;
    opening_value: string;
    purchases_value: string;
    transfers_in_value: string;
    transfers_out_value: string;
    production_net_value: string;
    depletion_value: string;
    waste_value: string;
    closing_value: string;
    net_consumption_value: string;
    turnover_ratio: string;
  }>(`select * from get_cost_center_summary($1, $2::date, $3::date)`, [
    tenantId,
    startDate,
    endDate,
  ]);

  return rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    storeKind: r.store_kind,
    openingValue: dec(r.opening_value),
    purchasesValue: dec(r.purchases_value),
    transfersInValue: dec(r.transfers_in_value),
    transfersOutValue: dec(r.transfers_out_value),
    productionNetValue: dec(r.production_net_value),
    depletionValue: dec(r.depletion_value),
    wasteValue: dec(r.waste_value),
    closingValue: dec(r.closing_value),
    netConsumptionValue: dec(r.net_consumption_value),
    turnoverRatio: dec(r.turnover_ratio),
  }));
}

/**
 * Calculates ABC Inventory Capital Distribution across on-hand inventory
 * A = High Value (80% capital), B = Medium (15% capital), C = Low (5% capital)
 */
export async function getAbcInventoryValuation(
  db: Database,
  tenantId: string,
  storeId?: string,
): Promise<{ classes: AbcValuationLine[]; totalInventoryValue: Decimal }> {
  const { rows } = await db.query<{
    abc_class: string;
    item_count: string;
    total_val: string;
  }>(
    `select coalesce(i.abc_class, 'B') as abc_class,
            count(distinct i.id)::text as item_count,
            coalesce(sum(v.value_on_hand), 0)::text as total_val
       from items i
       left join v_stock_on_hand v on v.item_id = i.id and v.tenant_id = i.tenant_id
      where i.tenant_id = $1
        and ($2::uuid is null or v.store_id = $2::uuid)
      group by coalesce(i.abc_class, 'B')
      order by case coalesce(i.abc_class, 'B') when 'A' then 0 when 'B' then 1 else 2 end`,
    [tenantId, storeId ?? null],
  );

  let grandTotal = new Decimal(0);
  const items = rows.map((r) => {
    const val = dec(r.total_val);
    grandTotal = grandTotal.plus(val);
    return {
      abcClass: r.abc_class as 'A' | 'B' | 'C',
      itemCount: Number(r.item_count),
      totalStockValue: val,
    };
  });

  const classes: AbcValuationLine[] = items.map((i) => ({
    ...i,
    percentageOfCapital: grandTotal.greaterThan(0)
      ? i.totalStockValue.div(grandTotal).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0),
  }));

  return { classes, totalInventoryValue: grandTotal };
}

/**
 * Reconstructs Forward-Only Article Transaction History Ledger (HMC Artikelkarte)
 * Provides an indisputable audit trail with running on-hand balances and moving average costs
 */
export async function getArticleTransactionHistory(
  db: Database,
  tenantId: string,
  storeId: string,
  itemId: string,
  startDate: string,
  endDate: string,
): Promise<ArticleHistoryMovement[]> {
  const { rows } = await db.query<{
    movement_id: string;
    occurred_on: string | Date;
    occurred_at: string | Date;
    movement_type: string;
    source_doc_type: string;
    source_doc_id: string | null;
    note: string | null;
    qty_delta: string;
    unit_cost: string;
    value_delta: string;
    running_qty: string;
    running_avg_cost: string;
    running_value: string;
  }>(
    `select * from get_article_history_ledger($1, $2, $3, $4::date, $5::date)`,
    [tenantId, storeId, itemId, startDate, endDate],
  );

  return rows.map((r) => ({
    movementId: r.movement_id,
    occurredOn: r.occurred_on instanceof Date
      ? (r.occurred_on as Date).toISOString().slice(0, 10)
      : String(r.occurred_on ?? ''),
    occurredAt: r.occurred_at instanceof Date
      ? (r.occurred_at as Date).toISOString()
      : String(r.occurred_at ?? ''),
    movementType: r.movement_type,
    sourceDocType: r.source_doc_type,
    sourceDocId: r.source_doc_id,
    note: r.note,
    qtyDelta: dec(r.qty_delta),
    unitCost: dec(r.unit_cost),
    valueDelta: dec(r.value_delta),
    runningQty: dec(r.running_qty),
    runningAvgCost: dec(r.running_avg_cost),
    runningValue: dec(r.running_value),
  }));
}
