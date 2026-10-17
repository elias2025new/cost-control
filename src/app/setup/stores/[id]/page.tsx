import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, OnboardingNotice } from '../../../../components/ui';
import { DeleteButton } from '../../../../components/DeleteButton';
import { currentTenant, listStores } from '../../../../lib/queries';
import {
  getStore,
  listBranches,
  listStoreParLevels,
  listAssignableItemsForPar,
} from '../../../../lib/masterData';
import { StoreEditForm } from './StoreEditForm';
import { StoreParLevelsSection } from './StoreParLevelsSection';
import { deleteStore } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SetupStoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Store &amp; Cost Center" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const [store, branches, allStores, parLevels, availableItems] = await Promise.all([
    getStore(id),
    listBranches(),
    listStores(),
    listStoreParLevels(id),
    listAssignableItemsForPar(id),
  ]);

  if (!store) notFound();

  const otherStores = allStores.filter((s) => s.id !== store.id);

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={`${store.code} • ${store.kind.toUpperCase()}${
          store.fulfilling_store_name ? ` • Supplied by ${store.fulfilling_store_name}` : ''
        }`}
        right={
          <Link
            href="/setup/stores"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All stores &amp; cost centers
          </Link>
        }
      />

      <div className="p-8 space-y-8 max-w-4xl">
        {/* Store Profile & Configuration */}
        <Card title="Cost Center &amp; Store Settings">
          <StoreEditForm
            id={store.id}
            code={store.code}
            name={store.name}
            kind={store.kind}
            branchId={store.branch_id}
            description={store.description}
            defaultFulfillingStoreId={store.default_fulfilling_store_id}
            branches={branches}
            otherStores={otherStores}
          />
        </Card>

        {/* Par Stock Management */}
        <Card
          title="Par Stock Inventory Levels"
          hint={`${parLevels.length} item${parLevels.length === 1 ? '' : 's'} managed`}
        >
          <div className="px-5 py-5">
            <StoreParLevelsSection
              storeId={store.id}
              storeName={store.name}
              parLevels={parLevels}
              availableItems={availableItems}
            />
          </div>
        </Card>

        {/* Delete Card */}
        <Card title="Danger Zone" hint="Only possible if nothing has moved through this store yet">
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
