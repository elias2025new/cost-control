'use client';

import { useActionState, useState } from 'react';
import { saveRecipeLines, type RecipeLinesFormState } from './actions';

interface Row {
  key: string;
  component: string; // 'item:<id>' or 'sub:<id>' or '' if not chosen yet
  qty: string;
  note: string;
}

let nextKey = 0;
const newKey = () => `new-${++nextKey}`;

export function RecipeLinesEditor({
  recipeId,
  versionId,
  initialLines,
  items,
  subRecipes,
}: {
  recipeId: string;
  versionId: string;
  initialLines: {
    id: string;
    component_type: 'item' | 'sub';
    component_id: string;
    component_name: string;
    qty: string;
    uom: string;
    note: string | null;
  }[];
  items: { id: string; name: string; uom: string }[];
  subRecipes: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<RecipeLinesFormState, FormData>(
    saveRecipeLines,
    { error: null },
  );
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.length
      ? initialLines.map((l) => ({
          key: l.id,
          component: `${l.component_type}:${l.component_id}`,
          qty: l.qty,
          note: l.note ?? '',
        }))
      : [{ key: newKey(), component: '', qty: '', note: '' }],
  );

  const addRow = () => setRows((r) => [...r, { key: newKey(), component: '', qty: '', note: '' }]);
  const removeRow = (key: string) => setRows((r) => r.filter((row) => row.key !== key));
  const update = (key: string, patch: Partial<Row>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={action}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="versionId" value={versionId} />

      <div className="px-5 py-4 space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <select
              name={`component_${row.key}`}
              value={row.component}
              onChange={(e) => update(row.key, { component: e.target.value })}
              className="flex-1 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
            >
              <option value="">Choose an ingredient…</option>
              {items.length > 0 && (
                <optgroup label="Items">
                  {items.map((i) => (
                    <option key={i.id} value={`item:${i.id}`}>
                      {i.name} ({i.uom})
                    </option>
                  ))}
                </optgroup>
              )}
              {subRecipes.length > 0 && (
                <optgroup label="Sub-recipes">
                  {subRecipes.map((s) => (
                    <option key={s.id} value={`sub:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
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
              onClick={() => removeRow(row.key)}
              disabled={rows.length === 1}
              className="shrink-0 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2.5 py-2 text-[12px] text-ink-500 hover:border-rose-300 hover:text-rose-700 disabled:opacity-40"
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-100 px-5 py-3.5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:border-ink-300"
        >
          + Add line
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save recipe'}
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
