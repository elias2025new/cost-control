import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listStores } from '../../../lib/queries';
import {
  listBranches,
  listCategoryStoreMap,
  listDistinctPosCategories,
} from '../../../lib/masterData';
import { PosStoreMapForm } from './PosStoreMapForm';

export const dynamic = 'force-dynamic';

export default async function SetupPosStoresPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="POS category → store mapping" />
        <OnboardingNotice />
      </>
    );
  }

  const branches = await listBranches();
  if (branches.length === 0) redirect('/setup/branches');
  const stores = await listStores();
  if (stores.length === 0) redirect('/setup/stores');

  const [mappings, categories] = await Promise.all([
    listCategoryStoreMap(),
    listDistinctPosCategories(),
  ]);
  const knownCategories = [...new Set(categories.map((c) => c.pos_category))];

  return (
    <>
      <PageHeader
        title="POS category → store mapping"
        subtitle="The POS export carries no outlet dimension - category is the only proxy for which store a sale depletes from."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="Add a mapping">
          <PosStoreMapForm branches={branches} stores={stores} knownCategories={knownCategories} />
        </Card>

        <Card title="Mappings" hint={`${mappings.length} so far`}>
          {mappings.length === 0 ? (
            <Empty>
              Nothing mapped yet.{' '}
              {categories.length === 0
                ? 'Categories appear here automatically once a sales file has been imported, or you can type one from memory above.'
                : 'Add one above.'}
            </Empty>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Branch
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Depletes from
                  </th>
                  <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-2.5 text-ink-600">{m.branch_name}</td>
                    <td className="px-3 py-2.5 text-ink-800 dark:text-zinc-200">
                      {m.pos_category}
                      {m.pos_sub_category && (
                        <span className="text-ink-400"> / {m.pos_sub_category}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">{m.store_name}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={m.is_assumed ? 'warn' : 'good'}>
                        {m.is_assumed ? 'assumed' : 'confirmed'}
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
