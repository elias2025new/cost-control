import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db as getDb } from '../../../lib/server-db';
import { requireTenant, requireUser, listStores } from '../../../lib/queries';
import { listItems } from '../../../lib/masterData';
import { RequestLinesEditor } from './RequestLinesEditor';
import { submitPurchaseRequestAction, cancelPurchaseRequestAction, resolvePurchaseRequestAction } from '../actions';
import { PageHeader, Card, Badge } from '../../../components/ui';

export default async function PurchaseRequestDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const tenant = await requireTenant();
  const user = await requireUser();
  const db = await getDb();

  const { rows: requests } = await db.query<{
    id: string;
    requesting_store_id: string;
    requesting_store_name: string;
    status: string;
    requested_at: string;
    requested_by: string;
    note: string | null;
  }>(
    `select r.id,
            r.requesting_store_id,
            s.name as requesting_store_name,
            r.status,
            r.requested_at::text as requested_at,
            u.display_name as requested_by,
            r.note
       from purchase_requests r
       join stores s on s.id = r.requesting_store_id
       left join users u on u.id = r.requested_by_user_id
      where r.id = $1 and r.tenant_id = $2`,
    [params.id, tenant.id],
  );

  if (requests.length === 0) {
    notFound();
  }
  const req = requests[0];

  const allStores = await listStores();
  const userStore = allStores.find(s => s.id === user.storeId);
  const isMainStore = userStore?.kind === 'main';

  // Auth: User can see if they are admin, or if it's their store's request, or if they are the main store.
  if (user.role !== 'admin' && user.storeId !== req.requesting_store_id && !isMainStore) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 text-red-700 p-4 rounded border border-red-200">
          You do not have access to view this purchase request.
        </div>
      </div>
    );
  }

  const { rows: lines } = await db.query<{
    item_id: string;
    item_name: string;
    uom: string;
    requested_qty: string;
    note: string | null;
  }>(
    `select l.item_id,
            i.name as item_name,
            i.uom,
            l.requested_qty,
            l.note
       from purchase_request_lines l
       join items i on i.id = l.item_id
      where l.request_id = $1 and l.tenant_id = $2
      order by i.name`,
    [req.id, tenant.id],
  );

  const isDraft = req.status === 'draft';
  const isRequested = req.status === 'requested';
  const isResolved = req.status === 'resolved';

  const items = await listItems();
  // Map lines to input type for editor
  const initialLines = lines.map((l) => ({
    itemId: l.item_id,
    qty: l.requested_qty,
    note: l.note || '',
  }));

  // Can the current user submit it? Only if draft and they belong to requesting store (or admin)
  const canSubmit = isDraft && (user.role === 'admin' || user.storeId === req.requesting_store_id);
  // Can the current user cancel it? Main store or requesting store
  const canCancel = (isDraft || isRequested) && (user.role === 'admin' || user.storeId === req.requesting_store_id || isMainStore);
  // Can resolve? Only main store (or admin)
  const canResolve = isRequested && (user.role === 'admin' || isMainStore);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 text-[13px] font-medium text-gray-500 mb-2">
        <Link href="/purchase-requests" className="hover:text-brand-600 hover:underline">
          ← Back to Purchase Requests
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-1">
            Purchase Request
          </h1>
          <div className="text-[13px] text-gray-600 space-y-0.5">
            <div>
              <span className="font-medium text-gray-800 dark:text-zinc-200">From:</span> {req.requesting_store_name}
            </div>
            <div>
              <span className="font-medium text-gray-800 dark:text-zinc-200">Requested by:</span> {req.requested_by || 'System'}
            </div>
            <div>
              <span className="font-medium text-gray-800 dark:text-zinc-200">Date:</span> {req.requested_at}
            </div>
          </div>
        </div>
        <div>
          <Badge
            tone={
              req.status === 'draft' ? 'neutral' : 
              req.status === 'requested' ? 'warn' : 
              req.status === 'resolved' ? 'good' : 'neutral'
            }
          >
            {req.status.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-4">Items Requested</h2>

        {isDraft ? (
          <RequestLinesEditor requestId={req.id} initialLines={initialLines} items={items} />
        ) : (
          <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
                <tr>
                  <th className="px-3 py-2 font-semibold text-gray-700">Item</th>
                  <th className="px-3 py-2 font-semibold text-gray-700 text-right">Qty</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-500 italic">
                      No items requested.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-900 dark:text-zinc-100">
                        {l.item_name} <span className="text-gray-500 text-[11px]">({l.uom})</span>
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right font-medium tnum">
                        {parseFloat(l.requested_qty).toString()}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {l.note || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-6 border-t border-gray-200 mt-8">
        {canSubmit && (
          <form action={submitPurchaseRequestAction}>
            <input type="hidden" name="requestId" value={req.id} />
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white text-[13px] font-bold rounded shadow hover:bg-blue-700"
            >
              Submit Request →
            </button>
          </form>
        )}

        {canResolve && (
          <form action={resolvePurchaseRequestAction}>
            <input type="hidden" name="requestId" value={req.id} />
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 text-white text-[13px] font-bold rounded shadow hover:bg-green-700"
            >
              Mark as Resolved ✓
            </button>
          </form>
        )}

        {canCancel && (
          <form action={cancelPurchaseRequestAction}>
            <input type="hidden" name="requestId" value={req.id} />
            <button
              type="submit"
              className="px-4 py-2 bg-white dark:bg-[#1c1c1c] border border-red-300 text-red-600 text-[13px] font-bold rounded hover:bg-red-50"
            >
              Cancel Request
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
