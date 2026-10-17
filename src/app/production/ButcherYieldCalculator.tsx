'use client';

import { useActionState, useMemo, useState } from 'react';
import { submitButcherYieldTest, type YieldActionState } from './actions';
import { calculateYieldTest, type YieldCutInput } from '../../domain/production';
import { etb, qty } from '../../lib/format';
import { Badge, Stat } from '../../components/ui';

interface StoreOption {
  id: string;
  name: string;
  kind: string;
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  uom: string;
}

export function ButcherYieldCalculator({
  stores,
  items,
}: {
  stores: StoreOption[];
  items: ItemOption[];
}) {
  const [state, action, pending] = useActionState<YieldActionState, FormData>(
    submitButcherYieldTest,
    { error: null },
  );

  const [grossWeight, setGrossWeight] = useState<string>('50');
  const [grossCostPerKg, setGrossCostPerKg] = useState<string>('650');
  const [cuts, setCuts] = useState<YieldCutInput[]>([
    { cutName: 'Beef Tenderloin / Fillet', weight: '4.5', marketPricePerKg: '1400', isByproduct: false },
    { cutName: 'Beef Ribeye', weight: '7.0', marketPricePerKg: '1100', isByproduct: false },
    { cutName: 'Beef Sirloin / Strip', weight: '8.5', marketPricePerKg: '950', isByproduct: false },
    { cutName: 'Beef Brisket & Chuck', weight: '12.0', marketPricePerKg: '750', isByproduct: false },
    { cutName: 'Minced Meat / Stew Trim', weight: '10.0', marketPricePerKg: '600', isByproduct: false },
    { cutName: 'Soup Bones (Stock)', weight: '5.0', marketPricePerKg: '80', isByproduct: true },
    { cutName: 'Beef Tallow / Fat', weight: '2.0', marketPricePerKg: '60', isByproduct: true },
  ]);

  // Reactive Live Yield Test Calculation
  const calculation = useMemo(() => {
    try {
      const gw = Number(grossWeight) || 0;
      const gcost = Number(grossCostPerKg) || 0;
      if (gw <= 0 || gcost < 0) return null;
      return calculateYieldTest({
        grossWeight: gw,
        grossCostPerKg: gcost,
        cuts,
      });
    } catch {
      return null;
    }
  }, [grossWeight, grossCostPerKg, cuts]);

  const updateCut = (index: number, field: keyof YieldCutInput, val: unknown) => {
    setCuts((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const addCut = () => {
    setCuts((prev) => [
      ...prev,
      { cutName: `Cut #${prev.length + 1}`, weight: '1.0', marketPricePerKg: '500', isByproduct: false },
    ]);
  };

  const removeCut = (index: number) => {
    setCuts((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <form action={action} className="p-6 space-y-6">
      {/* Parameters Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl border border-ink-100 dark:border-zinc-800 bg-ink-50/50 dark:bg-zinc-800/20">
        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Butchery / Prep Store
          </label>
          <select
            name="storeId"
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.kind})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Primal Carcass Article
          </label>
          <select
            name="primalItemId"
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] text-ink-900 dark:text-zinc-100 focus:outline-none"
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.code}) · {i.uom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Gross Carcass Weight (kg)
          </label>
          <input
            name="grossWeight"
            type="number"
            step="0.001"
            min="0.1"
            value={grossWeight}
            onChange={(e) => setGrossWeight(e.target.value)}
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Gross Cost Per kg (ETB)
          </label>
          <input
            name="grossCostPerKg"
            type="number"
            step="0.01"
            min="0"
            value={grossCostPerKg}
            onChange={(e) => setGrossCostPerKg(e.target.value)}
            required
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[13px] font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
          />
        </div>
      </div>

      {/* Live Calculation KPI Summary Cards */}
      {calculation ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-lg border border-ink-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Stat
              label="Total Primal Cost"
              value={etb(calculation.totalPrimalCost)}
              unit="ETB"
              note="Gross Investment"
            />
          </div>
          <div className="p-3.5 rounded-lg border border-ink-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Stat
              label="Usable Yield"
              value={`${calculation.usableYieldPercent.toFixed(1)}%`}
              tone="good"
              note={`${qty(calculation.usableWeight)} kg prime cuts`}
            />
          </div>
          <div className="p-3.5 rounded-lg border border-ink-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Stat
              label="Waste / Trim Loss"
              value={`${calculation.lossPercent.toFixed(1)}%`}
              tone={calculation.lossPercent.toNumber() > 10 ? 'warn' : 'neutral'}
              note={`${qty(calculation.wasteWeight)} kg trim loss`}
            />
          </div>
          <div className="p-3.5 rounded-lg border border-ink-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Stat
              label="Byproduct Salvage Credit"
              value={etb(calculation.byproductTotalValue)}
              unit="ETB"
              tone="good"
              note="Deducted from prime cost"
            />
          </div>
          <div className="p-3.5 rounded-lg border border-ink-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Stat
              label="Yield Cost Factor"
              value={`${calculation.costFactor.toFixed(3)}x`}
              note="Prime Cost / Carcass Cost"
            />
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-[12.5px] text-amber-800">
          ⚠️ Cut weights exceed gross weight or input values are invalid.
        </div>
      )}

      {/* Cuts Breakdown Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-ink-900 dark:text-zinc-100 flex items-center gap-2">
            <span>🥩 Primal Cuts &amp; Byproduct Breakdown</span>
            <span className="text-[11.5px] font-normal text-ink-500">
              (Allocate costs proportionally by market value ratio and credit byproducts at salvage value)
            </span>
          </h3>
          <button
            type="button"
            onClick={addCut}
            className="px-3 py-1 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-ink-800 dark:text-zinc-200 text-[12px] font-medium hover:bg-ink-50 cursor-pointer"
          >
            + Add Cut
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-zinc-800">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500 border-b border-ink-200 dark:border-zinc-800">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Cut / Part Name</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Type</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">Map To Item</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right w-28">Weight (kg)</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right w-32">Market Price (ETB)</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Yield %</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">True Net Cost/kg</th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">Line Total</th>
                <th className="px-3 py-2.5 text-center w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
              {cuts.map((c, idx) => {
                const calcCut = calculation?.cuts[idx];
                return (
                  <tr key={idx} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={c.cutName}
                        onChange={(e) => updateCut(idx, 'cutName', e.target.value)}
                        className="w-full rounded border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[12.5px] font-medium text-ink-900 dark:text-zinc-100 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.isByproduct}
                          onChange={(e) => updateCut(idx, 'isByproduct', e.target.checked)}
                          className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                        />
                        <span className={c.isByproduct ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-ink-600 dark:text-zinc-400'}>
                          {c.isByproduct ? 'Byproduct' : 'Prime Cut'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.itemId ?? ''}
                        onChange={(e) => updateCut(idx, 'itemId', e.target.value || undefined)}
                        className="w-full rounded border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[12px] text-ink-800 dark:text-zinc-200 focus:outline-none"
                      >
                        <option value="">-- No Ledger Item --</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} ({it.code})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={String(c.weight)}
                        onChange={(e) => updateCut(idx, 'weight', e.target.value)}
                        className="w-full rounded border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[12.5px] font-mono text-right text-ink-900 dark:text-zinc-100 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={String(c.marketPricePerKg ?? 0)}
                        onChange={(e) => updateCut(idx, 'marketPricePerKg', e.target.value)}
                        className="w-full rounded border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[12.5px] font-mono text-right text-ink-900 dark:text-zinc-100 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-700 dark:text-zinc-300">
                      {calcCut ? `${calcCut.weightPercent.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-brand-700 dark:text-brand-300">
                      {calcCut ? `${etb(calcCut.allocatedCostPerKg)} ETB` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-900 dark:text-zinc-100">
                      {calcCut ? `${etb(calcCut.totalLineCost)} ETB` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeCut(idx)}
                        className="text-ink-400 hover:text-rose-600 text-[14px] cursor-pointer"
                        title="Remove Cut"
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
      </div>

      {/* Hidden JSON serialization of cuts */}
      <input type="hidden" name="cutsJson" value={JSON.stringify(cuts)} />

      {/* Submit Controls & Stock Ledger Integration */}
      <div className="pt-4 border-t border-ink-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[13px] text-ink-700 dark:text-zinc-300">
          <input
            type="checkbox"
            name="autoPost"
            defaultChecked={true}
            className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
          />
          <span className="font-medium">
            Post directly into Stock Ledger (Issues primal cut &amp; books prime cut receipts)
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !calculation}
            className="rounded-lg bg-brand-600 px-5 py-2 text-[13.5px] font-medium text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
          >
            {pending ? 'Recording Yield Test…' : 'Save & Execute Butcher Yield Test'}
          </button>
        </div>
      </div>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-brand-800">
          ✓ {state.ok}
        </div>
      )}
    </form>
  );
}
