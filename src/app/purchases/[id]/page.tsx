import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db as getDb } from '../../../lib/server-db';
import { requireTenant, requireUser } from '../../../lib/queries';
import { PurchaseLinesEditor } from './PurchaseLinesEditor';
import { postPurchaseAction, deletePurchaseAction, reversePurchaseAction } from '../actions';
import { PrintButton } from './PrintButton';
import { ReverseButton } from './ReverseButton';

export default async function PurchaseDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const tenant = await requireTenant();
  const user = await requireUser();
  const db = await getDb();

  try {
    const { rows: purchases } = await db.query<{
      id: string;
      store_id: string;
      store_name: string;
      supplier_name: string;
      reference_number: string | null;
      status: string;
      occurred_on: string;
      created_by: string;
    }>(
      `select p.id,
              p.store_id,
              s.name as store_name,
              sup.name as supplier_name,
              p.reference_number,
              p.status,
              p.occurred_on::text as occurred_on,
              p.created_by
         from purchases p
         join stores s on s.id = p.store_id
         join suppliers sup on sup.id = p.supplier_id
        where p.id = $1 and p.tenant_id = $2`,
      [params.id, tenant.id],
    );

    if (purchases.length === 0) {
      notFound();
    }
    const p = purchases[0];

    // Auth check
    if (user.role !== 'admin' && user.storeId !== p.store_id) {
      return (
        <div className="p-6 max-w-4xl mx-auto">
          <div className="bg-red-50 text-red-700 p-4 rounded border border-red-200">
            You do not have access to view purchases for this store.
          </div>
        </div>
      );
    }

    const { rows: lines } = await db.query<{
      item_id: string;
      item_name: string;
      uom: string;
      qty: string;
      unit_cost: string;
    }>(
      `select l.item_id,
              i.name as item_name,
              i.uom,
              l.qty::text as qty,
              l.unit_cost::text as unit_cost
         from purchase_lines l
         join items i on i.id = l.item_id
        where l.purchase_id = $1 and l.tenant_id = $2
        order by i.name`,
      [p.id, tenant.id],
    );

    const { rows: items } = await db.query<{
      id: string;
      name: string;
      uom: string;
    }>(
      `select i.id, i.name, i.uom
         from items i
         join item_categories c on c.id = i.category_id
        where i.tenant_id = $1
          -- Exclude recipe kinds or limit by compat if necessary
          and c.kind in ('food', 'beverage', 'consumable')
        order by i.name`,
      [tenant.id],
    );

    const isDraft = p.status === 'draft';
    const totalValue = lines.reduce(
      (acc, l) => acc + parseFloat(l.qty) * parseFloat(l.unit_cost),
      0,
    );

    return (
      <div className="p-6 max-w-4xl mx-auto pb-24">
        <div className="mb-4">
          <Link href="/purchases" className="text-[13px] text-gray-500 hover:text-gray-900 dark:text-zinc-100">
            ← Back to Purchase Register
          </Link>
        </div>

        <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded shadow-sm p-6 mb-6 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Purchase Receipt</h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                  isDraft
                    ? 'bg-amber-100 text-amber-800'
                    : p.status === 'reversed'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800'
                }`}
              >
                {p.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 mt-4 text-[13px]">
              <div>
                <span className="text-gray-500 inline-block w-24">Store:</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{p.store_name}</span>
              </div>
              <div>
                <span className="text-gray-500 inline-block w-24">Date:</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{p.occurred_on}</span>
              </div>
              <div>
                <span className="text-gray-500 inline-block w-24">Supplier:</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{p.supplier_name}</span>
              </div>
              <div>
                <span className="text-gray-500 inline-block w-24">Ref / Invoice:</span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">{p.reference_number || '—'}</span>
              </div>
            </div>
          </div>

          {isDraft ? (
            <div className="flex gap-2">
              <form action={deletePurchaseAction}>
                <input type="hidden" name="purchaseId" value={p.id} />
                <button
                  type="submit"
                  className="px-6 py-3 bg-red-600 text-white font-bold rounded shadow hover:bg-red-700 transition-colors"
                >
                  Delete Draft
                </button>
              </form>
              {lines.length > 0 && (
                <form action={postPurchaseAction}>
                  <input type="hidden" name="purchaseId" value={p.id} />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-green-600 text-white font-bold rounded shadow hover:bg-green-700 transition-colors"
                  >
                    Post to Ledger →
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <PrintButton />
              {p.status === 'posted' && (
                <form action={reversePurchaseAction}>
                  <input type="hidden" name="purchaseId" value={p.id} />
                  <ReverseButton />
                </form>
              )}
            </div>
          )}
        </div>

        {isDraft ? (
          <PurchaseLinesEditor
            purchaseId={p.id}
            initialLines={lines.map((l) => ({
              itemId: l.item_id,
              qty: l.qty,
              unitCost: l.unit_cost,
            }))}
            items={items}
          />
        ) : (
          <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-[14px] font-bold text-gray-900 dark:text-zinc-100">Items Received</h2>
            </div>
            <table className="w-full text-left text-[13px]">
              <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
                <tr>
                  <th className="px-3 py-2 font-semibold text-gray-700">Item</th>
                  <th className="px-3 py-2 font-semibold text-gray-700 text-right">Qty</th>
                  <th className="px-3 py-2 font-semibold text-gray-700 text-right">Unit Cost</th>
                  <th className="px-3 py-2 font-semibold text-gray-700 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lines.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 font-medium">{l.item_name}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right">
                      {Number(l.qty).toFixed(2)} <span className="text-gray-500 ml-1">{l.uom}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right">
                      {Number(l.unit_cost).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right font-medium">
                      {(parseFloat(l.qty) * parseFloat(l.unit_cost)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-300 dark:border-zinc-700">
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-right font-bold text-gray-700">
                    Total Receipt Value:
                  </td>
                  <td className="px-3 py-3 text-right font-bold text-gray-900 dark:text-zinc-100 text-[15px]">
                    {totalValue.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  } catch (err) {
    console.error(err);
    throw err;
  }
}
