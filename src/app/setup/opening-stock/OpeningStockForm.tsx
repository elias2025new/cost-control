'use client';

import { useActionState, useState } from 'react';
import { recordOpeningStock, type OpeningStockFormState } from './actions';
import { categoryAllowedInStore } from '../../../lib/storeCompat';

export function OpeningStockForm({
  stores,
  items,
  defaultDate,
}: {
  stores: { id: string; name: string; kind: string }[];
  items: { id: string; code: string; name: string; uom: string; category_kind: string }[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<OpeningStockFormState, FormData>(
    recordOpeningStock,
    { error: null },
  );
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const store = stores.find((s) => s.id === storeId);
  const availableItems = store
    ? items.filter((i) => categoryAllowedInStore(i.category_kind, store.kind))
    : [];

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-44">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store
          </span>
          <select
            name="storeId"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex-1 min-w-[220px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Item
          </span>
          {/* Remounts on store change so the browser can't keep a now-invalid selection. */}
          <select
            key={storeId}
            name="itemId"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {availableItems.length === 0 ? (
              <option value="">No items belong in this kind of store</option>
            ) : (
              availableItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code}) · {i.uom}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="w-28">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Quantity
          </span>
          <input
            name="qty"
            inputMode="decimal"
            placeholder="100"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] tnum"
          />
        </label>

        <label className="w-32">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Unit cost
          </span>
          <input
            name="unitCost"
            inputMode="decimal"
            placeholder="1100.00"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] tnum"
          />
        </label>

        <label className="w-40">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            As of
          </span>
          <input
            type="date"
            name="occurredOn"
            defaultValue={defaultDate}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="flex-1 min-w-[160px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Note
          </span>
          <input
            name="note"
            placeholder="opening count"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <button
          type="submit"
          disabled={pending || availableItems.length === 0}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Recording…' : 'Record opening stock'}
        </button>
      </div>

      <p className="text-[12px] text-ink-500 mt-3 leading-snug">
        Food items can only go in the kitchen or main store; beverage items only in the bar or
        main store.
      </p>

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
    </form>
  );
}
