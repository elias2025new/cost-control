'use client';

import { useActionState, useState } from 'react';
import { createRequest, type RequestFormState } from './actions';

interface Row {
  key: string;
  itemId: string;
  qty: string;
  note: string;
}

let nextKey = 0;
const newKey = () => `r-${++nextKey}`;
const blank = (): Row => ({ key: newKey(), itemId: '', qty: '', note: '' });

export function NewRequestForm({
  stores,
  items,
}: {
  stores: { id: string; name: string }[];
  items: { id: string; code: string; name: string; uom: string }[];
}) {
  const [state, action, pending] = useActionState<RequestFormState, FormData>(createRequest, {
    error: null,
  });
  const [rows, setRows] = useState<Row[]>([blank()]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="w-52">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Requesting store
          </span>
          <select
            name="storeId"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex-1 min-w-[200px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Note
          </span>
          <input
            name="note"
            placeholder="optional - what it's for"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <select
              name={`item_${row.key}`}
              value={row.itemId}
              onChange={(e) => update(row.key, { itemId: e.target.value })}
              className="flex-1 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
            >
              <option value="">Choose an item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code}) · {i.uom}
                </option>
              ))}
            </select>
            <input
              name={`qty_${row.key}`}
              value={row.qty}
              onChange={(e) => update(row.key, { qty: e.target.value })}
              inputMode="decimal"
              placeholder="qty"
              className="w-24 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] tnum"
            />
            <input
              name={`note_${row.key}`}
              value={row.note}
              onChange={(e) => update(row.key, { note: e.target.value })}
              placeholder="note"
              className="w-40 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
            />
            <button
              type="button"
              onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
              disabled={rows.length === 1}
              className="shrink-0 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2.5 py-2 text-[12px] text-ink-500 hover:border-rose-300 hover:text-rose-700 disabled:opacity-40"
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setRows((r) => [...r, blank()])}
          className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:border-ink-300"
        >
          + Add item
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send request'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
    </form>
  );
}
