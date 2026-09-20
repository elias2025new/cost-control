import { PageHeader, Card, Badge, SampleNotice, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant, currentUser } from '../../lib/queries';
import { recipeCostsAsOf, listIngredients, costHistory } from '../../lib/recipes';
import { etb, qty, longDate } from '../../lib/format';
import { dec } from '../../lib/money';
import { CostChangeForm } from './CostChangeForm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * Recipe costs, as at a date you choose.
 *
 * The two date columns side by side are the whole argument: change a cost
 * today and the earlier column does not move.
 */
export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; item?: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Recipes and costs" />
        <OnboardingNotice />
      </>
    );
  }

  const user = await currentUser();
  const canManageRecipes = user?.role === 'admin' || user?.permissions?.includes('recipe_build') || user?.permissions?.includes('all');
  const canManageCosts = user?.role === 'admin' || user?.permissions?.includes('recipe_cost_manage') || user?.permissions?.includes('all');

  const sp = await searchParams;
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const defaultAfter = today.toISOString().slice(0, 10);
  const defaultBefore = thirtyDaysAgo.toISOString().slice(0, 10);

  const before = /^\d{4}-\d{2}-\d{2}$/.test(sp.before ?? '') ? sp.before! : defaultBefore;
  const after = /^\d{4}-\d{2}-\d{2}$/.test(sp.after ?? '') ? sp.after! : defaultAfter;

  const [costsBefore, costsAfter, ingredients] = await Promise.all([
    recipeCostsAsOf(before),
    recipeCostsAsOf(after),
    listIngredients(),
  ]);

  const afterById = new Map(costsAfter.map((r) => [r.recipe_id, r]));
  const changed = costsBefore.filter((r) => {
    const a = afterById.get(r.recipe_id);
    return r.cost && a?.cost && !dec(r.cost).equals(dec(a.cost));
  });

  const selectedItem = sp.item && ingredients.some((i) => i.id === sp.item) ? sp.item : null;
  const history = selectedItem ? await costHistory(selectedItem) : [];
  const multiVersion = ingredients.filter((i) => Number(i.version_count) > 1);

  return (
    <>
      <PageHeader
        title="Recipes and costs"
        subtitle="What each dish costs to make, priced at the ingredient costs in force on a date you choose."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <div className="flex justify-end">
          {canManageRecipes ? (
            <Link
              href="/setup/recipes"
              className="rounded-lg bg-brand-700 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-brand-600 shadow-sm"
            >
              + Create or Edit Recipes
            </Link>
          ) : (
            <span
              className="rounded-lg bg-ink-300 dark:bg-zinc-700 px-4 py-2 text-[13.5px] font-medium text-white shadow-sm opacity-50 cursor-not-allowed"
              title="You do not have permission to build recipes"
            >
              + Create or Edit Recipes
            </span>
          )}
        </div>

        {costsAfter.some((r) => r.is_sample) && <SampleNotice />}

        <div className={canManageCosts ? '' : 'opacity-50 pointer-events-none'}>
          <Card title="Change an ingredient cost (CAIC)" hint={canManageCosts ? "Creates a new version - never an edit" : "You do not have permission to manage costs"}>
            <CostChangeForm ingredients={ingredients} defaultDate={defaultAfter} />
          </Card>
        </div>

        <Card
          title="Recipe cost, two dates side by side"
          hint="Change a cost above, then watch which column moves"
          right={
            <form method="get" className="flex items-end gap-2">
              <label className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                <span className="block mb-1">Earlier</span>
                <input
                  type="date"
                  name="before"
                  defaultValue={before}
                  className="rounded-md border border-ink-200 dark:border-zinc-700 px-2 py-1 text-[12.5px] font-normal normal-case tracking-normal text-ink-800 dark:text-zinc-200"
                />
              </label>
              <label className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                <span className="block mb-1">Later</span>
                <input
                  type="date"
                  name="after"
                  defaultValue={after}
                  className="rounded-md border border-ink-200 dark:border-zinc-700 px-2 py-1 text-[12.5px] font-normal normal-case tracking-normal text-ink-800 dark:text-zinc-200"
                />
              </label>
              <button className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2.5 py-1 text-[12.5px] font-medium text-ink-700 hover:border-ink-300">
                Show
              </button>
            </form>
          }
        >
          {changed.length > 0 && (
            <div className="mx-5 mt-4 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5">
              <p className="text-[12.5px] text-brand-700 leading-snug">
                <strong className="font-semibold">
                  {`${changed.length} ${
                    changed.length === 1 ? 'recipe costs' : 'recipes cost'
                  } differently on ${longDate(after)}`}
                </strong>{' '}
                than on {longDate(before)} - and the {longDate(before)} figure is exactly what it
                was before the change was recorded.
              </p>
            </div>
          )}

          <table className="w-full text-[13px] mt-2">
            <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
              <tr className="text-left">
                <Th>Recipe</Th>
                <Th>Type</Th>
                <Th right>{longDate(before)}</Th>
                <Th right>{longDate(after)}</Th>
                <Th right>Change</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {costsBefore.map((r) => {
                const a = afterById.get(r.recipe_id);
                const diff =
                  r.cost && a?.cost ? dec(a.cost).minus(dec(r.cost)) : null;
                const moved = diff !== null && !diff.isZero();
                return (
                  <tr key={r.recipe_id} className={moved ? 'bg-brand-50/40' : ''}>
                    <td className="px-5 py-2.5">
                      <span className="text-ink-800 dark:text-zinc-200">{r.recipe_name}</span>
                      <span className="font-mono text-[11px] text-ink-400 ml-2">
                        {r.recipe_code}
                      </span>
                      {r.is_sample && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Badge tone="sample">Sample</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.kind === 'sub' ? (
                        <Badge tone="neutral">sub-recipe / batch</Badge>
                      ) : (
                        <Badge tone="neutral">{r.menu_kind}</Badge>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right tnum text-ink-700 ${canManageCosts ? '' : 'opacity-30 blur-[2px] select-none'}`}>{etb(r.cost)}</td>
                    <td
                      className={`px-3 py-2.5 text-right tnum ${
                        moved ? 'font-semibold text-ink-900 dark:text-zinc-100' : 'text-ink-700'
                      } ${canManageCosts ? '' : 'opacity-30 blur-[2px] select-none'}`}
                    >
                      {etb(a?.cost ?? null)}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right tnum ${
                        moved ? 'font-semibold text-amber-700' : 'text-ink-300'
                      } ${canManageCosts ? '' : 'opacity-30 blur-[2px] select-none'}`}
                    >
                      {diff === null ? '-' : diff.isZero() ? 'unchanged' : `+${etb(diff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card
          title="Cost history"
          hint="Every version ever recorded, with the window it applied to"
          right={
            <form method="get" className="flex items-end gap-2">
              <input type="hidden" name="before" value={before} />
              <input type="hidden" name="after" value={after} />
              <select
                name="item"
                defaultValue={selectedItem ?? ''}
                className="rounded-md border border-ink-200 dark:border-zinc-700 px-2 py-1 text-[12.5px] text-ink-800 dark:text-zinc-200"
              >
                <option value="">Choose an ingredient…</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {Number(i.version_count) > 1 ? ` (${i.version_count} versions)` : ''}
                  </option>
                ))}
              </select>
              <button className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2.5 py-1 text-[12.5px] font-medium text-ink-700 hover:border-ink-300">
                Show
              </button>
            </form>
          }
        >
          {!selectedItem ? (
            <Empty>
              {multiVersion.length > 0 ? (
                <>
                  {multiVersion.length} ingredient
                  {multiVersion.length === 1 ? ' has' : 's have'} more than one cost version.
                  Choose one above.
                </>
              ) : (
                <>Every ingredient still has its original cost. Change one above.</>
              )}
            </Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <Th>From</Th>
                  <Th>Until</Th>
                  <Th right>Standard cost</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {history.map((h) => (
                  <tr key={h.effective_from}>
                    <td className="px-5 py-2.5 text-ink-800 dark:text-zinc-200">{longDate(h.effective_from)}</td>
                    <td className="px-3 py-2.5 text-ink-600">
                      {h.effective_to ? (
                        longDate(h.effective_to)
                      ) : (
                        <Badge tone="good">current</Badge>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right tnum font-medium text-ink-900 dark:text-zinc-100 ${canManageCosts ? '' : 'opacity-30 blur-[2px] select-none'}`}>
                      {etb(h.standard_cost)}
                    </td>
                    <td className="px-5 py-2.5 text-ink-500">{h.note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 first:pl-5 last:pr-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
