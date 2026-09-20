import Link from 'next/link';
import { PageHeader, Card, Stat, Badge, SampleNotice, OnboardingNotice } from '../components/ui';
import { currentTenant, overviewStats, recipeCostsToday, listImports } from '../lib/queries';
import { etb, pct } from '../lib/format';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader
          title="Overview"
          subtitle="What it costs to make what we sold, what stock should be, and where the difference is."
        />
        <OnboardingNotice />
      </>
    );
  }

  const [stats, recipes, imports] = await Promise.all([
    overviewStats(),
    recipeCostsToday(),
    listImports(),
  ]);

  const menuRecipes = recipes.filter((r) => r.kind === 'menu');
  const subRecipes = recipes.filter((r) => r.kind === 'sub');
  const latest = imports[0];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What it costs to make what we sold, what stock should be, and where the difference is."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {recipes.some((r) => r.is_sample) && <SampleNotice />}

        <div className="grid grid-cols-4 gap-4">
          <Card>
            <Stat
              label="POS articles"
              value={stats.articles}
              note={`${stats.mapped} mapped to a menu item`}
            />
          </Card>
          <Card>
            <Stat
              label="Recipes"
              value={stats.recipes}
              note={`plus ${stats.sub_recipes} sub-recipes`}
            />
          </Card>
          <Card>
            <Stat label="Stock movements" value={stats.movements} note="append-only ledger" />
          </Card>
          <Card>
            <Stat
              label="Imports posted"
              value={stats.imports_posted}
              note={latest ? `latest ${latest.period_end}` : 'none yet'}
            />
          </Card>
        </div>

        {latest && (
          <Card
            title="Latest import"
            right={
              <Link
                href={`/import/${latest.id}`}
                className="text-[13px] text-brand-700 hover:underline"
              >
                Open →
              </Link>
            }
          >
            <div className="grid grid-cols-4 divide-x divide-ink-100 dark:divide-ink-800">
              <Stat label="Net sales" value={etb(latest.computed_sub_total)} unit="ETB" />
              <Stat label="Lines" value={latest.line_count} />
              <Stat
                label="Revenue costed"
                value={latest.revenue_costed_pct ? pct(latest.revenue_costed_pct) : '-'}
                tone="good"
              />
              <Stat
                label="Reconciles"
                value={latest.reconciled ? 'Yes' : 'No'}
                tone={latest.reconciled ? 'good' : 'bad'}
              />
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-6">
          <Card title="Menu recipes" hint="Cost per portion, as at today">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {menuRecipes.map((r) => (
                  <tr key={r.recipe_code}>
                    <td className="px-5 py-2.5 text-ink-800 dark:text-ink-200">
                      {r.recipe_name}
                      {r.is_sample && (
                        <span className="ml-1.5 inline-block align-middle"><Badge tone="sample">Sample</Badge></span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral">{r.menu_kind}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right tnum font-medium text-ink-900 dark:text-ink-100">
                      {etb(r.cost_per_portion)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Sub-recipes" hint="Costed once over a batch, pulled into their parents">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {subRecipes.map((r) => (
                  <tr key={r.recipe_code}>
                    <td className="px-5 py-2.5 text-ink-800 dark:text-ink-200">
                      {r.recipe_name}
                      {r.is_sample && (
                        <span className="ml-1.5 inline-block align-middle"><Badge tone="sample">Sample</Badge></span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tnum font-medium text-ink-900 dark:text-ink-100">
                      {etb(r.cost_per_portion)}
                      <span className="text-[11px] text-ink-400 font-normal ml-1">/ batch</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
