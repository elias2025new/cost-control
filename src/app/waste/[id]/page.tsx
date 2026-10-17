import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, Stat } from '../../../components/ui';
import { db } from '../../../lib/server-db';
import { requireTenant, currentUser } from '../../../lib/queries';
import { etb, qty } from '../../../lib/format';
import { approveWasteLogAction, rejectWasteLogAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function WasteLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await requireTenant();
  const user = await currentUser();
  const d = await db();

  const { rows: logs } = await d.query<{
    id: string;
    store_name: string;
    store_kind: string;
    occurred_on: string;
    status: 'draft' | 'submitted' | 'approved' | 'rejected';
    logged_by: string | null;
    approved_by: string | null;
    approved_at: string | null;
    rejection_reason: string | null;
    note: string | null;
  }>(
    `select wl.id,
            s.name as store_name,
            s.kind as store_kind,
            wl.occurred_on::text as occurred_on,
            wl.status,
            wl.note,
            wl.rejection_reason,
            wl.approved_at::text as approved_at,
            u1.display_name as logged_by,
            u2.display_name as approved_by
       from waste_logs wl
       join stores s on s.id = wl.store_id
       left join users u1 on u1.id = wl.logged_by_user_id
       left join users u2 on u2.id = wl.approved_by_user_id
      where wl.tenant_id = $1 and wl.id = $2`,
    [t.id, id],
  );

  const log = logs[0];
  if (!log) notFound();

  const { rows: lines } = await d.query<{
    id: string;
    item_code: string;
    item_name: string;
    uom: string;
    qty: string;
    reason: string;
    unit_cost: string | null;
    total_cost: string | null;
    note: string | null;
  }>(
    `select l.id,
            i.code as item_code,
            i.name as item_name,
            i.uom,
            l.qty::text as qty,
            l.reason,
            l.unit_cost::text as unit_cost,
            l.total_cost::text as total_cost,
            l.note
       from waste_log_lines l
       join items i on i.id = l.item_id
      where l.waste_log_id = $1
      order by i.name`,
    [id],
  );

  const totalValue = lines.reduce(
    (acc, cur) => acc + (cur.total_cost ? Number(cur.total_cost) : 0),
    0,
  );

  const canApprove = user?.role === 'admin' || user?.permissions?.includes('approve_waste');

  return (
    <>
      <PageHeader
        title={`Waste Log — ${log.store_name}`}
        subtitle={`Recorded on ${log.occurred_on} · ${log.note || 'No notes'}`}
        right={
          <Link
            href="/waste"
            className="text-[13px] text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-200"
          >
            ← Back to Waste List
          </Link>
        }
      />

      <div className="p-8 max-w-5xl space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <Stat label="Status" value={<Badge tone={log.status === 'approved' ? 'good' : log.status === 'submitted' ? 'warn' : 'neutral'}>{log.status.toUpperCase()}</Badge>} />
          </Card>
          <Card>
            <Stat label="Items Logged" value={lines.length} />
          </Card>
          <Card>
            <Stat label="Total Write-off" value={etb(totalValue)} unit="ETB" tone={totalValue > 0 ? 'warn' : 'neutral'} />
          </Card>
          <Card>
            <Stat label="Logged By" value={log.logged_by || 'Staff'} note={log.approved_by ? `Approved by ${log.approved_by}` : 'Pending audit'} />
          </Card>
        </div>

        {log.status === 'rejected' && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-[13.5px] text-rose-800">
            <strong>Rejection Reason:</strong> {log.rejection_reason || 'No explanation provided.'}
          </div>
        )}

        <Card title="Line Items">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-ink-950 text-ink-500 text-left">
                <tr>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Item</th>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Quantity</th>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Reason Code</th>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Est. Unit Cost</th>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Total Cost</th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink-900 dark:text-ink-100">{l.item_name}</div>
                      <div className="text-[11px] font-mono text-ink-400">{l.item_code} · {l.uom}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      {qty(l.qty)} {l.uom}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{l.reason.replace('_', ' ').toUpperCase()}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink-600 dark:text-ink-400">
                      {l.unit_cost ? etb(l.unit_cost) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-ink-900 dark:text-ink-100">
                      {l.total_cost ? etb(l.total_cost) : '-'}
                    </td>
                    <td className="px-5 py-3 text-ink-600 dark:text-ink-400 text-[12.5px]">
                      {l.note || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {canApprove && (log.status === 'submitted' || log.status === 'draft') && (
          <div className="p-6 bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-xl flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-semibold text-ink-900 dark:text-ink-100">
                F&B Cost Controller Authorization
              </h3>
              <p className="text-[12.5px] text-ink-500 mt-0.5">
                Approving this log writes irreversible debit movements to the stock ledger and values the loss.
              </p>
            </div>
            <div className="flex gap-3">
              <form
                action={async (formData: FormData) => {
                  'use server';
                  const reason = String(formData.get('rejectionReason') || 'Unjustified write-off');
                  await rejectWasteLogAction(id, reason);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  name="rejectionReason"
                  placeholder="Rejection reason…"
                  className="rounded-lg border border-ink-200 dark:border-ink-700 px-3 py-1.5 text-[12.5px] focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[13px] font-medium transition cursor-pointer"
                >
                  Reject
                </button>
              </form>

              <form
                action={async () => {
                  'use server';
                  await approveWasteLogAction(id);
                }}
              >
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-medium transition cursor-pointer"
                >
                  Approve & Write Off to Ledger
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
