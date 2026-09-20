import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, OnboardingNotice } from '../../../../components/ui';
import { DeleteButton } from '../../../../components/DeleteButton';
import { currentTenant } from '../../../../lib/queries';
import { getCategory } from '../../../../lib/masterData';
import { CategoryEditForm } from './CategoryEditForm';
import { deleteCategory } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SetupCategoryDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Item category" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const category = await getCategory(id);
  if (!category) notFound();

  return (
    <>
      <PageHeader
        title={category.name}
        subtitle={category.code}
        right={
          <Link
            href="/setup/categories"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All categories
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-2xl">
        <Card title="Edit category">
          <CategoryEditForm
            id={category.id}
            code={category.code}
            name={category.name}
            kind={category.kind}
          />
        </Card>

        <Card title="Delete category" hint="Only possible if no items use it yet">
          <div className="px-5 py-5">
            <DeleteButton
              action={deleteCategory}
              id={category.id}
              label="Delete this category"
              confirmText={`Delete "${category.name}"? This cannot be undone.`}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
