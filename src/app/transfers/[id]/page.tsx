import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db as getDb } from '../../../lib/server-db';
import { requireTenant, requireUser } from '../../../lib/queries';
import { TransferLinesEditor } from './TransferLinesEditor';
import { postTransferAction, deleteTransferAction } from '../actions';
import { PrintButton } from '../../purchases/[id]/PrintButton';

export default async function TransferDetailPage(props: { params: Promise<{ id: string }> }) {
  const params   = await props.params;
  const tenant   = await requireTenant();
  const user     = await requireUser();
  const database = await getDb();

  const { rows: transfers } = await database.query<{
    id: string;
    from_store_id: string;
    from_store: string;
    to_store_id: string;
    to_store: string;
    status: string;
    occurred_on: string;
    note: string | null;
  }>(
    `select t.id,
            t.from_store_id,
            fs.name as from_store,
            t.to_store_id,
            ts.name as to_store,
            t.status,
            t.occurred_on::text as occurred_on,
            t.note
       from transfers t
       join stores fs on fs.id = t.from_store_id
       join stores ts on ts.id = t.to_store_id
      where t.id = $1 and t.tenant_id = $2`,
    [params.id, tenant.id],
  );

  if (!transfers.length) notFound();
  const t = transfers[0];

  // Store user can only view transfers involving their store
  if (user.role !== 'admin' && user.storeId !== t.from_store_id && user.storeId !== t.to_store_id) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 text-red-700 p-4 border border-red-200">
          You do not have access to this transfer.
        </div>
      </div>
    );
  }

  const { rows: lines } = await database.query<{
    item_id: string;
    item_name: string;
    uom: string;
    qty: string;
  }>(
    `select l.item_id,
            i.name as item_name,
            i.uom,
            l.qty::text as qty
       from transfer_lines l
       join items i on i.id = l.item_id
      where l.transfer_id = $1 and l.tenant_id = $2
      order by i.name`,
    [t.id, tenant.id],
  );

  const { rows: items } = await database.query<{ id: string; name: string; uom: string }>(
    `select i.id, i.name, i.uom
       from items i
       join item_categories c on c.id = i.category_id
      where i.tenant_id = $1
        and c.kind in ('food', 'beverage', 'consumable')
      order by i.name`,
    [tenant.id],
  );

  const isDraft = t.status === 'draft';

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
      <div className="mb-4">
        <Link href="/transfers" className="text-[13px] text-gray-500 hover:text-gray-900 dark:text-zinc-100">
          ← Back to Transfer Register
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white dark:bg-[#1c1c1c] border border-gray-400 dark:border-zinc-700 p-5 mb-5 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Stock Transfer</h1>
            <span
              className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${
                isDraft
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-green-100 text-green-800 border-green-300'
              }`}
            >
              {t.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px]">
            <div>
              <span className="text-gray-500 inline-block w-28">From Store:</span>
              <span className="font-semibold text-gray-900 dark:text-zinc-100">{t.from_store}</span>
            </div>
            <div>
              <span className="text-gray-500 inline-block w-28">Date:</span>
              <span className="font-semibold text-gray-900 dark:text-zinc-100">{t.occurred_on}</span>
            </div>
            <div>
              <span className="text-gray-500 inline-block w-28">To Store:</span>
              <span className="font-semibold text-gray-900 dark:text-zinc-100">{t.to_store}</span>
            </div>
            {t.note && (
              <div>
                <span className="text-gray-500 inline-block w-28">Note:</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{t.note}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {isDraft ? (
          <div className="flex gap-2">
            <form action={deleteTransferAction}>
              <input type="hidden" name="transferId" value={t.id} />
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 text-white font-bold text-[13px] border border-red-700 hover:bg-red-700"
              >
                Delete Draft
              </button>
            </form>
            {lines.length > 0 && (
              <form action={postTransferAction}>
                <input type="hidden" name="transferId" value={t.id} />
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white font-bold text-[13px] border border-green-700 hover:bg-green-700"
                >
                  Post to Ledger →
                </button>
              </form>
            )}
          </div>
        ) : (
          <PrintButton />
        )}
      </div>

      {/* Lines section */}
      {isDraft ? (
        <TransferLinesEditor
          transferId={t.id}
          initialLines={lines.map((l) => ({ itemId: l.item_id, qty: l.qty }))}
          items={items}
        />
      ) : (
        <div className="border border-gray-400 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] overflow-hidden">
          <div className="p-3 border-b border-gray-300 dark:border-zinc-700 bg-gray-100">
            <h2 className="text-[13px] font-bold text-gray-900 dark:text-zinc-100">Items Transferred</h2>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold text-gray-700">Item</th>
                <th className="px-3 py-2 font-semibold text-gray-700 text-right">Qty</th>
                <th className="px-3 py-2 font-semibold text-gray-700">UOM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lines.map((l, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 font-medium">{l.item_name}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right tnum">{Number(l.qty).toFixed(3)}</td>
                  <td className="px-3 py-2 text-gray-500">{l.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
