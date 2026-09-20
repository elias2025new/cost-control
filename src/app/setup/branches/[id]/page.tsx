import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, OnboardingNotice } from '../../../../components/ui';
import { DeleteButton } from '../../../../components/DeleteButton';
import { currentTenant } from '../../../../lib/queries';
import { getBranch } from '../../../../lib/masterData';
import { BranchEditForm } from './BranchEditForm';
import { deleteBranch } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SetupBranchDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Branch" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const branch = await getBranch(id);
  if (!branch) notFound();

  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle={branch.code}
        right={
          <Link
            href="/setup/branches"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All branches
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-2xl">
        <Card title="Edit branch">
          <BranchEditForm id={branch.id} code={branch.code} name={branch.name} />
        </Card>

        <Card title="Delete branch" hint="Only possible if nothing else references it yet">
          <div className="px-5 py-5">
            <DeleteButton
              action={deleteBranch}
              id={branch.id}
              label="Delete this branch"
              confirmText={`Delete "${branch.name}"? This cannot be undone.`}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
