'use client';

import { useActionState, useState } from 'react';
import { setStoreParLevel, deleteStoreParLevel, type StoreFormState } from '../actions';

interface ParLevelItem {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  category_name: string;
  uom: string;
  min_qty: string;
  max_qty: string;
  qty_on_hand: string;
  reorder_status: string;
}

interface AvailableItem {
  id: string;
  code: string;
  name: string;
  uom: string;
  category_name: string;
}

export function StoreParLevelsSection({
  storeId,
  storeName,
  parLevels,
  availableItems,
}: {
  storeId: string;
  storeName: string;
  parLevels: ParLevelItem[];
  availableItems: AvailableItem[];
}) {
  const [addState, addAction, addPending] = useActionState<StoreFormState, FormData>(
    setStoreParLevel,
    { error: null },
  );

  const [delState, delAction, delPending] = useActionState<StoreFormState, FormData>(
    deleteStoreParLevel,
    { error: null },
  );

  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(availableItems[0]?.id ?? '');

  const filteredParLevels = parLevels.filter(
    (p) =>
      p.item_name.toLowerCase().includes(search.toLowerCase()) ||
      p.item_code.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* ── Add New Item to Par Stock ── */}
      {availableItems.length > 0 && (
        <form action={addAction} className="p-5 rounded-lg border border-ink-100 dark:border-zinc-800 bg-ink-50/40 dark:bg-zinc-800/20">
          <input type="hidden" name="storeId" value={storeId} />
          <h4 className="text-[13px] font-semibold text-ink-900 dark:text-zinc-100 mb-3 flex items-center gap-1.5">
            <span>⚡</span> Add Item to Par Stock
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <label className="md:col-span-2">
              <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
                Select Item *
              </span>
              <select
                name="itemId"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13px]"
              >
                {availableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.code}) — {item.category_name} [{item.uom}]
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
                Min Par (Safety) *
              </span>
              <input
                type="number"
                name="minQty"
                step="any"
                min="0"
                defaultValue="5"
                required
                className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13px]"
              />
            </label>

            <label>
              <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
                Max Par (Target) *
              </span>
              <input
                type="number"
                name="maxQty"
                step="any"
                min="0"
                defaultValue="15"
                required
                className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13px]"
              />
            </label>
          </div>

          <div className="flex justify-end mt-3">
            <button
              type="submit"
              disabled={addPending}
              className="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {addPending ? 'Adding…' : '＋ Save Par Level'}
            </button>
          </div>

          {addState.error && (
            <div className="mt-2 text-[12px] text-rose-600 font-medium">{addState.error}</div>
          )}
          {addState.ok && (
            <div className="mt-2 text-[12px] text-emerald-600 font-medium">{addState.ok}</div>
          )}
        </form>
      )}

      {/* ── Par Stock List & Status Table ── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h4 className="text-[14px] font-semibold text-ink-900 dark:text-zinc-100">
              Par Inventory Levels for {storeName}
            </h4>
            <p className="text-[12px] text-ink-500">
              Items configured here automatically drive the 1-Click Par Requisition generator.
            </p>
          </div>
          {parLevels.length > 5 && (
            <input
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-1.5 text-[12px] w-48"
            />
          )}
        </div>

        {delState.error && (
          <div className="mb-2 text-[12px] text-rose-600 font-medium">{delState.error}</div>
        )}

        {parLevels.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-ink-200 dark:border-zinc-700 rounded-lg text-ink-400 text-[13px]">
            No par stock items configured for this store yet. Select an item above to set target levels.
          </div>
        ) : (
          <div className="overflow-x-auto border border-ink-100 dark:border-zinc-800 rounded-lg">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-ink-100 dark:border-zinc-800 text-left text-[11px] uppercase tracking-wider text-ink-400 bg-ink-50/60 dark:bg-zinc-800/40">
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 font-semibold">Category</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Current On Hand</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Min Par</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Max Par</th>
                  <th className="px-3 py-2.5 font-semibold text-center">Reorder Status</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                {filteredParLevels.map((p) => {
                  const onHand = Number(p.qty_on_hand);
                  const min = Number(p.min_qty);
                  const max = Number(p.max_qty);
                  const needed = Math.max(0, max - onHand);

                  return (
                    <tr key={p.id} className="hover:bg-ink-50/50 dark:hover:bg-zinc-800/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-900 dark:text-zinc-100">{p.item_name}</div>
                        <div className="text-[11px] font-mono text-ink-400">{p.item_code}</div>
                      </td>
                      <td className="px-3 py-3 text-ink-600 dark:text-zinc-400 text-[12px]">
                        {p.category_name}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold">
                        <span className={onHand < min ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-zinc-100'}>
                          {Number(p.qty_on_hand).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>{' '}
                        <span className="text-[11px] text-ink-400 font-sans">{p.uom}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                        {min} <span className="text-[11px] text-ink-400 font-sans">{p.uom}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                        {max} <span className="text-[11px] text-ink-400 font-sans">{p.uom}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {p.reorder_status === 'REORDER NOW' ? (
                          <span className="inline-flex flex-col items-center">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                              REORDER NOW
                            </span>
                            <span className="text-[10.5px] text-rose-600 dark:text-rose-400 mt-0.5">
                              Short {needed} {p.uom}
                            </span>
                          </span>
                        ) : p.reorder_status === 'OVERSTOCK' ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            OVERSTOCK
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <form action={delAction} className="inline">
                          <input type="hidden" name="storeId" value={storeId} />
                          <input type="hidden" name="itemId" value={p.item_id} />
                          <button
                            type="submit"
                            disabled={delPending}
                            title="Remove from par stock"
                            className="text-rose-600 hover:text-rose-800 dark:text-rose-400 text-[12px] font-medium px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
