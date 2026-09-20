import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, OnboardingNotice } from '../../../../components/ui';
import { currentTenant } from '../../../../lib/queries';
import { getRecipeForAuthoring, listItems, listRecipesForAuthoring } from '../../../../lib/masterData';
import { RecipeLinesEditor } from './RecipeLinesEditor';

export const dynamic = 'force-dynamic';

export default async function SetupRecipeDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Recipe" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const [recipe, items, allRecipes] = await Promise.all([
    getRecipeForAuthoring(id),
    listItems(),
    listRecipesForAuthoring(),
  ]);
  if (!recipe) notFound();

  const subRecipes = allRecipes
    .filter((r) => r.kind === 'sub' && r.id !== recipe.id)
    .map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <PageHeader
        title={recipe.name}
        subtitle={
          <>
            {recipe.code} ·{' '}
            {recipe.kind === 'sub'
              ? `yields ${recipe.batch_yield_qty} ${recipe.batch_yield_uom} per batch`
              : `1 portion of ${recipe.menu_item_name}`}
            {' · version '}
            {recipe.version_no} from {recipe.effective_from}
          </>
        }
        right={
          <Link
            href="/setup/recipes"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All recipes
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-4xl">
        {recipe.is_sample && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-[12.5px] text-violet-900">
            This recipe was loaded from the demo dataset - its ingredients and quantities are a
            sample, not real figures.
          </div>
        )}

        <Card
          title="Ingredients"
          hint={
            items.length === 0 && subRecipes.length === 0
              ? 'No items or sub-recipes exist yet to choose from'
              : 'Item or sub-recipe, and how much of it - saved together'
          }
          right={<Badge tone="neutral">{recipe.kind === 'sub' ? 'sub-recipe' : 'menu recipe'}</Badge>}
        >
          <RecipeLinesEditor
            recipeId={recipe.id}
            versionId={recipe.version_id}
            initialLines={recipe.lines}
            items={items}
            subRecipes={subRecipes}
          />
        </Card>
      </div>
    </>
  );
}
