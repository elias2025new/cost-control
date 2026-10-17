import Link from 'next/link';
import { PageHeader, Card, Stat, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listStores, listItemsInStore } from '../../../lib/queries';
import { db } from '../../../lib/server-db';
import {
  getFbCostReconciliation,
  getCostCenterSummary,
  getAbcInventoryValuation,
  getArticleTransactionHistory,
  type FbCostReconciliationLine,
  type CostCenterSummaryLine,
  type AbcValuationLine,
  type ArticleHistoryMovement,
} from '../../../domain/executiveReporting';
import { etb, qty, shortDate, longDate } from '../../../lib/format';
import { dec, Decimal } from '../../../lib/money';

export const dynamic = 'force-dynamic';

export default async function CostControlDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    storeId?: string;
    itemId?: string;
    tab?: string;
  }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Executive Cost Control Dashboard" />
        <OnboardingNotice />
      </>
    );
  }

  const sp = await searchParams;
  const d = await db();

  // Find default active trading period
  const { rows: dateRangeRows } = await d.query<{ def_start: string; def_end: string }>(
    `select coalesce(min(period_start)::text, '2026-01-01') as def_start,
            coalesce(max(period_end)::text, current_date::text) as def_end
       from sales_imports
      where tenant_id = $1 and status = 'posted'`,
    [tenant.id],
  );

  const startDate = sp.startDate || dateRangeRows[0]?.def_start || '2026-01-01';
  const endDate = sp.endDate || dateRangeRows[0]?.def_end || new Date().toISOString().slice(0, 10);
  const activeTab = sp.tab || 'all';

  // Available stores
  const stores = await listStores();
  const selectedStoreId = sp.storeId || stores[0]?.id || '';

  // Available items in the selected store
  const items = selectedStoreId ? await listItemsInStore(selectedStoreId) : [];
  const selectedItemId = sp.itemId || items[0]?.id || '';

  // Execute Domain Reporting Queries concurrently
  const [fbRecon, costCenters, abcValuation, stockCard] = await Promise.all([
    getFbCostReconciliation(d, tenant.id, startDate, endDate).catch(() => [] as FbCostReconciliationLine[]),
    getCostCenterSummary(d, tenant.id, startDate, endDate).catch(() => [] as CostCenterSummaryLine[]),
    getAbcInventoryValuation(d, tenant.id, selectedStoreId || undefined).catch(() => ({
      classes: [] as AbcValuationLine[],
      totalInventoryValue: new Decimal(0),
    })),
    selectedStoreId && selectedItemId
      ? getArticleTransactionHistory(d, tenant.id, selectedStoreId, selectedItemId, startDate, endDate).catch(
          () => [] as ArticleHistoryMovement[],
        )
      : Promise.resolve([] as ArticleHistoryMovement[]),
  ]);

  const selectedItem = items.find((i) => i.id === selectedItemId);
  const selectedStore = stores.find((s) => s.id === selectedStoreId);

  return (
    <>
      <PageHeader
        title="Executive Cost Control Dashboard"
        subtitle="Classical Materials Control (HMC) executive reporting suite: F&B cost reconciliation, cost center matrix, ABC inventory Pareto analysis, and article stock cards."
        right={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/reports/menu-engineering"
              className="px-3 py-1.5 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 text-[12.5px] font-medium hover:bg-ink-50"
            >
              ⭐ Menu Engineering (4-Q)
            </Link>
            <Link
              href="/sales/eod"
              className="px-3.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-[12.5px] font-medium hover:bg-brand-100"
            >
              ↧ EOD Sales Depletions →
            </Link>
          </div>
        }
      />

      <div className="p-8 max-w-7xl space-y-8">
        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-ink-200 dark:border-zinc-800 bg-white dark:bg-[#151515] shadow-sm">
          <form method="get" className="flex flex-wrap items-center gap-4">
            <input type="hidden" name="tab" value={activeTab} />
            <input type="hidden" name="storeId" value={selectedStoreId} />
            <input type="hidden" name="itemId" value={selectedItemId} />

            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-ink-500 font-medium">Trading Period:</span>
              <input
                type="date"
                name="startDate"
                defaultValue={startDate}
                className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[13px] text-ink-800 dark:text-zinc-200 focus:outline-none"
              />
              <span className="text-ink-400">to</span>
              <input
                type="date"
                name="endDate"
                defaultValue={endDate}
                className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[13px] text-ink-800 dark:text-zinc-200 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900 px-3.5 py-1 text-[12.5px] font-medium hover:bg-ink-800 cursor-pointer"
              >
                Apply Period
              </button>
            </div>
          </form>

          {/* Quick Section Jump Pills */}
          <div className="flex items-center gap-1.5 text-[12px]">
            <a
              href="#fb-reconciliation"
              className="px-2.5 py-1 rounded-md bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 hover:bg-ink-200 font-medium"
            >
              1. F&amp;B Reconciliation
            </a>
            <a
              href="#cost-center-matrix"
              className="px-2.5 py-1 rounded-md bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 hover:bg-ink-200 font-medium"
            >
              2. Cost Centers
            </a>
            <a
              href="#pareto-abc"
              className="px-2.5 py-1 rounded-md bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 hover:bg-ink-200 font-medium"
            >
              3. ABC Pareto
            </a>
            <a
              href="#article-stock-card"
              className="px-2.5 py-1 rounded-md bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 hover:bg-ink-200 font-medium"
            >
              4. Article Stock Card
            </a>
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* SECTION 1: F&B COST RECONCILIATION CARDS */}
        {/* ------------------------------------------------------------------------- */}
        <div id="fb-reconciliation" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-bold text-ink-900 dark:text-zinc-100 flex items-center gap-2">
                <span>1. Classical F&amp;B Actual vs. Theoretical Cost Reconciliation</span>
              </h2>
              <p className="text-[12.5px] text-ink-500">
                Official HMC Equation: Opening + Purchases ± Transfers ± Net Production − Closing = Gross Consumption − Staff Meals − Comps = Net Cost of Sales.
              </p>
            </div>
            <span className="text-[12px] font-mono text-ink-500 bg-ink-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
              {shortDate(startDate)} – {shortDate(endDate)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {fbRecon.map((rep) => {
              const isFood = rep.kind === 'food';
              const costPctTone =
                rep.actualCostPct && rep.theoreticalCostPct && rep.costVariancePct
                  ? rep.costVariancePct.greaterThan(5)
                    ? 'bad'
                    : rep.costVariancePct.greaterThan(2)
                      ? 'warn'
                      : 'good'
                  : 'neutral';

              return (
                <Card
                  key={rep.kind}
                  title={`${isFood ? '🍳 Food' : '🍸 Beverage'} Cost Reconciliation`}
                  hint={`Total Revenue: ${etb(rep.revenueTotal)} ETB (Coverage: ${rep.coveragePct ? `${rep.coveragePct}%` : '0%'})`}
                  right={
                    rep.potentialSavings.greaterThan(0) ? (
                      <Badge tone="block">Preventable Leakage: {etb(rep.potentialSavings)} ETB</Badge>
                    ) : (
                      <Badge tone="good">✓ On Target</Badge>
                    )
                  }
                >
                  <div className="p-6 space-y-5">
                    {/* Key Stats Bar */}
                    <div className="grid grid-cols-3 gap-3 pb-4 border-b border-ink-100 dark:border-zinc-800">
                      <Stat
                        label="Actual Cost %"
                        value={rep.actualCostPct ? `${rep.actualCostPct}%` : '—'}
                        tone={costPctTone}
                        note="Net Cost / Revenue"
                      />
                      <Stat
                        label="Theoretical %"
                        value={rep.theoreticalCostPct ? `${rep.theoreticalCostPct}%` : '—'}
                        tone="neutral"
                        note="POS Recipe Depletions"
                      />
                      <Stat
                        label="Cost Variance %"
                        value={rep.costVariancePct ? `${rep.costVariancePct.greaterThan(0) ? '+' : ''}${rep.costVariancePct}%` : '—'}
                        tone={costPctTone}
                        note="Actual − Theoretical"
                      />
                    </div>

                    {/* Detailed Accounting Table */}
                    <table className="w-full text-[13px]">
                      <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">Beginning Physical Inventory</td>
                          <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                            {etb(rep.openingStock)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">+ Inbound Purchases (Receipts)</td>
                          <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                            +{etb(rep.purchases)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">+ Inbound Issues &amp; Transfers</td>
                          <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                            +{etb(rep.transfersIn)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">− Outbound Issues &amp; Transfers</td>
                          <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                            −{etb(rep.transfersOut)}
                          </td>
                        </tr>
                        {rep.productionNet.abs().greaterThan(0) && (
                          <tr>
                            <td className="py-2 text-ink-600 dark:text-zinc-400">± Net Batch Prep &amp; Butcher Yields</td>
                            <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                              {rep.productionNet.greaterThanOrEqualTo(0) ? `+${etb(rep.productionNet)}` : etb(rep.productionNet)}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">− Ending Physical Inventory</td>
                          <td className="py-2 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                            −{etb(rep.closingStock)}
                          </td>
                        </tr>
                        <tr className="bg-ink-50/70 dark:bg-zinc-800/40 font-semibold">
                          <td className="py-2.5 px-2 text-ink-900 dark:text-zinc-200">= Gross Consumption</td>
                          <td className="py-2.5 px-2 text-right font-mono text-ink-900 dark:text-zinc-100">
                            {etb(rep.grossConsumption)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-500 dark:text-zinc-400 pl-4">− Staff Meals (credited at cost)</td>
                          <td className="py-2 text-right font-mono text-ink-700 dark:text-zinc-300">
                            −{etb(rep.staffMeals)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-500 dark:text-zinc-400 pl-4">− Complimentary &amp; Promo</td>
                          <td className="py-2 text-right font-mono text-ink-700 dark:text-zinc-300">
                            −{etb(rep.comps)}
                          </td>
                        </tr>
                        <tr className="border-t-2 border-brand-200 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-950/20 font-bold">
                          <td className="py-2.5 px-2 text-brand-950 dark:text-brand-200">= Net Cost of Sales</td>
                          <td className="py-2.5 px-2 text-right font-mono text-brand-950 dark:text-brand-200 text-[14px]">
                            {etb(rep.netCostOfSales)} ETB
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 text-ink-600 dark:text-zinc-400">Theoretical Consumption (Recipes)</td>
                          <td className="py-2 text-right font-mono text-ink-700 dark:text-zinc-300">
                            {etb(rep.theoreticalCost)} ETB
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Variance & Action Recommendation Footer */}
                    <div className="pt-3 border-t border-ink-100 dark:border-zinc-800 flex items-center justify-between text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <span className="text-ink-500 font-medium">Unexplained Loss:</span>
                        <span
                          className={`font-mono font-bold ${
                            rep.varianceValue.greaterThan(0) ? 'text-rose-600 dark:text-rose-400' : 'text-brand-600'
                          }`}
                        >
                          {rep.varianceValue.greaterThan(0) ? `+${etb(rep.varianceValue)} ETB` : `${etb(rep.varianceValue)} ETB`}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-ink-400">Potential Savings: </span>
                        <strong className="text-brand-700 dark:text-brand-300 font-mono">
                          {etb(rep.potentialSavings)} ETB
                        </strong>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* SECTION 2: COST CENTER COMPARISON MATRIX */}
        {/* ------------------------------------------------------------------------- */}
        <div id="cost-center-matrix" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-bold text-ink-900 dark:text-zinc-100 flex items-center gap-2">
                <span>2. Cost Center Performance &amp; Outlet Comparison Matrix</span>
              </h2>
              <p className="text-[12.5px] text-ink-500">
                Audits inter-store transfer flows, direct vendor receipts, production yields, and inventory turnover per outlet.
              </p>
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500 border-b border-ink-100 dark:border-zinc-800">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Outlet / Store</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider">Type</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Opening</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Purchases</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Transfers In</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Transfers Out</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Depletions</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Closing</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Net Usage</th>
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Turnover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                  {costCenters.map((cc) => {
                    const turnover = cc.turnoverRatio.toNumber();
                    const turnoverTone =
                      turnover >= 4.0 ? 'good' : turnover >= 2.0 ? 'info' : turnover > 0 ? 'warn' : 'neutral';

                    return (
                      <tr key={cc.storeId} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-3 font-medium text-ink-900 dark:text-zinc-100">
                          {cc.storeName}
                        </td>
                        <td className="px-3 py-3">
                          <span className="capitalize text-[11.5px] px-2 py-0.5 rounded bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300">
                            {cc.storeKind}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                          {etb(cc.openingValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-800 dark:text-zinc-200">
                          +{etb(cc.purchasesValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-800 dark:text-zinc-200">
                          +{etb(cc.transfersInValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                          −{etb(cc.transfersOutValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-700 dark:text-zinc-300">
                          −{etb(cc.depletionValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-900 dark:text-zinc-100 font-medium">
                          {etb(cc.closingValue)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-brand-900 dark:text-brand-300">
                          {etb(cc.netConsumptionValue)} ETB
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <Badge tone={turnoverTone}>{cc.turnoverRatio.toFixed(2)}x</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* SECTION 3: PARETO ABC INVENTORY VALUATION */}
        {/* ------------------------------------------------------------------------- */}
        <div id="pareto-abc" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-bold text-ink-900 dark:text-zinc-100 flex items-center gap-2">
                <span>3. ABC Inventory Pareto Valuation (Capital Efficiency Analysis)</span>
              </h2>
              <p className="text-[12.5px] text-ink-500">
                Materials Control Pareto 80/15/5 Rule: Class A items tie up ~80% of your capital and demand strict daily cycle counts.
              </p>
            </div>

            <form method="get" className="flex items-center gap-2 text-[12.5px]">
              <input type="hidden" name="startDate" value={startDate} />
              <input type="hidden" name="endDate" value={endDate} />
              <span className="text-ink-500 font-medium">Store Scope:</span>
              <select
                name="storeId"
                defaultValue={selectedStoreId}
                className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[12.5px] text-ink-800 dark:text-zinc-200 focus:outline-none"
              >
                <option value="">🏢 Company-Wide (All Stores)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.kind})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900 px-3 py-1 text-[12px] font-medium hover:bg-ink-800"
              >
                Filter
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {['A', 'B', 'C'].map((cName) => {
              const line = abcValuation.classes.find((c) => c.abcClass === cName);
              const isA = cName === 'A';
              const isB = cName === 'B';
              const title = isA
                ? 'Class A (High Value / Capital Heavy)'
                : isB
                  ? 'Class B (Moderate Value / Balanced)'
                  : 'Class C (Low Value / Bulk Stock)';
              const policy = isA
                ? 'Mandatory daily cycle counts, JIT purchasing, tight Par levels, high security.'
                : isB
                  ? 'Bi-weekly stock counts, standard minimum/maximum replenishment.'
                  : 'Monthly counts, bulk ordering, loose control thresholds.';
              const tone = isA ? ('block' as const) : isB ? ('warn' as const) : ('good' as const);

              return (
                <Card
                  key={cName}
                  title={title}
                  hint={`${line?.itemCount ?? 0} active articles`}
                  right={<Badge tone={tone}>{line ? `${line.percentageOfCapital}% Capital` : '0%'}</Badge>}
                >
                  <div className="p-5 space-y-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] text-ink-500">Tied-Up Capital:</span>
                      <span className="text-[18px] font-bold font-mono text-ink-900 dark:text-zinc-100">
                        {line ? etb(line.totalStockValue) : '0.00'} ETB
                      </span>
                    </div>

                    <div className="w-full bg-ink-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isA ? 'bg-rose-500' : isB ? 'bg-amber-500' : 'bg-brand-500'
                        }`}
                        style={{ width: `${line?.percentageOfCapital.toNumber() ?? 0}%` }}
                      />
                    </div>

                    <div className="pt-2 border-t border-ink-100 dark:border-zinc-800">
                      <span className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider block mb-1">
                        HMC Control Policy:
                      </span>
                      <p className="text-[12px] text-ink-600 dark:text-zinc-400 leading-snug">{policy}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="p-4 rounded-xl border border-ink-200 dark:border-zinc-800 bg-ink-50/50 dark:bg-zinc-800/20 flex items-center justify-between text-[13px]">
            <span className="text-ink-600 dark:text-zinc-400">Total Property Inventory Investment:</span>
            <span className="font-mono font-bold text-[15px] text-ink-900 dark:text-zinc-100">
              {etb(abcValuation.totalInventoryValue)} ETB
            </span>
          </div>
        </div>

        {/* ------------------------------------------------------------------------- */}
        {/* SECTION 4: ARTICLE TRANSACTION HISTORY (STOCK CARD / ARTIKELKARTE) */}
        {/* ------------------------------------------------------------------------- */}
        <div id="article-stock-card" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-bold text-ink-900 dark:text-zinc-100 flex items-center gap-2">
                <span>4. Article Transaction History Stock Card (HMC Artikelkarte)</span>
              </h2>
              <p className="text-[12.5px] text-ink-500">
                Forward-only chronological audit trail. Explains every single change in stock quantity and weighted average unit cost.
              </p>
            </div>

            {/* Outlet and Article Pickers */}
            <form method="get" className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="startDate" value={startDate} />
              <input type="hidden" name="endDate" value={endDate} />

              <div className="flex items-center gap-2 text-[12.5px]">
                <label className="text-ink-500 font-medium">Store:</label>
                <select
                  name="storeId"
                  defaultValue={selectedStoreId}
                  className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[12.5px] text-ink-800 dark:text-zinc-200 focus:outline-none"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-[12.5px]">
                <label className="text-ink-500 font-medium">Article:</label>
                <select
                  name="itemId"
                  defaultValue={selectedItemId}
                  className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[12.5px] text-ink-800 dark:text-zinc-200 focus:outline-none min-w-[200px]"
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.code})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900 px-3 py-1 text-[12px] font-medium hover:bg-ink-800"
                >
                  Audit
                </button>
              </div>
            </form>
          </div>

          {selectedItem && (
            <div className="p-4 rounded-xl border border-brand-200 dark:border-brand-900 bg-brand-50/50 dark:bg-brand-950/20 flex flex-wrap items-center justify-between gap-4 text-[13px]">
              <div>
                <span className="font-bold text-brand-950 dark:text-brand-200 text-[14px]">
                  {selectedItem.name}
                </span>{' '}
                <span className="font-mono text-[12px] text-brand-700 dark:text-brand-300">
                  [{selectedItem.code}] · {selectedItem.uom} · Store: {selectedStore?.name}
                </span>
              </div>
              <div className="text-[12.5px] text-brand-800 dark:text-brand-300">
                Current On-Hand Balance:{' '}
                <strong className="font-mono text-brand-950 dark:text-brand-100 font-bold">
                  {selectedItem.qty_on_hand ? qty(selectedItem.qty_on_hand) : '0'} {selectedItem.uom}
                </strong>
              </div>
            </div>
          )}

          <Card>
            {stockCard.length === 0 ? (
              <Empty>
                No stock transactions found for this article in the selected trading period ({shortDate(startDate)} to{' '}
                {shortDate(endDate)}).
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500 border-b border-ink-100 dark:border-zinc-800">
                    <tr className="text-left">
                      <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Date</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Movement Type</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Doc Ref</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Memo / Note</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Qty Change</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Unit Cost</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Value Change</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Running Stock</th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Moving Avg Cost</th>
                      <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Balance Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                    {stockCard.map((mov) => {
                      const isNegative = mov.qtyDelta.isNegative();
                      const typeBadge =
                        mov.movementType === 'receipt'
                          ? { tone: 'good' as const, label: 'Delivery Receipt' }
                          : mov.movementType === 'sale_depletion'
                            ? { tone: 'info' as const, label: 'POS Depletion' }
                            : mov.movementType === 'transfer_in' || mov.movementType === 'issue_in'
                              ? { tone: 'info' as const, label: 'Transfer In' }
                              : mov.movementType === 'transfer_out' || mov.movementType === 'issue_out'
                                ? { tone: 'neutral' as const, label: 'Transfer Out' }
                                : mov.movementType === 'wastage'
                                  ? { tone: 'block' as const, label: 'Waste / Loss' }
                                  : mov.movementType === 'count_adjustment'
                                    ? { tone: 'warn' as const, label: 'Count Adjustment' }
                                    : mov.movementType === 'production_receipt'
                                      ? { tone: 'good' as const, label: 'Batch Prep Receipt' }
                                      : mov.movementType === 'production_issue'
                                        ? { tone: 'neutral' as const, label: 'Batch Prep Issue' }
                                        : { tone: 'neutral' as const, label: mov.movementType };

                      return (
                        <tr key={mov.movementId} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                          <td className="px-4 py-2.5 font-mono text-[12px] text-ink-600 dark:text-zinc-400">
                            {shortDate(mov.occurredOn)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={typeBadge.tone}>{typeBadge.label}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-[12px] font-mono text-ink-500 truncate max-w-[120px]">
                            {mov.sourceDocType}
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-ink-600 dark:text-zinc-400 truncate max-w-[180px]">
                            {mov.note || '—'}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-medium ${
                              isNegative ? 'text-rose-600' : 'text-brand-700 dark:text-brand-400'
                            }`}
                          >
                            {mov.qtyDelta.greaterThan(0) ? `+${qty(mov.qtyDelta)}` : qty(mov.qtyDelta)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-ink-600 dark:text-zinc-400">
                            {etb(mov.unitCost)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono ${
                              mov.valueDelta.isNegative() ? 'text-rose-600' : 'text-ink-800 dark:text-zinc-200'
                            }`}
                          >
                            {mov.valueDelta.greaterThan(0) ? `+${etb(mov.valueDelta)}` : etb(mov.valueDelta)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-ink-900 dark:text-zinc-100">
                            {qty(mov.runningQty)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-ink-800 dark:text-zinc-200">
                            {etb(mov.runningAvgCost)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-brand-900 dark:text-brand-300">
                            {etb(mov.runningValue)} ETB
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
