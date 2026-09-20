import Link from 'next/link';
import { PageHeader, Card, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { listBranches } from '../../../lib/masterData';
import { BranchForm } from './BranchForm';

export const dynamic = 'force-dynamic';

export default async function SetupBranchesPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Branches" />
        <OnboardingNotice />
      </>
    );
  }

  const branches = await listBranches();

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="A physical location of the business - stores belong to a branch."
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <Card title="Add a branch">
          <BranchForm />
        </Card>

        <Card title="Branches" hint={`${branches.length} so far`}>
          {branches.length === 0 ? (
            <Empty>No branches yet. Add one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100">
                {branches.map((b) => (
                  <tr key={b.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/setup/branches/${b.id}`}
                        className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
                      >
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ink-400">{b.code}</td>
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
