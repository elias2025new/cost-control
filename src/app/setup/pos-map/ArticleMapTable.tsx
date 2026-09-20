'use client';

import { useActionState, useState } from 'react';
import { saveArticleMappings, type ArticleMapFormState } from './actions';

export interface ArticleMapRow {
  id: string;
  article_code: string;
  article_name_seen: string | null;
  pos_category: string | null;
  menu_item_id: string | null;
  article_flag: string;
  depletes: boolean;
  counts_as_sale: boolean;
  note: string | null;
}

export function ArticleMapTable({
  rows,
  menuItems,
}: {
  rows: ArticleMapRow[];
  menuItems: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ArticleMapFormState, FormData>(
    saveArticleMappings,
    { error: null },
  );
  // Only tracked so the "generic → no menu item" rule can disable the
  // picker live; the actual values are read from the form on submit.
  const [flags, setFlags] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, r.article_flag])),
  );

  return (
    <form action={action}>
      <div className="overflow-x-auto max-h-[640px] overflow-y-auto sticky-head">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
            <tr className="text-left">
              <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                Article
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                Menu item
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                Flag
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-center bg-ink-50 dark:bg-[#111111]">
                Depletes
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-center bg-ink-50 dark:bg-[#111111]">
                Counts as sale
              </th>
              <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                Note
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => {
              const flag = flags[r.id] ?? r.article_flag;
              const isGeneric = flag === 'generic';
              return (
                <tr key={r.id} className="hover:bg-ink-50 dark:bg-[#111111]/40">
                  <td className="px-5 py-2">
                    <div className="text-ink-800 dark:text-zinc-200">{r.article_name_seen?.trim() || '-'}</div>
                    <div className="font-mono text-[11px] text-ink-400">
                      {r.article_code} · {r.pos_category ?? '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      name={`menuItem_${r.id}`}
                      defaultValue={r.menu_item_id ?? ''}
                      disabled={isGeneric}
                      className="w-full rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-[12.5px] disabled:bg-ink-50 dark:bg-[#111111] disabled:text-ink-300"
                    >
                      <option value="">- unmapped -</option>
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      name={`flag_${r.id}`}
                      defaultValue={r.article_flag}
                      onChange={(e) => setFlags((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-[12.5px]"
                    >
                      <option value="normal">normal</option>
                      <option value="generic">generic</option>
                      <option value="test">test</option>
                      <option value="free_comp">free / comp</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      name={`depletes_${r.id}`}
                      defaultChecked={r.depletes}
                      className="h-4 w-4 rounded border-ink-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      name={`countsAsSale_${r.id}`}
                      defaultChecked={r.counts_as_sale}
                      className="h-4 w-4 rounded border-ink-300"
                    />
                  </td>
                  <td className="px-5 py-2">
                    <input
                      name={`note_${r.id}`}
                      defaultValue={r.note ?? ''}
                      className="w-full rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-[12.5px]"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-ink-100 px-5 py-4 flex items-center justify-between gap-6">
        <p className="text-[12px] text-ink-500 max-w-xl">
          Free and comp articles still deplete stock but never count as revenue. Generic articles
          can never be mapped to a menu item - they name a class of product, not one.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save mapping'}
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
