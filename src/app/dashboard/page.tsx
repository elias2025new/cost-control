import Link from 'next/link';
import { PageHeader, Card, Stat, Badge, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant } from '../../lib/queries';
import {
  latestPostedImport,
  fbCostSummary,
  topSellers,
  coverageCurve,
} from '../../lib/reports';
import { etb, qty, pct, shortDate } from '../../lib/format';
import { dec } from '../../lib/money';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <OnboardingNotice />
      </>
    );
  }

  const latest = await latestPostedImport();

  if (!latest) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-8 max-w-6xl">
          <Card>
            <Empty>
              Nothing posted yet.{' '}
              <Link href="/import" className="text-brand-700 hover:underline">
                Import a sales file
              </Link>{' '}
              and post it - the dashboard reads the latest posted period.
            </Empty>
          </Card>
        </div>
      </>
    );
  }

  const [fb, byQty, byRevenue, curve] = await Promise.all([
    fbCostSummary(latest.id),
    topSellers(latest.id, 'qty'),
    topSellers(latest.id, 'revenue'),
    coverageCurve(latest.id),
  ]);

  const food = fb.find((f) => f.kind === 'food');
  const bev = fb.find((f) => f.kind === 'beverage');
  const other = fb.find((f) => f.kind === 'other');

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {shortDate(latest.period_start)} – {shortDate(latest.period_end)} ·{' '}
            {etb(latest.computed_sub_total)} ETB net sales
          </>
        }
        right={
          <Link
            href={`/import/${latest.id}`}
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            View the import →
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {/* ---- food and beverage, never merged --------------------------- */}
        <div className="grid grid-cols-2 gap-6">
          <CostCard kind="Food" row={food} tone="amber" />
          <CostCard kind="Beverage" row={bev} tone="sky" />
        </div>

        {other && dec(other.revenue_all).greaterThan(0) && (
          <Card title="Other sales" hint="To-go materials and anything that is neither food nor beverage">
            <div className="grid grid-cols-3 divide-x divide-ink-100">
              <Stat label="Revenue" value={etb(other.revenue_all)} unit="ETB" />
              <Stat label="Cost of sales" value={etb(other.cost_of_sales)} unit="ETB" />
              <Stat
                label="Coverage"
                value={other.coverage_pct ? pct(other.coverage_pct) : '-'}
              />
            </div>
          </Card>
        )}

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[12.5px] text-amber-900 leading-snug">
            <strong className="font-semibold">Read the cost percentages against their
            coverage.</strong>{' '}
            A cost percentage is only meaningful for revenue the system can actually cost, so
            that is what it divides by. Food cost % here describes{' '}
            {food?.coverage_pct ? pct(food.coverage_pct) : '-'} of food revenue, not all of it.
            The figure firms up as recipes are written.
          </p>
        </div>

        {/* ---- top sellers ----------------------------------------------- */}
        <div className="grid grid-cols-2 gap-6">
          <Card title="Top sellers by quantity" hint="units sold in the period">
            <SellerTable rows={byQty} metric="qty" />
          </Card>
          <Card title="Top sellers by revenue" hint="birr taken in the period">
            <SellerTable rows={byRevenue} metric="revenue" />
          </Card>
        </div>

        {/* ---- coverage curve -------------------------------------------- */}
        <Card
          title="How many recipes is enough"
          hint="Articles ranked by revenue - writing 171 recipes is not the job"
        >
          <div className="grid grid-cols-2 gap-0 divide-x divide-ink-100">
            <div className="px-5 py-4">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-ink-500">
                    <th className="pb-2 font-semibold text-[11px] uppercase tracking-wider">
                      To cost
                    </th>
                    <th className="pb-2 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Recipes needed
                    </th>
                    <th className="pb-2 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {curve.milestones.map((m) => (
                    <tr key={m.target}>
                      <td className="py-2 text-ink-700">{m.target}% of costable revenue</td>
                      <td className="py-2 text-right tnum font-semibold text-ink-900 dark:text-zinc-100">
                        {m.recipes}
                      </td>
                      <td className="py-2 text-right tnum text-ink-600">{etb(m.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[12px] text-ink-500 mt-3 leading-snug">
                <strong className="text-ink-700 font-semibold">
                  {curve.recipesWritten} written so far
                </strong>{' '}
                out of {curve.costableCount} articles that could carry a recipe.
              </p>
            </div>

            <div className="px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                The ceiling
              </div>
              <div className="mt-1.5 text-[26px] leading-none font-semibold tnum text-ink-900 dark:text-zinc-100">
                {etb(curve.uncostableRevenue)}
                <span className="text-[13px] font-medium text-ink-400 ml-1.5">ETB</span>
              </div>
              <p className="text-[12.5px] text-ink-600 mt-2 leading-snug">
                across {curve.uncostableCount} articles that can <strong>never</strong> be costed,
                because they name a class of product rather than a product - SOFT DRINK, BEER,
                SEASONAL FRESH JUICE - plus the test articles.
              </p>
              <p className="text-[12.5px] text-ink-500 mt-2 leading-snug">
                No amount of recipe writing reaches them. Splitting them into real products in the
                POS is the only fix, and that is a decision for you.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function CostCard({
  kind,
  row,
  tone,
}: {
  kind: string;
  row:
    | {
        revenue_all: string;
        revenue_costed: string;
        cost_of_sales: string;
        cost_pct_of_costed: string | null;
        coverage_pct: string | null;
        gross_profit: string;
      }
    | undefined;
  tone: 'amber' | 'sky';
}) {
  const accent = tone === 'amber' ? 'bg-amber-500' : 'bg-sky-500';

  if (!row) {
    return (
      <Card title={`${kind} cost`}>
        <Empty>No {kind.toLowerCase()} sales in this period.</Empty>
      </Card>
    );
  }

  return (
    <Card
      title={`${kind} cost`}
      right={
        <Badge tone="neutral">
          coverage {row.coverage_pct ? pct(row.coverage_pct) : '-'}
        </Badge>
      }
    >
      <div className="px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${accent}`} />
          <span className="text-[40px] leading-none font-semibold tnum text-ink-900 dark:text-zinc-100">
            {row.cost_pct_of_costed ? pct(row.cost_pct_of_costed) : '-'}
          </span>
          <span className="text-[13px] text-ink-500">{kind.toLowerCase()} cost</span>
        </div>
        <p className="text-[12px] text-ink-500 mt-2">
          cost of {kind.toLowerCase()} sold ÷ {kind.toLowerCase()} sales that could be costed
        </p>
      </div>

      <div className="border-t border-ink-100 grid grid-cols-2 divide-x divide-ink-100">
        <Stat label={`${kind} revenue`} value={etb(row.revenue_all)} unit="ETB" note="all of it" />
        <Stat
          label="Costed revenue"
          value={etb(row.revenue_costed)}
          unit="ETB"
          note="the base above"
        />
      </div>
      <div className="border-t border-ink-100 grid grid-cols-2 divide-x divide-ink-100">
        <Stat label="Cost of sales" value={etb(row.cost_of_sales)} unit="ETB" />
        <Stat
          label="Gross profit"
          value={etb(row.gross_profit)}
          unit="ETB"
          tone="good"
          note="on costed revenue"
        />
      </div>
    </Card>
  );
}

function SellerTable({
  rows,
  metric,
}: {
  rows: {
    article_code: string;
    article_name: string;
    pos_category: string;
    qty: string;
    total_amount: string;
    depleted: boolean;
  }[];
  metric: 'qty' | 'revenue';
}) {
  return (
    <table className="w-full text-[13px]">
      <tbody className="divide-y divide-ink-100">
        {rows.map((r, i) => (
          <tr key={r.article_code} className="hover:bg-ink-50 dark:bg-[#111111]/60">
            <td className="pl-5 pr-2 py-2 text-ink-400 tnum w-8">{i + 1}</td>
            <td className="px-2 py-2">
              <div className="text-ink-800 dark:text-zinc-200">{r.article_name.trim()}</div>
              <div className="font-mono text-[11px] text-ink-400">
                {r.article_code} · {r.pos_category}
              </div>
            </td>
            <td className="px-2 py-2 text-right">
              {r.depleted ? (
                <Badge tone="good">costed</Badge>
              ) : (
                <Badge tone="warn">no recipe</Badge>
              )}
            </td>
            <td className="pl-2 pr-5 py-2 text-right tnum font-semibold text-ink-900 dark:text-zinc-100 whitespace-nowrap">
              {metric === 'qty' ? (
                <>
                  {qty(r.qty)}
                  <div className="text-[11px] font-normal text-ink-400">{etb(r.total_amount)}</div>
                </>
              ) : (
                <>
                  {etb(r.total_amount)}
                  <div className="text-[11px] font-normal text-ink-400">{qty(r.qty)} units</div>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
