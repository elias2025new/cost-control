import Link from 'next/link';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { listCategories } from '../../../lib/masterData';
import { CategoryForm } from './CategoryForm';

export const dynamic = 'force-dynamic';

const KIND_TONE: Record<string, 'warn' | 'neutral'> = {
  food: 'warn',
  beverage: 'neutral',
  other: 'neutral',
};

export default async function SetupCategoriesPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Item categories" />
        <OnboardingNotice />
      </>
    );
  }

  const categories = await listCategories();

  return (
    <>
      <PageHeader
        title="Item categories"
        subtitle="Food, beverage, and other - items belong to one. This is what keeps food and beverage cost reported separately."
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <Card title="Add a category">
          <CategoryForm />
        </Card>

        <Card title="Categories" hint={`${categories.length} so far`}>
          {categories.length === 0 ? (
            <Empty>No categories yet. Add one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/setup/categories/${c.id}`}
                        className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={KIND_TONE[c.kind] ?? 'neutral'}>{c.kind}</Badge>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ink-400">{c.code}</td>
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
