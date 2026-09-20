'use client';

import { useState, useTransition } from 'react';
import { savePurchaseRequestLinesAction } from '../actions';
import type { PurchaseRequestLineInput } from '../../../domain/purchaseRequest';

type Item = { id: string; name: string; uom: string };

export function RequestLinesEditor({
  requestId,
  initialLines,
  items,
}: {
  requestId: string;
  initialLines: PurchaseRequestLineInput[];
  items: Item[];
}) {
  const [lines, setLines] = useState<PurchaseRequestLineInput[]>(
    initialLines.length > 0 ? initialLines : [{ itemId: '', qty: '', note: '' }],
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateLine = (index: number, field: keyof PurchaseRequestLineInput, val: string) => {
    const copy = [...lines];
    copy[index] = { ...copy[index], [field]: val };
    setLines(copy);
    setSaved(false);
  };

  const removeLine = (index: number) => {
    const copy = [...lines];
    copy.splice(index, 1);
    setLines(copy);
    setSaved(false);
  };

  const addLine = () => {
    setLines([...lines, { itemId: '', qty: '', note: '' }]);
    setSaved(false);
  };

  const save = () => {
    setError(null);
    setSaved(false);

    // filter out empty rows
    const validLines = lines.filter((l) => l.itemId && l.qty && parseFloat(l.qty) > 0);

    startTransition(async () => {
      const res = await savePurchaseRequestLinesAction(requestId, validLines);
      if (res.error) {
        setError(res.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-[13px] rounded border border-red-200">
          {error}
        </div>
      )}

      <div className="border border-gray-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden bg-white dark:bg-[#1c1c1c]">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
            <tr>
              <th className="px-3 py-2 font-semibold text-gray-700 w-1/3">Item</th>
              <th className="px-3 py-2 font-semibold text-gray-700 w-24">Qty</th>
              <th className="px-3 py-2 font-semibold text-gray-700">Note (Optional)</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="p-1.5">
                  <select
                    value={line.itemId}
                    onChange={(e) => updateLine(i, 'itemId', e.target.value)}
                    className="w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-brand-500 focus:ring-brand-500 text-[13px]"
                  >
                    <option value="">Select item...</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.uom})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-1.5">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={line.qty}
                    onChange={(e) => updateLine(i, 'qty', e.target.value)}
                    className="w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-brand-500 focus:ring-brand-500 text-[13px]"
                    placeholder="0.00"
                  />
                </td>
                <td className="p-1.5">
                  <input
                    type="text"
                    value={line.note || ''}
                    onChange={(e) => updateLine(i, 'note', e.target.value)}
                    className="w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-brand-500 focus:ring-brand-500 text-[13px]"
                    placeholder="e.g. Urgent for event"
                  />
                </td>
                <td className="p-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-red-500 hover:text-red-700 font-bold px-2 py-1"
                    title="Remove line"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-2 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={addLine}
            className="text-[12px] font-medium text-brand-600 hover:text-brand-800 flex items-center gap-1"
          >
            <span>+</span> Add Row
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 bg-brand-600 text-white text-[13px] font-bold rounded shadow hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Lines'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">✓ Saved</span>}
      </div>
    </div>
  );
}
