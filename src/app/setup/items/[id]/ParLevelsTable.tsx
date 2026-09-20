'use client';

import { useActionState } from 'react';
import { saveParLevels, type ParLevelFormState } from '../actions';

export interface ParLevelRow {
  store_id: string;
  store_name: string;
  min_qty: string | null;
  max_qty: string | null;
}

export function ParLevelsTable({ itemId, rows }: { itemId: string; rows: ParLevelRow[] }) {
  const [state, action, pending] = useActionState<ParLevelFormState, FormData>(saveParLevels, {
    error: null,
  });

  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <table className="w-full text-[13px]">
        <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
          <tr className="text-left">
            <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
              Store
            </th>
            <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
              Minimum
            </th>
            <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
              Maximum
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => (
            <tr key={r.store_id}>
              <td className="px-5 py-2 text-ink-700">{r.store_name}</td>
              <td className="px-3 py-2 text-right">
                <input
                  name={`min_${r.store_id}`}
                  defaultValue={r.min_qty ?? '0'}
                  inputMode="decimal"
                  className="w-24 rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-right tnum text-[13px]"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  name={`max_${r.store_id}`}
                  defaultValue={r.max_qty ?? '0'}
                  inputMode="decimal"
                  className="w-24 rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-right tnum text-[13px]"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-ink-100 px-5 py-3.5 flex items-center justify-between gap-4">
        <p className="text-[12px] text-ink-500">Zero on both means no par level set.</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save par levels'}
        </button>
      </div>

      {state.error && (
        <div className="mx-5 mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="mx-5 mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}
    </form>
  );
}
