import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db as getDb } from '../../lib/server-db';
import { currentTenant, currentUser, listStores, requireTenant, requireUser } from '../../lib/queries';
import { listIssueRequests, listItems } from '../../lib/masterData';
import { shortDate } from '../../lib/format';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../components/ui';

import { NewRequestForm } from '../requests/NewRequestForm';
import { NewPurchaseRequestForm } from '../purchase-requests/NewPurchaseRequestForm';

export const dynamic = 'force-dynamic';

const STOCK_STATUS: Record<string, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  requested: { tone: 'warn', label: 'Waiting' },
  fulfilled: { tone: 'good', label: 'Released' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

const PURCHASE_STATUS: Record<string, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  requested: { tone: 'warn', label: 'Requested' },
  resolved: { tone: 'good', label: 'Resolved' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

export default async function IssuesPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Issues Hub" />
        <OnboardingNotice />
      </>
    );
  }

  const user = await currentUser();
  if (!user) redirect('/login');

  const db = await getDb();
  const [allStores, items] = await Promise.all([listStores(), listItems()]);

  // Requestable stores logic
  const requestableStores = allStores.filter(
    (s) => s.kind !== 'main' && (user.role === 'admin' || s.id === user.storeId),
  );

  // 1. Fetch Stock Requests
  const stockRequestsRaw = await listIssueRequests(user.role === 'admin' ? null : user.storeId);
  const stockRequests = stockRequestsRaw.map((r) => ({
    id: r.id,
    type: 'Stock Request' as const,
    date: r.requested_at,
    from: r.requesting_store,
    to: r.fulfilling_store,
    user: r.requested_by,
    items: r.line_count,
    status: r.status,
    link: `/requests/${r.id}`,
  }));

  // 2. Fetch Purchase Requests
  let filter = `r.tenant_id = $1`;
  const params: unknown[] = [tenant.id];

  if (user.role !== 'admin') {
    const myStore = allStores.find((s) => s.id === user.storeId);
    if (myStore && myStore.kind !== 'main') {
      filter += ` and r.requesting_store_id = $2`;
      params.push(myStore.id);
    }
  }

  const { rows: prRows } = await db.query<{
    id: string;
    requesting_store_name: string;
    status: string;
    requested_at: string;
    requested_by: string;
    line_count: string;
  }>(
    `select r.id,
            s.name as requesting_store_name,
            r.status,
            r.requested_at::text as requested_at,
            u.display_name as requested_by,
            count(l.id)::text as line_count
       from purchase_requests r
       join stores s on s.id = r.requesting_store_id
       left join users u on u.id = r.requested_by_user_id
       left join purchase_request_lines l on l.request_id = r.id
      where ${filter}
      group by r.id, s.name, u.display_name`,
    params,
  );

  const purchaseRequests = prRows.map((r) => ({
    id: r.id,
    type: 'Purchase Request' as const,
    date: r.requested_at,
    from: r.requesting_store_name,
    to: 'Purchasing Dept.',
    user: r.requested_by,
    items: r.line_count,
    status: r.status,
    link: `/purchase-requests/${r.id}`,
  }));

  // Combine and sort by date descending
  const allRequests = [...stockRequests, ...purchaseRequests].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const hasIssueCreate = user.role === 'admin' || user.permissions?.includes('all') || user.permissions?.includes('issue_create');

  return (
    <>
      <PageHeader
        title="Issues Hub"
        subtitle="Manage stock requests to the main store and purchase requests to suppliers."
      />

      <div className="p-8 space-y-6 max-w-5xl">
        {hasIssueCreate && requestableStores.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.length > 0 && (
              <Card title="Request Stock from Main Store">
                <NewRequestForm stores={requestableStores} items={items} />
              </Card>
            )}
            <Card title="Request Purchase from Supplier">
              <NewPurchaseRequestForm stores={requestableStores} />
            </Card>
          </div>
        )}

        <Card title="All Requests" hint={`${allRequests.length} so far`}>
          {allRequests.length === 0 ? (
            <Empty>No requests found.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    From → To
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                    Items
                  </th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {allRequests.map((r) => {
                  let badgeObj;
                  if (r.type === 'Stock Request') {
                    badgeObj = STOCK_STATUS[r.status] ?? STOCK_STATUS.requested;
                  } else {
                    badgeObj = PURCHASE_STATUS[r.status] ?? PURCHASE_STATUS.draft;
                  }

                  return (
                    <tr key={r.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                      <td className="px-5 py-2.5">
                        <Link
                          href={r.link}
                          className="font-medium text-ink-900 dark:text-zinc-100 hover:text-brand-700"
                        >
                          {shortDate(r.date.slice(0, 10))}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-ink-700 dark:text-zinc-200">
                        {r.type}
                      </td>
                      <td className="px-3 py-2.5 text-ink-600">
                        {r.from} <span className="text-ink-300">→</span> {r.to}
                      </td>
                      <td className="px-3 py-2.5 text-ink-500">{r.user || '—'}</td>
                      <td className="px-3 py-2.5 text-right tnum text-ink-700">{r.items}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={badgeObj.tone}>{badgeObj.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
