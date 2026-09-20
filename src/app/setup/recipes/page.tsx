import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, currentUser } from '../../../lib/queries';
import { listRecipesForAuthoring, listMenuItems } from '../../../lib/masterData';
import { SubRecipeForm } from './SubRecipeForm';
import { MenuRecipeForm } from './MenuRecipeForm';

export const dynamic = 'force-dynamic';

export default async function SetupRecipesPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Recipes" />
        <OnboardingNotice />
      </>
    );
  }

  const user = await currentUser();
  const [recipes, menuItems] = await Promise.all([listRecipesForAuthoring(), listMenuItems()]);

  const recipedMenuItemIds = new Set(
    recipes.filter((r) => r.kind === 'menu').map((r) => r.menu_item_name),
  );
  const availableMenuItems = menuItems.filter((m) => !recipedMenuItemIds.has(m.name));

  const subRecipes = recipes.filter((r) => r.kind === 'sub');
  const menuRecipes = recipes.filter((r) => r.kind === 'menu');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="What goes into each dish. Sub-recipes are costed once over a batch and pulled into other recipes at cost per unit - create those first."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="New sub-recipe" hint="A batch, costed once, reused as an ingredient elsewhere">
          <SubRecipeForm defaultDate={today} />
        </Card>

        <Card title="New menu recipe" hint="One portion of what the menu item sells for">
          {availableMenuItems.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-ink-500">
              Every menu item already has a recipe.{' '}
              {user?.role === 'admin' && (
                <>
                  <Link href="/setup/menu-items" className="text-brand-700 hover:underline">
                    Add another menu item
                  </Link>{' '}
                  first.
                </>
              )}
              {user?.role !== 'admin' && 'Please ask an Administrator to create a new POS Menu Item first.'}
            </div>
          ) : (
            <MenuRecipeForm menuItems={availableMenuItems} defaultDate={today} />
          )}
        </Card>

        <Card title="Sub-recipes" hint={`${subRecipes.length} so far`}>
          {subRecipes.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <RecipeTable recipes={subRecipes} />
          )}
        </Card>

        <Card title="Menu recipes" hint={`${menuRecipes.length} so far`}>
          {menuRecipes.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <RecipeTable recipes={menuRecipes} />
          )}
        </Card>
      </div>
    </>
  );
}

function RecipeTable({
  recipes,
}: {
  recipes: {
    id: string;
    code: string;
    name: string;
    kind: string;
    is_sample: boolean;
    menu_item_name: string | null;
    batch_yield_qty: string | null;
    batch_yield_uom: string | null;
    line_count: string;
  }[];
}) {
  return (
    <table className="w-full text-[13px]">
      <tbody className="divide-y divide-ink-100">
        {recipes.map((r) => (
          <tr key={r.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
            <td className="px-5 py-2.5">
              <Link
                href={`/setup/recipes/${r.id}`}
                className="text-ink-900 dark:text-zinc-100 font-medium hover:text-brand-700"
              >
                {r.name}
              </Link>
              <span className="font-mono text-[11px] text-ink-400 ml-2">{r.code}</span>
              {r.is_sample && (
                <span className="ml-1.5 inline-block align-middle">
                  <Badge tone="sample">Sample</Badge>
                </span>
              )}
            </td>
            <td className="px-3 py-2.5 text-ink-500">
              {r.kind === 'sub'
                ? `yields ${r.batch_yield_qty} ${r.batch_yield_uom}`
                : r.menu_item_name}
            </td>
            <td className="px-5 py-2.5 text-right tnum text-ink-500">
              {r.line_count} line{r.line_count === '1' ? '' : 's'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
