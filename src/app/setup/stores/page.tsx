import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listStores } from '../../../lib/queries';
import { listBranches } from '../../../lib/masterData';
import { StoreForm } from './StoreForm';

export const dynamic = 'force-dynamic';

const KIND_META: Record<
  string,
  { label: string; icon: string; tone: 'brand' | 'accent' | 'warning' | 'neutral' }
> = {
  main: { label: 'Main Warehouse', icon: '📦', tone: 'brand' },
  kitchen: { label: 'Kitchen Cost Center', icon: '🍳', tone: 'accent' },
  bar: { label: 'Bar Cost Center', icon: '🍸', tone: 'warning' },
  cellar: { label: 'Wine & Cellar', icon: '🍷', tone: 'brand' },
  prep: { label: 'Prep Station', icon: '🔪', tone: 'accent' },
  outlet: { label: 'Service Outlet', icon: '🛎️', tone: 'neutral' },
};

export default async function SetupStoresPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Stores &amp; Cost Centers" />
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
        title="Stores &amp; Cost Centers"
        subtitle="Configure physical storerooms, kitchen/bar outlets, supply routes, and par stock levels."
      />

      <div className="p-8 space-y-8 max-w-5xl">
        <Card title="Add a Store or Cost Center">
          <StoreForm branches={branches} existingStores={stores} />
        </Card>

        <Card
          title="Configured Stores &amp; Outlets"
          hint={`${stores.length} location${stores.length === 1 ? '' : 's'}`}
        >
          {stores.length === 0 ? (
            <Empty>No stores yet. Add one above.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-ink-100 dark:border-zinc-800 text-left text-[11px] uppercase tracking-wider text-ink-400 bg-ink-50/50 dark:bg-zinc-800/40">
                    <th className="px-5 py-3 font-semibold">Store / Outlet</th>
                    <th className="px-3 py-3 font-semibold">Cost Center Role</th>
                    <th className="px-3 py-3 font-semibold">Supply Source (MC Requisition)</th>
                    <th className="px-3 py-3 font-semibold text-center">Par Stock Items</th>
                    <th className="px-5 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                  {stores.map((s) => {
                    const meta = KIND_META[s.kind] ?? {
                      label: s.kind,
                      icon: '📍',
                      tone: 'neutral' as const,
                    };
                    const parCount = Number(s.par_items_count ?? 0);
                    return (
                      <tr key={s.id} className="hover:bg-ink-50/80 dark:hover:bg-zinc-800/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col">
                            <Link
                              href={`/setup/stores/${s.id}`}
                              className="text-ink-900 dark:text-zinc-100 font-semibold hover:text-brand-700 dark:hover:text-brand-400 text-[14px]"
                            >
                              {s.name}
                            </Link>
                            <span className="font-mono text-[11px] text-ink-400 mt-0.5">
                              CODE: {s.code}
                            </span>
                            {s.description && (
                              <span className="text-[11.5px] text-ink-500 italic mt-0.5">
                                {s.description}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-ink-100 dark:bg-zinc-800 text-ink-700 dark:text-zinc-300">
                            <span>{meta.icon}</span>
                            <span>{meta.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-ink-600 dark:text-zinc-400">
                          {s.fulfilling_store_name ? (
                            <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-700 dark:text-brand-400">
                              <span>⤷</span> {s.fulfilling_store_name}
                            </span>
                          ) : (
                            <span className="text-ink-400 text-[12px] italic">
                              Direct / Self-contained
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11.5px] font-mono font-medium ${
                              parCount > 0
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-ink-100 dark:bg-zinc-800 text-ink-400'
                            }`}
                          >
                            {parCount} {parCount === 1 ? 'item' : 'items'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <Link
                            href={`/setup/stores/${s.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-ink-700 dark:text-zinc-200 hover:bg-ink-100 dark:hover:bg-zinc-700 transition-colors shadow-2xs"
                          >
                            ⚙️ Configure &amp; Par Levels
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
