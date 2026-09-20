import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, currentUser, listStores } from '../../../lib/queries';
import { listUsers } from '../../../lib/masterData';
import { UserForm } from './UserForm';

export const dynamic = 'force-dynamic';

export default async function SetupUsersPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Users" />
        <OnboardingNotice />
      </>
    );
  }

  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/ledger');

  // No redirect when there are no stores yet: an admin account has no store
  // at all, so requiring one first would make the first accounts
  // uncreatable. The form disables the store-user role instead.
  const [stores, users] = await Promise.all([listStores(), listUsers()]);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Who can sign in, and what they can see. A store user only sees their own store."
      />

      <div className="p-8 space-y-6 max-w-4xl">
        <Card title="Add a user">
          <UserForm stores={stores} />
        </Card>

        <Card title="Users" hint={`${users.length} account${users.length === 1 ? '' : 's'}`}>
          {users.length === 0 ? (
            <Empty>No users yet.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Store
                  </th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/setup/users/${u.id}`}
                        className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
                      >
                        {u.display_name}
                      </Link>
                      {u.id === me.uid && (
                        <span className="ml-1.5 text-[11px] text-ink-400">(you)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-500">{u.username}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={u.role === 'admin' ? 'good' : 'neutral'}>
                        {u.role === 'admin' ? 'Administrator' : 'Store user'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink-600">{u.store_name ?? '-'}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={u.is_active ? 'good' : 'neutral'}>
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
