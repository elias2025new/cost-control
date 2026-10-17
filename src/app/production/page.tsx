import Link from 'next/link';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant, listStores } from '../../lib/queries';
import { db } from '../../lib/server-db';
import { etb, qty, shortDate } from '../../lib/format';
import { ButcherYieldCalculator } from './ButcherYieldCalculator';
import { BatchProductionForm } from './BatchProductionForm';

export const dynamic = 'force-dynamic';

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Production & Butcher Yields" />
        <OnboardingNotice />
      </>
    );
  }

  const sp = await searchParams;
  const activeTab = sp.tab || 'yield';
  const d = await db();

  const [stores, { rows: items }, { rows: subRecipes }, { rows: recentYields }, { rows: recentBatches }] =
    await Promise.all([
      listStores(),
      d.query<{ id: string; code: string; name: string; uom: string }>(
        `select id, code, name, uom from items where tenant_id = $1 and is_active order by name`,
        [tenant.id],
      ),
      d.query<{
        id: string;
        code: string;
        name: string;
        yield_qty: string;
        yield_uom: string;
        component_count: number;
        target_item_id: string | null;
      }>(
        `select r.id, r.code, r.name,
                coalesce(r.batch_yield_qty, 1)::text as yield_qty,
                coalesce(r.batch_yield_uom, 'Portion') as yield_uom,
                (select count(*)::int
                   from recipe_lines rl
                   join recipe_versions rv on rv.id = rl.recipe_version_id
                  where rv.recipe_id = r.id and rv.effective_to is null) as component_count,
                (select i.id from items i where i.tenant_id = r.tenant_id and i.code = r.code limit 1) as target_item_id
           from recipes r
          where r.tenant_id = $1 and r.kind = 'sub'
          order by r.name`,
        [tenant.id],
      ),
      d.query<{
        id: string;
        test_number: string;
        test_date: string;
        gross_weight: string;
        total_primal_cost: string;
        usable_weight: string;
        yield_percent: string;
        loss_percent: string;
        cost_factor: string;
        status: string;
        store_name: string;
        primal_name: string;
      }>(
        `select yt.id, yt.test_number, yt.test_date::text as test_date, yt.gross_weight::text,
                yt.total_primal_cost::text, yt.usable_weight::text, yt.yield_percent::text,
                yt.loss_percent::text, yt.cost_factor::text, yt.status,
                s.name as store_name, i.name as primal_name
           from yield_tests yt
           join stores s on s.id = yt.store_id
           join items i on i.id = yt.primal_item_id
          where yt.tenant_id = $1
          order by yt.test_date desc, yt.created_at desc
          limit 10`,
        [tenant.id],
      ),
      d.query<{
        id: string;
        batch_number: string;
        production_date: string;
        produced_qty: string;
        produced_uom: string;
        total_cost: string;
        unit_cost: string;
        status: string;
        store_name: string;
        recipe_name: string;
        target_item_name: string;
      }>(
        `select pb.id, pb.batch_number, pb.production_date::text as production_date,
                pb.produced_qty::text, pb.produced_uom, pb.total_cost::text, pb.unit_cost::text,
                pb.status, s.name as store_name, r.name as recipe_name, i.name as target_item_name
           from production_batches pb
           join stores s on s.id = pb.store_id
           join recipes r on r.id = pb.recipe_id
           join items i on i.id = pb.target_item_id
          where pb.tenant_id = $1
          order by pb.production_date desc, pb.created_at desc
          limit 10`,
        [tenant.id],
      ),
    ]);

  const formattedSubRecipes = subRecipes.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    yieldQty: r.yield_qty,
    yieldUom: r.yield_uom,
    targetItemId: r.target_item_id,
    componentCount: r.component_count,
  }));

  return (
    <>
      <PageHeader
        title="Production & Butcher Yield Engineering"
        subtitle="HMC yield test calculations for carcass breakdowns with byproduct credit salvage, and batch production execution for sub-recipes."
        right={
          <div className="flex items-center gap-3">
            <Link
              href="/reports/cost-control"
              className="px-3.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-[12.5px] font-medium hover:bg-brand-100"
            >
              Executive Cost Dashboard →
            </Link>
          </div>
        }
      />

      <div className="p-8 max-w-6xl space-y-8">
        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-ink-200 dark:border-zinc-800 pb-3">
          <Link
            href="/production?tab=yield"
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              activeTab === 'yield'
                ? 'bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900'
                : 'text-ink-600 dark:text-zinc-400 hover:bg-ink-100 dark:hover:bg-zinc-800'
            }`}
          >
            🔪 Butcher Yield Test Calculator
          </Link>
          <Link
            href="/production?tab=batch"
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              activeTab === 'batch'
                ? 'bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900'
                : 'text-ink-600 dark:text-zinc-400 hover:bg-ink-100 dark:hover:bg-zinc-800'
            }`}
          >
            🍲 Batch Production Execution
          </Link>
          <Link
            href="/production?tab=history"
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              activeTab === 'history'
                ? 'bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900'
                : 'text-ink-600 dark:text-zinc-400 hover:bg-ink-100 dark:hover:bg-zinc-800'
            }`}
          >
            📋 Production History &amp; Logs
          </Link>
        </div>

        {/* Tab 1: Butcher Yield Test Calculator */}
        {activeTab === 'yield' && (
          <Card
            title="Interactive Butcher Yield Test Calculator"
            hint="Break down whole carcass or primal meats into prime cuts, allocate net costs, and credit byproducts at salvage value."
          >
            <ButcherYieldCalculator stores={stores} items={items} />
          </Card>
        )}

        {/* Tab 2: Batch Production Execution */}
        {activeTab === 'batch' && (
          <Card
            title="Batch Production Execution (Sub-Recipes)"
            hint="Execute kitchen preparation runs, exploding raw materials and booking finished prep inventory into stock."
          >
            <BatchProductionForm
              stores={stores}
              subRecipes={formattedSubRecipes}
              items={items}
            />
          </Card>
        )}

        {/* Tab 3: History & Logs */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <Card title="Recent Butcher Yield Tests" hint={`${recentYields.length} tests logged`}>
              {recentYields.length === 0 ? (
                <Empty>No butcher yield tests recorded yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                      <tr className="text-left">
                        <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Test #</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Date</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Store</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Primal Meat</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Gross Wt</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Usable Wt</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Yield %</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Cost Factor</th>
                        <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                      {recentYields.map((y) => (
                        <tr key={y.id} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                          <td className="px-4 py-3 font-mono font-medium text-ink-900 dark:text-zinc-100">
                            {y.test_number}
                          </td>
                          <td className="px-3 py-3 font-mono text-[12px] text-ink-600 dark:text-zinc-400">
                            {shortDate(y.test_date)}
                          </td>
                          <td className="px-3 py-3 text-ink-700 dark:text-zinc-300">{y.store_name}</td>
                          <td className="px-3 py-3 font-medium text-ink-900 dark:text-zinc-100">{y.primal_name}</td>
                          <td className="px-3 py-3 text-right font-mono text-ink-700 dark:text-zinc-300">{qty(y.gross_weight)} kg</td>
                          <td className="px-3 py-3 text-right font-mono text-brand-700 dark:text-brand-300 font-medium">
                            {qty(y.usable_weight)} kg
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-bold text-ink-900 dark:text-zinc-100">
                            {Number(y.yield_percent).toFixed(1)}%
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-ink-700 dark:text-zinc-300">
                            {Number(y.cost_factor).toFixed(3)}x
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={y.status === 'posted' ? 'good' : 'neutral'}>
                              {y.status === 'posted' ? 'Posted' : 'Draft'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Recent Sub-Recipe Production Batches" hint={`${recentBatches.length} batches logged`}>
              {recentBatches.length === 0 ? (
                <Empty>No production batches recorded yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                      <tr className="text-left">
                        <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Batch #</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Date</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Store</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Sub-Recipe</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Output Qty</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Unit Cost</th>
                        <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Total Batch Cost</th>
                        <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                      {recentBatches.map((b) => (
                        <tr key={b.id} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                          <td className="px-4 py-3 font-mono font-medium text-ink-900 dark:text-zinc-100">
                            {b.batch_number}
                          </td>
                          <td className="px-3 py-3 font-mono text-[12px] text-ink-600 dark:text-zinc-400">
                            {shortDate(b.production_date)}
                          </td>
                          <td className="px-3 py-3 text-ink-700 dark:text-zinc-300">{b.store_name}</td>
                          <td className="px-3 py-3 font-medium text-ink-900 dark:text-zinc-100">{b.recipe_name}</td>
                          <td className="px-3 py-3 text-right font-mono text-brand-700 dark:text-brand-300 font-medium">
                            {qty(b.produced_qty)} {b.produced_uom}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-ink-700 dark:text-zinc-300">
                            {etb(b.unit_cost)} ETB
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-bold text-ink-900 dark:text-zinc-100">
                            {etb(b.total_cost)} ETB
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={b.status === 'posted' ? 'good' : 'neutral'}>
                              {b.status === 'posted' ? 'Posted' : 'Draft'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
