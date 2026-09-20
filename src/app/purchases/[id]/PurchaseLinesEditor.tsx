'use client';

import { useState } from 'react';
import { savePurchaseLinesAction } from '../actions';

interface Item {
  id: string;
  name: string;
  uom: string;
}

interface Line {
  itemId: string;
  qty: string;
  unitCost: string;
}

export function PurchaseLinesEditor({
  purchaseId,
  initialLines,
  items,
}: {
  purchaseId: string;
  initialLines: Line[];
  items: Item[];
}) {
  const [lines, setLines] = useState<Line[]>(
    initialLines.length > 0 ? initialLines : [{ itemId: '', qty: '', unitCost: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (idx: number, field: keyof Line, value: string) => {
    const newLines = [...lines];
    newLines[idx] = { ...newLines[idx], [field]: value };
    setLines(newLines);
    setError(null);
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
    setError(null);
  };

  const addLine = () => {
    setLines([...lines, { itemId: '', qty: '', unitCost: '' }]);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const validLines = lines.filter((l) => l.itemId && l.qty && l.unitCost);
      const result = await savePurchaseLinesAction(purchaseId, validLines);
      if (result.error) {
        setError(result.error);
      } else {
        // saved successfully
      }
    } catch (err) {
      setError('Failed to save lines.');
    } finally {
      setSaving(false);
    }
  };

  const total = lines.reduce((acc, l) => {
    const q = parseFloat(l.qty) || 0;
    const c = parseFloat(l.unitCost) || 0;
    return acc + q * c;
  }, 0);

  return (
    <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden mb-6">
      <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
        <h2 className="text-[14px] font-bold text-gray-900 dark:text-zinc-100">Items Received</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-[13px] font-bold rounded shadow hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-[13px] border-b border-red-200">
          {error}
        </div>
      )}

      <table className="w-full text-left text-[13px]">
        <thead className="bg-gray-100 border-b border-gray-300 dark:border-zinc-700">
          <tr>
            <th className="px-3 py-2 font-semibold text-gray-700 w-1/2">Item</th>
            <th className="px-3 py-2 font-semibold text-gray-700">Qty</th>
            <th className="px-3 py-2 font-semibold text-gray-700">Unit Cost</th>
            <th className="px-3 py-2 font-semibold text-gray-700 text-right">Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {lines.map((line, idx) => {
            const item = items.find((i) => i.id === line.itemId);
            const uom = item?.uom || '';
            const lineTotal = (parseFloat(line.qty) || 0) * (parseFloat(line.unitCost) || 0);

            return (
              <tr key={idx}>
                <td className="px-3 py-2">
                  <select
                    value={line.itemId}
                    onChange={(e) => updateLine(idx, 'itemId', e.target.value)}
                    className="block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px] py-1"
                  >
                    <option value="">Select item...</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      value={line.qty}
                      onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                      placeholder="Qty"
                      className="block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px] py-1 text-right"
                    />
                    <span className="text-gray-500 text-[12px] w-8">{uom}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.unitCost}
                    onChange={(e) => updateLine(idx, 'unitCost', e.target.value)}
                    placeholder="0.00"
                    className="block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px] py-1 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-zinc-100">
                  {lineTotal > 0 ? lineTotal.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => removeLine(idx)}
                    className="text-gray-400 hover:text-red-600 font-bold px-2 py-1"
                    title="Remove item"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-300 dark:border-zinc-700">
          <tr>
            <td colSpan={3} className="px-3 py-3 text-right font-bold text-gray-700">
              Total Receipt Value:
            </td>
            <td className="px-3 py-3 text-right font-bold text-gray-900 dark:text-zinc-100 text-[15px]">
              {total.toFixed(2)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div className="p-3 bg-gray-50 border-t border-gray-200">
        <button
          onClick={addLine}
          className="text-green-700 hover:text-green-800 font-bold text-[13px] px-2 py-1 bg-green-50 hover:bg-green-100 rounded border border-green-200"
        >
          + Add another item
        </button>
      </div>
    </div>
  );
}
