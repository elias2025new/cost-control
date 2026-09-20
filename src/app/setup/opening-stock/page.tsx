import { redirect } from 'next/navigation';
import { PageHeader, Card, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listStores } from '../../../lib/queries';
import { listItems, listOpeningBalances } from '../../../lib/masterData';
import { etb, qty, shortDate } from '../../../lib/format';
import { OpeningStockForm } from './OpeningStockForm';

export const dynamic = 'force-dynamic';

export default async function SetupOpeningStockPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Opening stock" />
        <OnboardingNotice />
      </>
    );
  }

  const stores = await listStores();
  if (stores.length === 0) redirect('/setup/stores');
  const items = await listItems();
  if (items.length === 0) redirect('/setup/items');

  const balances = await listOpeningBalances();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Opening stock"
        subtitle="The first quantity a store holds of an item. One entry per store and item - everything else in the ledger builds on this."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="Record opening stock">
          <OpeningStockForm stores={stores} items={items} defaultDate={today} />
        </Card>

        <Card title="Opening balances recorded" hint={`${balances.length} so far`}>
          {balances.length === 0 ? (
            <Empty>Nothing recorded yet. Enter one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Store
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                    Quantity
                  </th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                    Unit cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {balances.map((b) => (
                  <tr key={b.id}>
                    <td className="px-5 py-2.5 text-ink-600 whitespace-nowrap">
                      {shortDate(b.occurred_on)}
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">{b.store_name}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-ink-800 dark:text-zinc-200">{b.item_name}</span>
                      <span className="font-mono text-[11px] text-ink-400 ml-1.5">
                        {b.item_code}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tnum text-ink-700">
                      {qty(b.qty_delta)} {b.uom}
                    </td>
                    <td className="px-5 py-2.5 text-right tnum text-ink-700">
                      {etb(b.unit_cost)}
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
