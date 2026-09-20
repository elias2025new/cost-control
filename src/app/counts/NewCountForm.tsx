'use client';

import { useActionState } from 'react';
import { startCount, type NewCountState } from './actions';

export function NewCountForm({
  stores,
  defaultDate,
}: {
  stores: { id: string; name: string; kind: string }[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<NewCountState, FormData>(startCount, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store
          </span>
          <select
            name="storeId"
            defaultValue={stores.find((s) => s.kind === 'kitchen')?.id ?? stores[0]?.id}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] text-ink-800 dark:text-zinc-200"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[160px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Count date
          </span>
          <input
            type="date"
            name="countDate"
            defaultValue={defaultDate}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] text-ink-800 dark:text-zinc-200"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Building sheet…' : 'Start count'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}

      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-2xl">
        The sheet freezes what the ledger says should be on the shelf at that date. Freezing it
        matters: if the theoretical figure moved as later stock arrived, the variance would stop
        meaning anything.
      </p>
    </form>
  );
}
