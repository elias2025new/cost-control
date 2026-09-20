import Link from 'next/link';
import { db as getDb } from '../../lib/server-db';
import { requireTenant, requireUser } from '../../lib/queries';
import { NewTransferForm } from './NewTransferForm';

export default async function TransfersPage() {
  const tenant = await requireTenant();
  const user   = await requireUser();
  const database = await getDb();

  const { rows: stores } = await database.query<{ id: string; name: string; code: string }>(
    `select id, name, code from stores where tenant_id = $1 order by name`,
    [tenant.id],
  );

  const storeFilter = user.role === 'admin'
    ? `(t.from_store_id = ANY($2::uuid[]) or t.to_store_id = ANY($2::uuid[]))`
    : `(t.from_store_id = $3::uuid or t.to_store_id = $3::uuid)`;

  const { rows: transfers } = user.role === 'admin'
    ? await database.query<{
        id: string;
        from_store: string;
        to_store: string;
        status: string;
        occurred_on: string;
        note: string | null;
        line_count: string;
      }>(
        `select t.id,
                fs.name as from_store,
                ts.name as to_store,
                t.status,
                t.occurred_on::text as occurred_on,
                t.note,
                count(tl.id)::text as line_count
           from transfers t
           join stores fs on fs.id = t.from_store_id
           join stores ts on ts.id = t.to_store_id
           left join transfer_lines tl on tl.transfer_id = t.id
          where t.tenant_id = $1
          group by t.id, fs.name, ts.name, t.status, t.occurred_on, t.note
          order by t.occurred_on desc, t.created_at desc`,
        [tenant.id],
      )
    : await database.query<{
        id: string;
        from_store: string;
        to_store: string;
        status: string;
        occurred_on: string;
        note: string | null;
        line_count: string;
      }>(
        `select t.id,
                fs.name as from_store,
                ts.name as to_store,
                t.status,
                t.occurred_on::text as occurred_on,
                t.note,
                count(tl.id)::text as line_count
           from transfers t
           join stores fs on fs.id = t.from_store_id
           join stores ts on ts.id = t.to_store_id
           left join transfer_lines tl on tl.transfer_id = t.id
          where t.tenant_id = $1
            and (t.from_store_id = $2::uuid or t.to_store_id = $2::uuid)
          group by t.id, fs.name, ts.name, t.status, t.occurred_on, t.note
          order by t.occurred_on desc, t.created_at desc`,
        [tenant.id, user.storeId],
      );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Transfer Register</h1>
        <NewTransferForm stores={stores} />
      </div>

      <div className="border border-gray-400 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-gray-200 border-b border-gray-400 dark:border-zinc-700">
            <tr>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Date</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Status</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">From Store</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">To Store</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200">Note</th>
              <th className="px-3 py-2 font-semibold text-gray-800 dark:text-zinc-200 text-right">Items</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {transfers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500 italic">
                  No transfers yet. Click &quot;+ New Transfer&quot; to create one.
                </td>
              </tr>
            )}
            {transfers.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2 text-gray-900 dark:text-zinc-100 whitespace-nowrap">{t.occurred_on}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${
                      t.status === 'draft'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-green-100 text-green-800 border-green-300'
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-zinc-100">{t.from_store}</td>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-zinc-100">{t.to_store}</td>
                <td className="px-3 py-2 text-gray-600 italic">{t.note || '—'}</td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-zinc-100 tnum">{t.line_count}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/transfers/${t.id}`}
                    className="text-brand-600 hover:text-brand-700 hover:underline text-[12px] font-medium"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
