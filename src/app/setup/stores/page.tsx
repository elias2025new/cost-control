import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listStores } from '../../../lib/queries';
import { listBranches } from '../../../lib/masterData';
import { StoreForm } from './StoreForm';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  main: 'Main store',
  kitchen: 'Kitchen',
  bar: 'Bar',
};

export default async function SetupStoresPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Stores" />
        <OnboardingNotice />
      </>
    );
  }

  const branches = await listBranches();
  if (branches.length === 0) redirect('/setup/branches');

  const stores = await listStores();

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="Anywhere stock physically sits - the main store, a kitchen, a bar."
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <Card title="Add a store">
          <StoreForm branches={branches} />
        </Card>

        <Card title="Stores" hint={`${stores.length} so far`}>
          {stores.length === 0 ? (
            <Empty>No stores yet. Add one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100">
                {stores.map((s) => (
                  <tr key={s.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/setup/stores/${s.id}`}
                        className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral">{KIND_LABEL[s.kind] ?? s.kind}</Badge>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ink-400">{s.code}</td>
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
