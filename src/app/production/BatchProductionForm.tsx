'use client';

import { useActionState, useState } from 'react';
import { submitProductionBatch, type BatchActionState } from './actions';
import { etb, qty } from '../../lib/format';

interface StoreOption {
  id: string;
  name: string;
  kind: string;
}

interface SubRecipeOption {
  id: string;
  code: string;
  name: string;
  yieldQty: string;
  yieldUom: string;
  targetItemId: string | null;
  componentCount: number;
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  uom: string;
}

export function BatchProductionForm({
  stores,
  subRecipes,
  items,
}: {
  stores: StoreOption[];
  subRecipes: SubRecipeOption[];
  items: ItemOption[];
}) {
  const [state, action, pending] = useActionState<BatchActionState, FormData>(
    submitProductionBatch,
    { error: null },
  );

  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(subRecipes[0]?.id || '');
  const [multiplier, setMultiplier] = useState<string>('1');

  const selectedRecipe = subRecipes.find((r) => r.id === selectedRecipeId) || subRecipes[0];
  const multNumber = Number(multiplier) || 1;
  const totalExpectedYield = selectedRecipe ? (Number(selectedRecipe.yieldQty) * multNumber).toFixed(2) : '0';

  return (
    <form action={action} className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl border border-ink-100 dark:border-zinc-800 bg-ink-50/50 dark:bg-zinc-800/20">
        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Prep Station / Store
          </label>
          <select
            name="storeId"
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.kind})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Sub-Recipe (Prep Item)
          </label>
          <select
            name="recipeId"
            value={selectedRecipeId}
            onChange={(e) => setSelectedRecipeId(e.target.value)}
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
          >
            {subRecipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code}) · Yield: {r.yieldQty} {r.yieldUom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Finished Stock Item
          </label>
          <select
            name="targetItemId"
            defaultValue={selectedRecipe?.targetItemId || items[0]?.id || ''}
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
          >
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.code}) · {it.uom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Batch Multiplier (Count)
          </label>
          <input
            name="multiplier"
            type="number"
            step="0.5"
            min="0.5"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
          />
        </div>
      </div>

      {/* Production Preview Card */}
      {selectedRecipe && (
        <div className="p-4 rounded-xl border border-brand-200 dark:border-brand-900 bg-brand-50/40 dark:bg-brand-950/20 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-bold text-[14px] text-brand-950 dark:text-brand-200">
                Batch Run: {selectedRecipe.name} [{selectedRecipe.code}]
              </span>
              <p className="text-[12.5px] text-brand-800 dark:text-brand-300">
                Single Batch Yield: {selectedRecipe.yieldQty} {selectedRecipe.yieldUom} · Raw Ingredients: {selectedRecipe.componentCount} items
              </p>
            </div>
            <div className="text-right">
              <span className="text-[12px] text-brand-700 dark:text-brand-300 block">Total Planned Output:</span>
              <span className="text-[18px] font-bold font-mono text-brand-950 dark:text-brand-100">
                {totalExpectedYield} {selectedRecipe.yieldUom}
              </span>
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
          Production Notes / Cook Shift
        </label>
        <input
          name="notes"
          type="text"
          placeholder="e.g., Morning prep shift, chef signature, batch quality verified."
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
        />
      </div>

      {/* Action Footer */}
      <div className="pt-4 border-t border-ink-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[13px] text-ink-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="autoPost"
            defaultChecked={true}
            className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
          />
          <span className="font-medium">
            Post directly into Stock Ledger (Issues raw ingredients &amp; books finished sub-recipe)
          </span>
        </label>

        <button
          type="submit"
          disabled={pending || !selectedRecipe}
          className="rounded-lg bg-brand-600 px-5 py-2 text-[13.5px] font-medium text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
        >
          {pending ? 'Executing Batch Run…' : 'Execute Batch Production Run'}
        </button>
      </div>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-800">
          ✓ {state.ok}
        </div>
      )}
    </form>
  );
}
