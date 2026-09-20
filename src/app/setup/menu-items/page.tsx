import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant } from '../../../lib/queries';
import { listMenuItems } from '../../../lib/masterData';
import { MenuItemForm } from './MenuItemForm';

export const dynamic = 'force-dynamic';

const KIND_TONE: Record<string, 'warn' | 'neutral'> = {
  food: 'warn',
  beverage: 'neutral',
  other: 'neutral',
};

export default async function SetupMenuItemsPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Menu items" />
        <OnboardingNotice />
      </>
    );
  }

  const menuItems = await listMenuItems();

  return (
    <>
      <PageHeader
        title="Menu items"
        subtitle="What the POS sells. Recipes attach to these - map a POS article to one on the next screen."
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <Card title="Add a menu item">
          <MenuItemForm />
        </Card>

        <Card title="Menu items" hint={`${menuItems.length} so far`}>
          {menuItems.length === 0 ? (
            <Empty>No menu items yet. Add one above.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-ink-100">
                {menuItems.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-2.5 text-ink-800 dark:text-zinc-200">{m.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={KIND_TONE[m.kind] ?? 'neutral'}>{m.kind}</Badge>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ink-400">{m.code}</td>
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
