'use client';

import { useState, useActionState } from 'react';
import { createWasteLogAction, type WasteFormState } from './actions';
import { Card } from '../../components/ui';

export interface StoreOption {
  id: string;
  name: string;
  kind: string;
}

export interface ItemOption {
  id: string;
  code: string;
  name: string;
  uom: string;
}

interface WasteLine {
  id: string;
  itemId: string;
  qty: string;
  reason: 'spoilage' | 'burnt' | 'spill' | 'expired' | 'comp' | 'staff_meal';
  lineNote: string;
}

export function NewWasteForm({
  stores,
  items,
  defaultStoreId,
}: {
  stores: StoreOption[];
  items: ItemOption[];
  defaultStoreId?: string;
}) {
  const [state, formAction, isPending] = useActionState<WasteFormState, FormData>(
    createWasteLogAction,
    { error: null },
  );

  const [lines, setLines] = useState<WasteLine[]>([
    { id: '1', itemId: items[0]?.id || '', qty: '1', reason: 'spoilage', lineNote: '' },
  ]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        itemId: items[0]?.id || '',
        qty: '1',
        reason: 'spoilage',
        lineNote: '',
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof WasteLine, val: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: val } : l)),
    );
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card title="Record Daily Kitchen & Bar Leakage / Waste">
      <form action={formAction} className="p-6 space-y-6">
        {state.error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 p-4 text-[13px] text-rose-800 dark:text-rose-200">
            {state.error}
          </div>
        )}
        {state.ok && (
          <div className="rounded-lg bg-brand-50 dark:bg-brand-950/50 border border-brand-200 dark:border-brand-800 p-4 text-[13px] text-brand-800 dark:text-brand-200">
            {state.ok}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-600 dark:text-ink-400 mb-1.5">
              Outlet Store
            </label>
            <select
              name="storeId"
              defaultValue={defaultStoreId || stores[0]?.id}
              className="w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-3.5 py-2 text-[13.5px] text-ink-900 dark:text-ink-100 focus:outline-none focus:border-brand-500"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.kind})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-600 dark:text-ink-400 mb-1.5">
              Occurrence Date
            </label>
            <input
              type="date"
              name="occurredOn"
              defaultValue={today}
              className="w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-3.5 py-2 text-[13.5px] text-ink-900 dark:text-ink-100 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-600 dark:text-ink-400 mb-1.5">
              Shift / Session Notes
            </label>
            <input
              type="text"
              name="note"
              placeholder="e.g. Dinner rush burns, broken gin bottle"
              className="w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-3.5 py-2 text-[13.5px] text-ink-900 dark:text-ink-100 focus:outline-none focus:border-brand-500"
            />
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-700 dark:text-ink-300">
              Items to Write Off
            </h3>
            <button
              type="button"
              onClick={addLine}
              className="text-[12.5px] text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
            >
              + Add Item Row
            </button>
          </div>

          <div className="border border-ink-100 dark:border-ink-800 rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-ink-950 text-ink-500 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Item</th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider w-28 text-right">Quantity</th>
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider w-40">Reason Code</th>
                  <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Explanation</th>
                  <th className="px-3 py-2.5 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-ink-50/50 dark:hover:bg-ink-900/50">
                    <td className="px-4 py-2">
                      <select
                        name="itemId"
                        value={l.itemId}
                        onChange={(e) => updateLine(l.id, 'itemId', e.target.value)}
                        className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-2.5 py-1.5 text-[13px] text-ink-900 dark:text-ink-100 focus:outline-none"
                      >
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.code} · {i.uom})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        name="qty"
                        step="any"
                        min="0.001"
                        value={l.qty}
                        onChange={(e) => updateLine(l.id, 'qty', e.target.value)}
                        className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-2 py-1.5 text-right font-mono text-[13px] text-ink-900 dark:text-ink-100 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        name="reason"
                        value={l.reason}
                        onChange={(e) => updateLine(l.id, 'reason', e.target.value)}
                        className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-2.5 py-1.5 text-[12.5px] text-ink-900 dark:text-ink-100 focus:outline-none"
                      >
                        <option value="spoilage">Kitchen Spoilage</option>
                        <option value="burnt">Burnt in Cooking</option>
                        <option value="spill">Bar Spillage / Breakage</option>
                        <option value="expired">Expired Prep</option>
                        <option value="comp">Complimentary (Drink/Food)</option>
                        <option value="staff_meal">Staff Meal</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        name="lineNote"
                        value={l.lineNote}
                        placeholder="Why did this happen?"
                        onChange={(e) => updateLine(l.id, 'lineNote', e.target.value)}
                        className="w-full rounded-md border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-2.5 py-1.5 text-[12.5px] text-ink-900 dark:text-ink-100 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(l.id)}
                          className="text-ink-400 hover:text-rose-600 text-[16px] leading-none"
                          title="Remove row"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-ink-100 dark:border-ink-800">
          <p className="text-[12.5px] text-ink-500">
            Logs enter as <strong>Submitted</strong> for the F&B Cost Controller to audit and approve.
          </p>
          <div className="flex gap-3">
            <button
              type="submit"
              name="autoSubmit"
              value="false"
              disabled={isPending}
              className="px-4 py-2 rounded-lg border border-ink-200 dark:border-ink-700 text-[13px] font-medium text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-800 cursor-pointer disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              type="submit"
              name="autoSubmit"
              value="true"
              disabled={isPending}
              className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-medium transition cursor-pointer disabled:opacity-50"
            >
              {isPending ? 'Submitting…' : 'Submit for Controller Signoff'}
            </button>
          </div>
        </div>
      </form>
    </Card>
  );
}
