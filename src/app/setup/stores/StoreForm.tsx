'use client';

import { useActionState } from 'react';
import { createStore, type StoreFormState } from './actions';

export function StoreForm({
  branches,
  existingStores = [],
}: {
  branches: { id: string; name: string }[];
  existingStores?: { id: string; name: string; kind: string }[];
}) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(createStore, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Branch *
          </span>
          <select
            name="branchId"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store Code *
          </span>
          <input
            name="code"
            placeholder="e.g. BAR-01 or KITCHEN"
            required
            className="w-full uppercase font-mono rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="md:col-span-2">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store / Cost Center Name *
          </span>
          <input
            name="name"
            placeholder="e.g. Main Kitchen, Terrace Bar, Wine Cellar"
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Cost Center Role / Type *
          </span>
          <select
            name="kind"
            defaultValue="kitchen"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            <option value="main">📦 Main Warehouse / Central Store (Receives vendor purchases)</option>
            <option value="kitchen">🍳 Kitchen Cost Center (Hot kitchen, pastry, production)</option>
            <option value="bar">🍸 Bar Cost Center (Beverages, counter stock)</option>
            <option value="cellar">🍷 Wine &amp; Spirit Cellar (Secured beverage storage)</option>
            <option value="prep">🔪 Prep Station (Butchery, bakery, mise-en-place)</option>
            <option value="outlet">🛎️ Service Outlet (Terrace, pool bar, banquets)</option>
          </select>
        </label>

        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Default Fulfilling Store (MC Requisition Route)
          </span>
          <select
            name="defaultFulfillingStoreId"
            defaultValue=""
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            <option value="">None (Standalone or Main Store)</option>
            {existingStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.kind.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Operational Notes / Location Description
          </span>
          <input
            name="description"
            placeholder="e.g. Ground floor bar station, 12-bottle speed rail, cold well"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-5 py-2.5 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
        >
          {pending ? 'Creating…' : '＋ Add Store / Cost Center'}
        </button>
      </div>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}
    </form>
  );
}
