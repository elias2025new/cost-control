import { redirect } from 'next/navigation';
import { currentTenant, currentUser } from '../../lib/queries';
import { db } from '../../lib/server-db';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const tenant = await currentTenant();
  if (!tenant) redirect('/setup/tenant');

  const user = await currentUser();
  if (user) redirect(user.role === 'admin' ? '/' : '/ledger');

  const d = await db();
  const { rows } = await d.query<{ n: string }>(
    `select count(*)::text as n from users where tenant_id = $1`,
    [tenant.id],
  );
  if (rows[0].n === '0') redirect('/setup/admin');

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand-600 font-semibold">
            {tenant.name}
          </div>
          <h1 className="text-[19px] font-semibold text-ink-900 dark:text-zinc-100 mt-1">Sign in</h1>
        </div>
        <div className="rounded-xl border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
