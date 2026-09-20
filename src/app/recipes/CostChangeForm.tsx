'use client';

import { useActionState } from 'react';
import { changeIngredientCost, type CostChangeState } from './actions';

export function CostChangeForm({
  ingredients,
  defaultDate,
  defaultItemId,
}: {
  ingredients: { id: string; name: string; uom: string; current_cost: string | null }[];
  defaultDate: string;
  defaultItemId?: string;
}) {
  const [state, action, pending] = useActionState<CostChangeState, FormData>(
    changeIngredientCost,
    { error: null },
  );

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Ingredient
          </span>
          <select
            name="itemId"
            defaultValue={defaultItemId}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} - {i.current_cost ?? '-'} ETB / {i.uom}
              </option>
            ))}
          </select>
        </label>

        <label className="w-36">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            New cost
          </span>
          <input
            name="cost"
            inputMode="decimal"
            placeholder="1150.00"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] tnum"
          />
        </label>

        <label className="w-44">
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

        <label className="flex-1 min-w-[180px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Reason
          </span>
          <input
            name="note"
            placeholder="supplier increase"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Recording…' : 'Record new cost'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}

      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-3xl">
        The old cost is never overwritten. It is closed on the date the new one starts, so a
        report run against any earlier date returns exactly what it returned before. This is the
        single biggest failure of the spreadsheet this replaces.
      </p>
    </form>
  );
}
