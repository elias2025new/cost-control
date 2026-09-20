import Link from 'next/link';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant, currentUser, listStores } from '../../lib/queries';
import { listCounts } from '../../lib/reports';
import { etb, qty, shortDate } from '../../lib/format';
import { NewCountForm } from './NewCountForm';

export const dynamic = 'force-dynamic';

export default async function CountsPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Physical count" />
        <OnboardingNotice />
      </>
    );
  }

  const [me, allStores, allCounts] = await Promise.all([
    currentUser(),
    listStores(),
    listCounts(),
  ]);
  // A store user only counts, and only sees counts for, their own store.
  const isScoped = !!me && me.role !== 'admin';
  const stores = isScoped ? allStores.filter((s) => s.id === me!.storeId) : allStores;
  const counts = isScoped ? allCounts.filter((c) => c.store_id === me!.storeId) : allCounts;

  const defaultDate = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Physical count"
        subtitle="Walk the shelves, enter what is actually there. Posting writes the difference into the ledger as an adjustment - nothing is overwritten."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="Start a count">
          <NewCountForm stores={stores} defaultDate={defaultDate} />
        </Card>

        <Card title="Counts" hint={`${counts.length} sheet${counts.length === 1 ? '' : 's'}`}>
          {counts.length === 0 ? (
            <Empty>No counts yet. Start one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Store</Th>
                  <Th>Counted by</Th>
                  <Th right>Lines counted</Th>
                  <Th right>Net variance</Th>
                  <Th>Flags</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {counts.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-3">
                      <Link
                        href={`/counts/${c.id}`}
                        className="font-medium text-ink-900 dark:text-zinc-100 hover:text-brand-700"
                      >
                        {shortDate(c.count_date)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-700">{c.store_name}</td>
                    <td className="px-3 py-3 text-ink-500">{c.counted_by ?? '-'}</td>
                    <td className="px-3 py-3 text-right tnum text-ink-700">
                      {c.counted_lines} / {c.line_count}
                    </td>
                    <td className="px-3 py-3 text-right tnum font-medium">
                      {c.status === 'posted' ? etb(c.net_value) : '-'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1.5">
                        {Number(c.investigate) > 0 && (
                          <Badge tone="block">{c.investigate} investigate</Badge>
                        )}
                        {Number(c.review) > 0 && <Badge tone="warn">{c.review} review</Badge>}
                        {Number(c.investigate) === 0 && Number(c.review) === 0 && (
                          <Badge tone="good">clean</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={c.status === 'posted' ? 'good' : 'neutral'}>
                        {c.status === 'posted' ? 'Posted' : 'Draft'}
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
