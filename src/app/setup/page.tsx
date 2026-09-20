import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge } from '../../components/ui';
import { currentTenant, currentUser, listStores, overviewStats } from '../../lib/queries';
import {
  listBranches,
  listCategories,
  listItems,
  listMenuItems,
  listCategoryStoreMap,
  listUsers,
  listSuppliers,
} from '../../lib/masterData';

export const dynamic = 'force-dynamic';

export default async function SetupIndexPage() {
  const tenant = await currentTenant();
  if (!tenant) redirect('/setup/tenant');

  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/ledger');

  const [branches, stores, categories, items, menuItems, stats, categoryStoreMap, users, suppliers] =
    await Promise.all([
      listBranches(),
      listStores(),
      listCategories(),
      listItems(),
      listMenuItems(),
      overviewStats(),
      listCategoryStoreMap(),
      listUsers(),
      listSuppliers(),
    ]);

  const steps: {
    href: string;
    label: string;
    count: number | null;
    total?: number;
    note: string;
  }[] = [
    {
      href: '/setup/users',
      label: 'Users',
      count: users.length,
      note: 'Who can sign in, and what they can see',
    },
    {
      href: '/setup/branches',
      label: 'Branches',
      count: branches.length,
      note: 'A physical location of the business',
    },
    {
      href: '/setup/stores',
      label: 'Stores',
      count: stores.length,
      note: 'Main store, kitchen, bar',
    },
    {
      href: '/setup/suppliers',
      label: 'Suppliers',
      count: suppliers.length,
      note: 'Approved vendors — only admins can add',
    },
    {
      href: '/setup/categories',
      label: 'Item categories',
      count: categories.length,
      note: 'Food, beverage, other',
    },
    {
      href: '/setup/items',
      label: 'Items',
      count: items.length,
      note: 'Raw materials, each with a versioned cost',
    },
    {
      href: '/setup/opening-stock',
      label: 'Opening stock',
      count: Number(stats.movements),
      note: 'Stock movements posted so far',
    },
    {
      href: '/setup/menu-items',
      label: 'Menu items',
      count: menuItems.length,
      note: 'What the POS sells',
    },
    {
      href: '/setup/recipes',
      label: 'Recipes',
      count: Number(stats.recipes) + Number(stats.sub_recipes),
      note: `${stats.recipes} menu, ${stats.sub_recipes} sub-recipe`,
    },
    {
      href: '/setup/pos-map',
      label: 'POS article mapping',
      count: Number(stats.mapped),
      total: Number(stats.articles),
      note: 'Which article is which menu item',
    },
    {
      href: '/setup/pos-stores',
      label: 'POS category → store mapping',
      count: categoryStoreMap.filter((m) => !m.is_assumed).length,
      total: categoryStoreMap.length || undefined,
      note: 'Which category depletes which store',
    },
  ];

  return (
    <>
      <PageHeader
        title="Setup"
        subtitle={`${tenant.name} · build up master data in this order - each step unblocks the next.`}
      />

      <div className="p-8 max-w-3xl">
        <Card>
          <ul className="divide-y divide-ink-100">
            {steps.map((s) => {
              const done = s.count === null ? null : s.count > 0;
              return (
                <li key={s.href}>
                  <Link
                    href={s.href}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-ink-50 dark:bg-[#111111]/60"
                  >
                    <div>
                      <div className="text-[13.5px] font-medium text-ink-900 dark:text-zinc-100">{s.label}</div>
                      <div className="text-[12px] text-ink-500 mt-0.5">{s.note}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.count !== null && (
                        <span className="text-[12.5px] tnum text-ink-600">
                          {s.count}
                          {s.total !== undefined ? ` / ${s.total}` : ''}
                        </span>
                      )}
                      <Badge tone={done ? 'good' : 'neutral'}>{done ? 'started' : 'empty'}</Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
