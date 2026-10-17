import Link from 'next/link';
import { PageHeader, Card, Badge } from '../../components/ui';
import { db } from '../../lib/server-db';
import { requireTenant, currentUser } from '../../lib/queries';
import { NewWasteForm } from './NewWasteForm';
import { etb } from '../../lib/format';
import { approveWasteLogAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function WastePage() {
  const t = await requireTenant();
  const user = await currentUser();
  const d = await db();

  // Load stores (kitchen and bar)
  const { rows: stores } = await d.query<{ id: string; name: string; kind: string }>(
    `select id, name, kind from stores where tenant_id = $1 and is_active and kind in ('kitchen', 'bar', 'main') order by name`,
    [t.id],
  );

  // Load active items
  const { rows: items } = await d.query<{ id: string; code: string; name: string; uom: string }>(
    `select id, code, name, uom from items where tenant_id = $1 and is_active order by name`,
    [t.id],
  );

  // Load recent waste logs
  const { rows: logs } = await d.query<{
    id: string;
    store_id: string;
    store_name: string;
    occurred_on: string;
    status: 'draft' | 'submitted' | 'approved' | 'rejected';
    item_count: string;
    total_cost: string | null;
    logged_by: string | null;
    approved_by: string | null;
    note: string | null;
  }>(
    `select wl.id,
            wl.store_id,
            s.name as store_name,
            wl.occurred_on::text as occurred_on,
            wl.status,
            wl.note,
            u1.display_name as logged_by,
            u2.display_name as approved_by,
            (select count(*)::text from waste_log_lines l where l.waste_log_id = wl.id) as item_count,
            (select coalesce(sum(l.total_cost), 0)::text from waste_log_lines l where l.waste_log_id = wl.id) as total_cost
       from waste_logs wl
       join stores s on s.id = wl.store_id
       left join users u1 on u1.id = wl.logged_by_user_id
       left join users u2 on u2.id = wl.approved_by_user_id
      where wl.tenant_id = $1
      order by wl.occurred_on desc, wl.created_at desc
      limit 25`,
    [t.id],
  );

  const canApprove = user?.role === 'admin' || user?.permissions?.includes('approve_waste');

  return (
    <>
      <PageHeader
        title="Waste, Spoilage & Leakage Register"
        subtitle="Digital kitchen burns, bar breakage, expired preps, comps, and staff meal write-offs with Controller signoff."
      />

      <div className="p-8 max-w-6xl space-y-8">
        <NewWasteForm
          stores={stores}
          items={items}
          defaultStoreId={user?.storeId ?? undefined}
        />

        <Card title="Recent Waste & Leakage Logs" hint="Click on a submitted log to audit lines or sign off">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-ink-500 text-[13.5px]">
              No waste logs recorded yet. Use the form above to log daily burns, breakages, or staff meals.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-ink-950 text-ink-500 text-left">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Store</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Items</th>
                    <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Value (ETB)</th>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Logged By</th>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {logs.map((log) => {
                    const statusBadgeTone =
                      log.status === 'approved'
                        ? 'good'
                        : log.status === 'submitted'
                          ? 'warn'
                          : log.status === 'rejected'
                            ? 'block'
                            : 'neutral';

                    return (
                      <tr key={log.id} className="hover:bg-ink-50/50 dark:hover:bg-ink-900/50">
                        <td className="px-5 py-3 font-mono text-[12px] text-ink-800 dark:text-ink-200">
                          {log.occurred_on}
                        </td>
                        <td className="px-4 py-3 font-medium text-ink-900 dark:text-ink-100">
                          {log.store_name}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusBadgeTone}>{log.status.toUpperCase()}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink-700 dark:text-ink-300">
                          {log.item_count}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink-900 dark:text-ink-100 font-medium">
                          {log.total_cost && Number(log.total_cost) > 0 ? etb(log.total_cost) : '-'}
                        </td>
                        <td className="px-5 py-3 text-ink-600 dark:text-ink-400 text-[12px]">
                          {log.logged_by || 'Staff'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/waste/${log.id}`}
                              className="text-[12.5px] text-brand-600 hover:text-brand-700 font-medium hover:underline"
                            >
                              Details →
                            </Link>
                            {canApprove && log.status === 'submitted' && (
                              <form
                                action={async () => {
                                  'use server';
                                  await approveWasteLogAction(log.id);
                                }}
                              >
                                <button
                                  type="submit"
                                  className="px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded text-[11.5px] font-medium transition cursor-pointer"
                                >
                                  Approve
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
