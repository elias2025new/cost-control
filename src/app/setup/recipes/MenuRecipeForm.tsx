'use client';

import { useActionState } from 'react';
import { createMenuRecipeAction, type RecipeFormState } from './actions';

export function MenuRecipeForm({
  menuItems,
  defaultDate,
}: {
  menuItems: { id: string; name: string }[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<RecipeFormState, FormData>(
    createMenuRecipeAction,
    { error: null },
  );

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-32">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Code
          </span>
          <input
            name="code"
            placeholder="RC-KITFO"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="flex-1 min-w-[180px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Name
          </span>
          <input
            name="name"
            placeholder="Yeajet Kitfo"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="flex-1 min-w-[200px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Menu item
          </span>
          <select
            name="menuItemId"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="w-40">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Takes effect
          </span>
          <input
            type="date"
            name="effectiveFrom"
            defaultValue={defaultDate}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create recipe'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}

      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-3xl">
        One portion of what the menu item sells for. Ingredients - including any sub-recipes - are
        added on the next screen.
      </p>
    </form>
  );
}
