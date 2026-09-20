import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { listItems, listCategories } from '../../../lib/masterData';
import { etb } from '../../../lib/format';
import { ItemForm } from './ItemForm';

export const dynamic = 'force-dynamic';

export default async function SetupItemsPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Items" />
        <OnboardingNotice />
      </>
    );
  }

  const categories = await listCategories();
  if (categories.length === 0) redirect('/setup/categories');

  const items = await listItems();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="What the business buys, stores, and uses in recipes. Cost is set here and versioned from day one."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="Add an item">
          <ItemForm categories={categories} defaultDate={today} />
        </Card>

        <Card title="Items" hint={`${items.length} so far`}>
          {items.length === 0 ? (
            <Empty>No items yet. Add one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                    Current cost
                  </th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/setup/items/${i.id}`}
                        className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
                      >
                        {i.name}
                      </Link>
                      <span className="font-mono text-[11px] text-ink-400 ml-2">{i.code}</span>
                      {i.is_sample && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Badge tone="sample">Sample</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-600">{i.category_name}</td>
                    <td className="px-3 py-2.5 text-right tnum text-ink-700">
                      {i.current_cost ? `${etb(i.current_cost)} / ${i.uom}` : '-'}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={i.is_active ? 'good' : 'neutral'}>
                        {i.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
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
