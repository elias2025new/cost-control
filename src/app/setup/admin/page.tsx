import { redirect } from 'next/navigation';
import { currentTenant } from '../../../lib/queries';
import { db } from '../../../lib/server-db';
import { AdminForm } from './AdminForm';

export const dynamic = 'force-dynamic';

export default async function CreateAdminPage() {
  const tenant = await currentTenant();
  if (!tenant) redirect('/setup/tenant');

  const d = await db();
  const { rows } = await d.query<{ n: string }>(
    `select count(*)::text as n from users where tenant_id = $1`,
    [tenant.id],
  );
  if (rows[0].n !== '0') redirect('/login');

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand-600 font-semibold">
            {tenant.name}
          </div>
          <h1 className="text-[19px] font-semibold text-ink-900 dark:text-zinc-100 mt-1">Create your admin account</h1>
          <p className="text-[13px] text-ink-500 mt-1.5">
            The first account on this tenant. You&rsquo;ll add Kitchen, Bar, and Main Store
            accounts afterward.
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] p-6">
          <AdminForm />
        </div>
      </div>
    </div>
  );
}
