/**
 * Phase 5: Materials Control End-of-Day Sales Depletion & Theoretical Reconciliation Engine
 *
 * Designed specifically for the daily CNet sales report export workflow:
 *  - EOD Sales Report Upload & Reconciliation Gate (HMC CNet / Sales Import)
 *  - Recipe Explosion & Automated Stock Depletion into the Stock Ledger
 *  - Classical F&B Material Consumption Matrix (HMC Soll-Ist-Vergleich / FBCalculation.cs)
 *  - Unexplained Cost Leakage, Portion Drift & Waste Detection
 */

import type { Database } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';
import { importCnetFile, importCnetUpload } from './importCnet';
import { postSalesImport, type PostResult } from './postSalesImport';

export class ReconciliationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'IMPORT_FAILED'
      | 'NOT_RECONCILED'
      | 'BLOCKING_ISSUES'
      | 'INVALID_PERIOD',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

export interface TheoreticalVsActualLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  category: string;
  uom: string;
  openingQty: Decimal;
  receivedQty: Decimal;
  transfersNetQty: Decimal;
  productionNetQty: Decimal;
  closingQty: Decimal;
  actualConsumptionQty: Decimal;
  posDepletionQty: Decimal;
  wasteQty: Decimal;
  compQty: Decimal;
  staffMealQty: Decimal;
  theoreticalConsumptionQty: Decimal;
  varianceQty: Decimal;
  unitCost: Decimal;
  varianceValue: Decimal;
  variancePct: Decimal;
  varianceStatus: 'NORMAL' | 'REVIEW' | 'LEAKAGE_ALERT';
  probableCause: string;
}

export interface EodSalesUploadResult {
  importId: string;
  periodStart: string;
  periodEnd: string;
  lineCount: number;
  reconciled: boolean;
  canPost: boolean;
  depletionResult: PostResult;
}

export interface LeakageAnalysis {
  totalLeakageValue: Decimal;
  alertCount: number;
  reviewCount: number;
  categoryBreakdown: Record<string, Decimal>;
  topLeakageItems: {
    itemCode: string;
    itemName: string;
    category: string;
    varianceQty: Decimal;
    varianceValue: Decimal;
    variancePct: Decimal;
    probableCause: string;
  }[];
  recommendations: string[];
}

/**
 * End-of-Day Sales Report Processing & Automated Recipe Depletion
 *
 * Ingests the daily CNet sales export file (uploaded at end of day by the controller/cashier),
 * verifies the reconciliation gate against file footer totals,
 * and posts the import to trigger recursive recipe explosion and
 * stock depletions into the ledger.
 */
export async function processEodSalesUpload(
  db: Database,
  tenantId: string,
  filePathOrBuffer: string | Buffer,
  filename?: string,
): Promise<EodSalesUploadResult> {
  let importResult;
  if (typeof filePathOrBuffer === 'string') {
    importResult = await importCnetFile(db, tenantId, filePathOrBuffer);
  } else {
    importResult = await importCnetUpload(
      db,
      tenantId,
      filePathOrBuffer,
      filename ?? 'cnet_daily_sales.xlsx',
    );
  }

  if (!importResult.canPost) {
    throw new ReconciliationError(
      `CNet sales file ${filename ?? ''} cannot be posted: reconciliation mismatch or blocking issues detected.`,
      'NOT_RECONCILED',
      { blockingCount: importResult.blockingCount, reconciled: importResult.reconciled },
    );
  }

  const depletionResult = await postSalesImport(db, importResult.importId);

  return {
    importId: importResult.importId,
    periodStart: importResult.periodStart,
    periodEnd: importResult.periodEnd,
    lineCount: importResult.lineCount,
    reconciled: importResult.reconciled,
    canPost: importResult.canPost,
    depletionResult,
  };
}

/**
 * Calculates Full Material Consumption & Theoretical vs Actual Reconciliation Matrix
 * (HMC Soll-Ist-Vergleich / Material Consumption Report)
 *
 * Analyzes consumption over any given trading period (matching the uploaded CNet sales dates):
 *   Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
 *   Theoretical Consumption = EOD CNet Depletions + Approved Wastage + Comps + Staff Meals
 *   Unexplained Variance = Actual - Theoretical
 */
