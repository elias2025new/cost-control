import { redirect } from 'next/navigation';
import { db as getDb } from '../../../lib/server-db';
import { requireTenant, requireUser } from '../../../lib/queries';
import { NewSupplierForm } from './NewSupplierForm';
import { toggleSupplierAction } from './actions';

export default async function SuppliersSetupPage() {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/ledger');

  const tenant   = await requireTenant();
  const database = await getDb();

  const { rows: suppliers } = await database.query<{
    id: string;
    code: string;
    name: string;
    contact: string | null;
    is_active: boolean;
    purchase_count: string;
  }>(
    `select s.id, s.code, s.name, s.contact, s.is_active,
            count(p.id)::text as purchase_count
       from suppliers s
       left join purchases p on p.supplier_id = s.id
      where s.tenant_id = $1
      group by s.id
      order by s.name`,
    [tenant.id],
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Suppliers</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Master list of approved suppliers. Only Admins can add or deactivate.
          </p>
        </div>
        <NewSupplierForm />
      </div>

      <div className="border border-gray-400 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-gray-200 border-b border-gray-400 dark:border-zinc-700">
            <tr>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Code</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Supplier Name</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Contact</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200 text-right">Purchases</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200 text-center">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500 italic">
                  No suppliers yet. Click &quot;+ New Supplier&quot; to add the first one.
                </td>
              </tr>
            )}
            {suppliers.map((s) => (
              <tr key={s.id} className={`hover:bg-gray-50 ${!s.is_active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-mono text-[12px] text-gray-600">{s.code}</td>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-zinc-100">{s.name}</td>
                <td className="px-3 py-2 text-gray-600">{s.contact || '—'}</td>
                <td className="px-3 py-2 text-right tnum text-gray-900 dark:text-zinc-100">{s.purchase_count}</td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${
                      s.is_active
                        ? 'bg-green-100 text-green-800 border-green-300'
                        : 'bg-gray-100 text-gray-600 border-gray-300 dark:border-zinc-700'
                    }`}
                  >
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={toggleSupplierAction}>
                    <input type="hidden" name="supplierId" value={s.id} />
                    <input type="hidden" name="isActive" value={String(s.is_active)} />
                    <button
                      type="submit"
                      className="text-[12px] text-gray-500 hover:text-red-600 hover:underline"
                    >
                      {s.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
