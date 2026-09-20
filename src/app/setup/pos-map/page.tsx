import Link from 'next/link';
import { PageHeader, Card, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { listPosArticleMap, listMenuItems } from '../../../lib/masterData';
import { ArticleMapTable } from './ArticleMapTable';

export const dynamic = 'force-dynamic';

export default async function SetupPosMapPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="POS article mapping" />
        <OnboardingNotice />
      </>
    );
  }

  const sp = await searchParams;
  const filter = sp.filter === 'unmapped' ? 'unmapped' : 'all';
  const [rows, menuItems] = await Promise.all([listPosArticleMap(filter), listMenuItems()]);

  return (
    <>
      <PageHeader
        title="POS article mapping"
        subtitle="Which menu item each article on the till actually is. Rows appear here automatically the first time a sales file mentions them - nothing to add by hand."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <div className="flex gap-1.5">
          <Link
            href="/setup/pos-map"
            className={[
              'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
              filter === 'all'
                ? 'border-ink-900 bg-ink-900 text-white font-medium'
                : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-600 hover:border-ink-300',
            ].join(' ')}
          >
            All articles
          </Link>
          <Link
            href="/setup/pos-map?filter=unmapped"
            className={[
              'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
              filter === 'unmapped'
                ? 'border-ink-900 bg-ink-900 text-white font-medium'
                : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-600 hover:border-ink-300',
            ].join(' ')}
          >
            Unmapped only
          </Link>
        </div>

        <Card title="Articles" hint={`${rows.length} shown`}>
          {rows.length === 0 ? (
            <Empty>
              {filter === 'unmapped'
                ? 'Nothing unmapped.'
                : 'No articles yet - import a sales file first.'}
            </Empty>
          ) : (
            <ArticleMapTable rows={rows} menuItems={menuItems} />
          )}
        </Card>
      </div>
    </>
  );
}
