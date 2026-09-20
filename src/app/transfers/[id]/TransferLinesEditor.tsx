'use client';

import { useState, useTransition } from 'react';
import { setTransferLinesAction } from '../actions';

interface Item {
  id: string;
  name: string;
  uom: string;
}

interface LineInput {
  itemId: string;
  qty: string;
}

interface Props {
  transferId: string;
  initialLines: LineInput[];
  items: Item[];
}

export function TransferLinesEditor({ transferId, initialLines, items }: Props) {
  const [lines, setLines] = useState<LineInput[]>(
    initialLines.length > 0 ? initialLines : [{ itemId: '', qty: '' }],
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setLine = (i: number, patch: Partial<LineInput>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const addLine = () => setLines((prev) => [...prev, { itemId: '', qty: '' }]);

  const removeLine = (i: number) =>
    setLines((prev) => (prev.length === 1 ? [{ itemId: '', qty: '' }] : prev.filter((_, idx) => idx !== i)));

  const save = () => {
    const valid = lines.filter((l) => l.itemId && parseFloat(l.qty) > 0);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setTransferLinesAction(transferId, valid);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  return (
    <div className="border border-gray-400 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] overflow-hidden">
      <div className="p-3 border-b border-gray-300 dark:border-zinc-700 bg-gray-100 flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-gray-900 dark:text-zinc-100">Items to Transfer</h2>
        <div className="flex items-center gap-2">
          {error && <span className="text-red-600 text-[12px]">{error}</span>}
          {saved && <span className="text-green-700 text-[12px]">✓ Saved</span>}
          <button
            type="button"
            onClick={addLine}
            className="px-3 py-1 text-[12px] font-medium text-gray-700 bg-gray-200 border border-gray-400 dark:border-zinc-700 hover:bg-gray-300"
          >
            + Add Item
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="px-3 py-1 text-[12px] font-bold text-white bg-brand-600 border border-brand-700 hover:bg-brand-700 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save Lines'}
          </button>
        </div>
      </div>

      <table className="w-full text-left text-[13px]">
        <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
          <tr>
            <th className="px-3 py-2 font-semibold text-gray-700 w-1/2">Item</th>
            <th className="px-3 py-2 font-semibold text-gray-700">Qty</th>
            <th className="px-3 py-2 font-semibold text-gray-700">UOM</th>
            <th className="px-3 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {lines.map((line, i) => {
            const item = items.find((it) => it.id === line.itemId);
            return (
              <tr key={i}>
                <td className="px-3 py-1.5">
                  <select
                    value={line.itemId}
                    onChange={(e) => setLine(i, { itemId: e.target.value })}
                    className="w-full border border-gray-300 dark:border-zinc-700 px-2 py-1 text-[13px] bg-white dark:bg-[#1c1c1c]"
                  >
                    <option value="">— select item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.uom})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                    placeholder="0.000"
                    className="w-28 border border-gray-300 dark:border-zinc-700 px-2 py-1 text-[13px] text-right bg-white dark:bg-[#1c1c1c] tnum"
                  />
                </td>
                <td className="px-3 py-1.5 text-gray-500 text-[12px]">
                  {item?.uom ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-gray-400 hover:text-red-600 font-bold px-1"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
