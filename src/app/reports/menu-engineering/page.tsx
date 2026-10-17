import Link from 'next/link';
import { PageHeader, Card, Stat, Badge } from '../../../components/ui';
import { menuEngineeringMatrix } from '../../../lib/reports';
import { etb } from '../../../lib/format';

export const dynamic = 'force-dynamic';

export default async function MenuEngineeringPage() {
  const data = await menuEngineeringMatrix();

  const getTone = (c: string) => {
    switch (c) {
      case 'STAR':
        return 'good';
      case 'PLOWHORSE':
        return 'info';
      case 'PUZZLE':
        return 'warn';
      case 'DOG':
        return 'block';
      default:
        return 'neutral';
    }
  };

  return (
    <>
      <PageHeader
        title="Menu Engineering Matrix"
        subtitle="Kasavana & Smith 4-Quadrant Hospitality Analysis: Popularity (Volume) vs. Profitability (Contribution Margin)."
        right={
          <Link
            href="/reports/cost-summary"
            className="px-3.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-[12.5px] font-medium hover:bg-brand-100"
          >
            ← F&B Cost Reconciliation
          </Link>
        }
      />

      <div className="p-8 max-w-6xl space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <Stat
              label="⭐ Stars"
              value={data.counts.star}
              tone="good"
              note="High Volume + High Profit"
            />
          </Card>
          <Card>
            <Stat
              label="🐴 Plowhorses"
              value={data.counts.plowhorse}
              tone="warn"
              note="High Volume + Low Profit"
            />
          </Card>
          <Card>
            <Stat
              label="🧩 Puzzles"
              value={data.counts.puzzle}
              tone="neutral"
              note="Low Volume + High Profit"
            />
          </Card>
          <Card>
            <Stat
              label="🐶 Dogs"
              value={data.counts.dog}
              tone="bad"
              note="Low Volume + Low Profit"
            />
          </Card>
        </div>

        <div className="p-4 bg-ink-50 dark:bg-ink-950 rounded-xl border border-ink-200 dark:border-ink-800 text-[13px] text-ink-700 dark:text-ink-300 flex items-center justify-between">
          <div>
            <strong>Benchmark Thresholds:</strong> Average Volume Sold ={' '}
            <span className="font-mono font-semibold">{data.avgPopularity} units</span> · Average Unit
            Margin = <span className="font-mono font-semibold">{etb(data.avgMargin)} ETB</span>
          </div>
          <span className="text-[12px] text-ink-500">
            Items above both averages are classified as Stars.
          </span>
        </div>

        <Card title="Menu Item Profitability & Recommendations">
          {data.items.length === 0 ? (
            <div className="p-8 text-center text-ink-500 text-[13.5px]">
              No sales posted yet. Import and post a POS sales report to view the matrix.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-ink-950 text-ink-500 text-left">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Item Name</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Category</th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Sold</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Price</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Cost</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Unit Margin</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Cost %</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Classification</th>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Action Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data.items.map((item) => (
                    <tr key={item.menuItemId} className="hover:bg-ink-50/50 dark:hover:bg-ink-900/50">
                      <td className="px-5 py-3 font-medium text-ink-900 dark:text-ink-100">
                        {item.itemName}
                      </td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-400 capitalize">
                        {item.kind}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-medium text-ink-900 dark:text-ink-100">
                        {item.qtySold}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink-700 dark:text-ink-300">
                        {etb(item.avgSellingPrice)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink-700 dark:text-ink-300">
                        {etb(item.unitCost)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-brand-700 dark:text-brand-400">
                        +{etb(item.unitMargin)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink-700 dark:text-ink-300">
                        {item.foodCostPct ? `${item.foodCostPct}%` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={getTone(item.classification)}>{item.classification}</Badge>
                      </td>
                      <td className="px-5 py-3 text-[12px] text-ink-600 dark:text-ink-400 max-w-xs">
                        {item.recommendation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