export async function getTheoreticalVsActualMatrix(
  db: Database,
  tenantId: string,
  storeId: string,
  startDate: string,
  endDate: string,
): Promise<TheoreticalVsActualLine[]> {
  const { rows } = await db.query<{
    item_id: string;
    item_code: string;
    item_name: string;
    category: string;
    uom: string;
    opening_qty: string;
    received_qty: string;
    transfers_net_qty: string;
    production_net_qty: string;
    closing_qty: string;
    actual_consumption_qty: string;
    pos_depletion_qty: string;
    waste_qty: string;
    comp_qty: string;
    staff_meal_qty: string;
    theoretical_consumption_qty: string;
    variance_qty: string;
    unit_cost: string;
    variance_value: string;
    variance_pct: string;
    variance_status: string;
    probable_cause: string;
  }>(
    `select * from calculate_theoretical_vs_actual_matrix($1, $2, $3::date, $4::date)`,
    [tenantId, storeId, startDate, endDate],
  );

  return rows.map((r) => ({
    itemId: r.item_id,
    itemCode: r.item_code,
    itemName: r.item_name,
    category: r.category,
    uom: r.uom,
    openingQty: dec(r.opening_qty),
    receivedQty: dec(r.received_qty),
    transfersNetQty: dec(r.transfers_net_qty),
    productionNetQty: dec(r.production_net_qty),
    closingQty: dec(r.closing_qty),
    actualConsumptionQty: dec(r.actual_consumption_qty),
    posDepletionQty: dec(r.pos_depletion_qty),
    wasteQty: dec(r.waste_qty),
    compQty: dec(r.comp_qty),
    staffMealQty: dec(r.staff_meal_qty),
    theoreticalConsumptionQty: dec(r.theoretical_consumption_qty),
    varianceQty: dec(r.variance_qty),
    unitCost: dec(r.unit_cost),
    varianceValue: dec(r.variance_value),
    variancePct: dec(r.variance_pct),
    varianceStatus: r.variance_status as 'NORMAL' | 'REVIEW' | 'LEAKAGE_ALERT',
    probableCause: r.probable_cause,
  }));
}

/**
 * Analyzes Theoretical vs Actual Matrix to isolate Cost Leakage and recommend interventions
 */
export function detectCostLeakage(matrix: TheoreticalVsActualLine[]): LeakageAnalysis {
  let totalLeakage = new Decimal(0);
  let alertCount = 0;
  let reviewCount = 0;
  const categoryBreakdown: Record<string, Decimal> = {};

  const flaggedItems = matrix.filter((m) => m.varianceValue.toNumber() > 0);

  for (const line of flaggedItems) {
    if (line.varianceStatus === 'LEAKAGE_ALERT') alertCount++;
    if (line.varianceStatus === 'REVIEW') reviewCount++;

    totalLeakage = totalLeakage.plus(line.varianceValue);

    const cat = line.category || 'OTHER';
    categoryBreakdown[cat] = (categoryBreakdown[cat] ?? new Decimal(0)).plus(line.varianceValue);
  }

  const topLeakageItems = [...flaggedItems]
    .sort((a, b) => b.varianceValue.minus(a.varianceValue).toNumber())
    .slice(0, 5)
    .map((item) => ({
      itemCode: item.itemCode,
      itemName: item.itemName,
      category: item.category,
      varianceQty: item.varianceQty,
      varianceValue: item.varianceValue,
      variancePct: item.variancePct,
      probableCause: item.probableCause,
    }));

  const recommendations: string[] = [];
  if (alertCount > 0) {
    recommendations.push(
      `Immediate Investigation: ${alertCount} items exceed financial and percentage tolerance thresholds (500 ETB / 5%).`,
    );
  }
  if (topLeakageItems.some((i) => i.probableCause === 'OVER_PORTIONING')) {
    recommendations.push(
      'Portion Control Audit: Multiple high-consumption items show over-portioning. Verify kitchen portion scales and bar jiggers.',
    );
  }
  if (topLeakageItems.some((i) => i.probableCause === 'UNRECORDED_WASTE_OR_THEFT')) {
    recommendations.push(
      'Waste Log Enforcement: Significant unrecorded shrinkage detected. Ensure kitchen and bar staff log all spoilage, burns, and breakages.',
    );
  }

  return {
    totalLeakageValue: totalLeakage,
    alertCount,
    reviewCount,
    categoryBreakdown,
    topLeakageItems,
    recommendations,
  };
}
