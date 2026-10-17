import Link from 'next/link';
import { PageHeader, Card, Stat, Badge } from '../../../components/ui';
import { fbCostReconciliation } from '../../../lib/reports';
import { etb } from '../../../lib/format';

export const dynamic = 'force-dynamic';

export default async function FBCostReportPage() {
  const reports = await fbCostReconciliation();

  return (
    <>
      <PageHeader
        title="Food & Beverage Cost Reconciliation Report"
        subtitle="Official Materials Control (MC) cost equation: Opening + Purchases ± Transfers − Closing = Cost of Sales."
        right={
          <div className="flex gap-3">
            <Link
              href="/reports/cost-control"
              className="px-3.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-[12.5px] font-medium hover:bg-brand-100"
            >
              Executive Cost Control Suite →
            </Link>
            <Link
              href="/reports/menu-engineering"
              className="px-3 py-1.5 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-ink-700 dark:text-zinc-300 text-[12.5px] font-medium hover:bg-ink-50"
            >
              Menu Engineering Matrix →
            </Link>
          </div>
        }
      />

      <div className="p-8 max-w-6xl space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {reports.map((rep) => {
            const isFood = rep.kind === 'food';
            const costPctTone =
              rep.actualCostPct && Number(rep.actualCostPct) > 40
                ? 'bad'
                : rep.actualCostPct && Number(rep.actualCostPct) > 35
                  ? 'warn'
                  : 'good';

            return (
              <Card
                key={rep.kind}
                title={`${isFood ? '🍳 Food' : '🍸 Beverage'} Cost Reconciliation`}
                hint={`Total Revenue: ${etb(rep.revenue)} ETB`}
              >
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4 pb-4 border-b border-ink-100 dark:border-ink-800">
                    <Stat
                      label="Actual Cost %"
                      value={rep.actualCostPct ? `${rep.actualCostPct}%` : '—'}
                      tone={costPctTone}
                      note="Net Cost / Revenue"
                    />
                    <Stat
                      label="Theoretical Cost %"
                      value={rep.theoreticalCostPct ? `${rep.theoreticalCostPct}%` : '—'}
                      tone="neutral"
                      note="Recipe BOM Expectation"
                    />
                  </div>

                  <table className="w-full text-[13px]">
                    <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                      <tr>
                        <td className="py-2.5 text-ink-600 dark:text-ink-400">Beginning Inventory</td>
                        <td className="py-2.5 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          {etb(rep.openingStock)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-600 dark:text-ink-400">+ Inbound Purchases (Receipts)</td>
                        <td className="py-2.5 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          +{etb(rep.purchases)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-600 dark:text-ink-400">+ Inbound Issues & Transfers</td>
                        <td className="py-2.5 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          +{etb(rep.transfersIn)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-600 dark:text-ink-400">− Outbound Transfers</td>
                        <td className="py-2.5 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          −{etb(rep.transfersOut)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-600 dark:text-ink-400">− Ending Physical Inventory</td>
                        <td className="py-2.5 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          −{etb(rep.closingStock)}
                        </td>
                      </tr>
                      <tr className="bg-ink-50/60 dark:bg-ink-950 font-semibold">
                        <td className="py-2.5 px-2 text-ink-800 dark:text-ink-200">= Gross Consumption</td>
                        <td className="py-2.5 px-2 text-right font-mono text-ink-900 dark:text-ink-100">
                          {etb(rep.grossConsumption)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-500 dark:text-ink-400 pl-4">− Staff Meals (credited at cost)</td>
                        <td className="py-2.5 text-right font-mono text-ink-700 dark:text-ink-300">
                          −{etb(rep.staffMeals)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-ink-500 dark:text-ink-400 pl-4">− Complimentary & Entertainment</td>
                        <td className="py-2.5 text-right font-mono text-ink-700 dark:text-ink-300">
                          −{etb(rep.comps)}
                        </td>
                      </tr>
                      <tr className="border-t-2 border-ink-200 dark:border-ink-700 bg-brand-50/40 dark:bg-brand-950/20 font-bold">
                        <td className="py-3 px-2 text-brand-900 dark:text-brand-200">= Net Cost of Sales</td>
                        <td className="py-3 px-2 text-right font-mono text-brand-900 dark:text-brand-200 text-[14px]">
                          {etb(rep.netCostOfSales)} ETB
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="pt-2 flex items-center justify-between text-[12px] text-ink-500 border-t border-ink-100 dark:border-ink-800">
                    <span>Unexplained Variance:</span>
                    <span
                      className={`font-mono font-medium ${
                        Number(rep.varianceValue) > 0 ? 'text-rose-600' : 'text-brand-600'
                      }`}
                    >
                      {Number(rep.varianceValue) > 0 ? `+${etb(rep.varianceValue)} ETB Loss` : `${etb(rep.varianceValue)} ETB`}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
