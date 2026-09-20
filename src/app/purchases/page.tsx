import Link from 'next/link';
import { db as getDb } from '../../lib/server-db';
import { requireTenant, requireUser } from '../../lib/queries';
import { NewPurchaseForm } from './NewPurchaseForm';

export default async function PurchasesPage() {
  const tenant = await requireTenant();
  const user = await requireUser();
  const db = await getDb();

  try {
  const { rows: stores } = await db.query<{ id: string; name: string }>(
    `select id, name from stores where tenant_id = $1 and is_active and kind = 'main' order by name`,
    [tenant.id],
  );

  const { rows: suppliers } = await db.query<{ id: string; name: string }>(
    `select id, name from suppliers where tenant_id = $1 and is_active order by name`,
    [tenant.id],
  );

    // Store users only see their own store's purchases; admins see all.
    let filter = `tenant_id = $1`;
    const params: unknown[] = [tenant.id];
    if (user.role !== 'admin' && user.storeId) {
      filter += ` and p.store_id = $2`;
      params.push(user.storeId);
    }

    const { rows: purchases } = await db.query<{
    id: string;
      supplier_name: string;
      reference_number: string | null;
      store_name: string;
      status: string;
      occurred_on: string;
      created_by: string;
      lines_count: string;
      total_value: string | null;
    }>(
      `select p.id,
              sup.name as supplier_name,
              p.reference_number,
              s.name as store_name,
              p.status,
              p.occurred_on::text as occurred_on,
              p.created_by,
              count(l.id)::text as lines_count,
              sum(l.qty * l.unit_cost)::text as total_value
         from purchases p
         join stores s on s.id = p.store_id
         join suppliers sup on sup.id = p.supplier_id
         left join purchase_lines l on l.purchase_id = p.id
        where p.${filter}
        group by p.id, s.name, sup.name
        order by p.occurred_on desc, p.created_at desc`,
      params,
    );

    // If store user, they can only create purchases for their own store.
    const formStores =
      user.role === 'admin' ? stores : stores.filter((s) => s.id === user.storeId);

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Purchase Register</h1>
          {formStores.length > 0 && <NewPurchaseForm stores={formStores} suppliers={suppliers} />}
        </div>

        <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold text-gray-700">Date</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Status</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Store</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Supplier</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Ref / Invoice</th>
                <th className="px-3 py-2 font-semibold text-gray-700 text-right">Items</th>
                <th className="px-3 py-2 font-semibold text-gray-700 text-right">Total</th>
                <th className="px-3 py-2 font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-500 italic">
                    No purchases recorded yet.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 whitespace-nowrap">
                      {p.occurred_on}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                          p.status === 'draft'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 font-medium">{p.store_name}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100">{p.supplier_name}</td>
                    <td className="px-3 py-2 text-gray-500">{p.reference_number || '—'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right">{p.lines_count}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 text-right font-medium">
                      {p.total_value ? Number(p.total_value).toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/purchases/${p.id}`}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {p.status === 'draft' ? 'Edit & Post →' : 'View →'}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch (err) {
    console.error(err);
    throw err;
  }
}
