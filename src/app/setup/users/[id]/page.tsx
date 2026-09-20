import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, OnboardingNotice } from '../../../../components/ui';
import { currentTenant, currentUser, listStores } from '../../../../lib/queries';
import { getUser } from '../../../../lib/masterData';
import { UserEditForm, ActiveToggle } from './UserEditForm';

export const dynamic = 'force-dynamic';

export default async function SetupUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="User" />
        <OnboardingNotice />
      </>
    );
  }

  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/ledger');

  const { id } = await params;
  const [user, stores] = await Promise.all([getUser(id), listStores()]);
  if (!user) notFound();

  return (
    <>
      <PageHeader
        title={user.display_name}
        subtitle={user.username}
        right={
          <Link
            href="/setup/users"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All users
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <Card title="Edit user">
          <UserEditForm
            id={user.id}
            username={user.username}
            displayName={user.display_name}
            role={user.role}
            storeId={user.store_id}
            permissions={user.permissions || []}
            stores={stores}
          />
        </Card>

        {user.id !== me.uid && (
          <Card title={user.is_active ? 'Deactivate' : 'Reactivate'}>
            <ActiveToggle id={user.id} isActive={user.is_active} />
          </Card>
        )}
      </div>
    </>
  );
}
