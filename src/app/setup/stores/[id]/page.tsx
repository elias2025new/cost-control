import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, OnboardingNotice } from '../../../../components/ui';
import { DeleteButton } from '../../../../components/DeleteButton';
import { currentTenant } from '../../../../lib/queries';
import { getStore, listBranches } from '../../../../lib/masterData';
import { StoreEditForm } from './StoreEditForm';
import { deleteStore } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SetupStoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Store" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const [store, branches] = await Promise.all([getStore(id), listBranches()]);
  if (!store) notFound();

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={store.code}
        right={
          <Link
            href="/setup/stores"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All stores
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-2xl">
        <Card title="Edit store">
          <StoreEditForm
            id={store.id}
            code={store.code}
            name={store.name}
            kind={store.kind}
            branchId={store.branch_id}
            branches={branches}
          />
        </Card>

        <Card title="Delete store" hint="Only possible if nothing has moved through it yet">
          <div className="px-5 py-5">
            <DeleteButton
              action={deleteStore}
              id={store.id}
              label="Delete this store"
              confirmText={`Delete "${store.name}"? This cannot be undone.`}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
