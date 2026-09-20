import { redirect } from 'next/navigation';
import { PageHeader, Card } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { TenantForm } from './TenantForm';
import { DemoDataButton } from './DemoDataButton';

export const dynamic = 'force-dynamic';

export default async function SetupTenantPage() {
  const tenant = await currentTenant();
  if (tenant) redirect('/setup');

  return (
    <>
      <PageHeader
        title="Set up your tenant"
        subtitle="The first thing the app needs - every store, item, and recipe you enter belongs to a tenant."
      />

      <div className="p-8 space-y-6 max-w-2xl">
        <Card title="Create your tenant">
          <TenantForm />
        </Card>

        <Card
          title="Or, load the demo dataset"
          hint="For exploring the UI without hand-entering everything"
        >
          <DemoDataButton />
        </Card>
      </div>
    </>
  );
}
