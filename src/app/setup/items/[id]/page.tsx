import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, OnboardingNotice } from '../../../../components/ui';
import { DeleteButton } from '../../../../components/DeleteButton';
import { currentTenant } from '../../../../lib/queries';
import { getItem, listParLevelsForItem, listCategories } from '../../../../lib/masterData';
import { costHistory } from '../../../../lib/recipes';
import { etb, longDate } from '../../../../lib/format';
import { CostChangeForm } from '../../../recipes/CostChangeForm';
import { ParLevelsTable } from './ParLevelsTable';
import { ItemEditForm } from './ItemEditForm';
import { deleteItem } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SetupItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Item" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const item = await getItem(id);
  if (!item) notFound();

  const [history, parLevels, categories] = await Promise.all([
    costHistory(id),
    listParLevelsForItem(id),
    listCategories(),
  ]);
  const current = history.find((h) => h.effective_to === null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={
          <>
            {item.code} · {item.category_name} · measured in {item.uom}
          </>
        }
        right={
          <Link
            href="/setup/items"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All items
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-4xl">
        {item.is_sample && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-[12.5px] text-violet-900">
            This item was loaded from the demo dataset - its cost is a sample, not a real figure.
          </div>
        )}

        <Card title="Edit item">
          <ItemEditForm
            id={item.id}
            code={item.code}
            name={item.name}
            uom={item.uom}
            categoryId={item.category_id}
            categories={categories}
          />
        </Card>

        <Card title="Change the cost" hint="Creates a new version - never an edit">
          <CostChangeForm
            ingredients={[
              {
                id: item.id,
                name: item.name,
                uom: item.uom,
                current_cost: current?.standard_cost ?? null,
              },
            ]}
            defaultDate={today}
            defaultItemId={item.id}
          />
        </Card>

        <Card title="Cost history" hint="Every version ever recorded, with the window it applied to">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                  From
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                  Until
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                  Standard cost
                </th>
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {history.map((h) => (
                <tr key={h.effective_from}>
                  <td className="px-5 py-2.5 text-ink-800 dark:text-zinc-200">{longDate(h.effective_from)}</td>
                  <td className="px-3 py-2.5 text-ink-600">
                    {h.effective_to ? longDate(h.effective_to) : <Badge tone="good">current</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-right tnum font-medium text-ink-900 dark:text-zinc-100">
                    {etb(h.standard_cost)}
                  </td>
                  <td className="px-5 py-2.5 text-ink-500">{h.note ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Par levels" hint="Minimum and maximum stock, per store">
          <ParLevelsTable itemId={item.id} rows={parLevels} />
        </Card>

        <Card title="Delete item" hint="Only possible if it's not used in a recipe, movement, or count yet">
          <div className="px-5 py-5">
            <DeleteButton
              action={deleteItem}
              id={item.id}
              label="Delete this item"
              confirmText={`Delete "${item.name}"? This cannot be undone.`}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
