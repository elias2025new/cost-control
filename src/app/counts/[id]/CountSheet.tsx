'use client';

import { useActionState, useState } from 'react';
import { saveCount, postCount, type CountEntryState } from '../actions';
import { etb, qty } from '../../../lib/format';
import { Decimal } from '../../../lib/money';

export interface CountLine {
  stock_count_line_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  theoretical_qty: string;
  counted_qty: string | null;
  unit_cost: string;
  note: string | null;
  discrepancy_reason?: string | null;
  recount_status?: string | null;
}

const DISCREPANCY_REASONS = [
  { value: '', label: '-- Root Cause Classification --' },
  { value: 'portion_error', label: 'Over / Under-Portioning' },
  { value: 'spoilage', label: 'Spoilage / Expired / Damaged' },
  { value: 'theft', label: 'Unaccounted Loss / Theft' },
  { value: 'unrecorded_waste', label: 'Unrecorded Kitchen / Bar Waste' },
  { value: 'receiving_error', label: 'Receiving Shortage / Invoice Error' },
  { value: 'counting_error', label: 'Miscount / UOM Discrepancy' },
  { value: 'other', label: 'Other (Explained in Memo)' },
];

const STATUS_STYLE: Record<string, string> = {
  OK: 'text-brand-700 bg-brand-50 border-brand-100',
  REVIEW: 'text-amber-800 bg-amber-50 border-amber-200',
  INVESTIGATE: 'text-rose-700 bg-rose-50 border-rose-200',
  '-': 'text-ink-400 bg-ink-50 dark:bg-[#111111] border-ink-200 dark:border-zinc-700',
};

/** The same thresholds the database applies, so the sheet previews live. */
function grade(theoretical: Decimal, counted: string): { status: string; variance: Decimal } {
  if (counted === '') return { status: '-', variance: new Decimal(0) };
  const c = new Decimal(counted || 0);
  const v = c.minus(theoretical);
  if (v.isZero()) return { status: 'OK', variance: v };
  if (theoretical.isZero()) return { status: 'INVESTIGATE', variance: v };
  const ratio = v.abs().dividedBy(theoretical.abs());
  if (ratio.lessThanOrEqualTo('0.03')) return { status: 'OK', variance: v };
  if (ratio.lessThanOrEqualTo('0.08')) return { status: 'REVIEW', variance: v };
  return { status: 'INVESTIGATE', variance: v };
}

export function CountSheet({
  countId,
  lines,
  readOnly,
}: {
  countId: string;
  lines: CountLine[];
  readOnly: boolean;
}) {
  const [blindMode, setBlindMode] = useState(!readOnly);
  const [searchTerm, setSearchTerm] = useState('');
  const [entered, setEntered] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((l) => [
        l.stock_count_line_id,
        l.counted_qty ? new Decimal(l.counted_qty).toFixed(6).replace(/\.?0+$/, '') : '',
      ]),
    ),
  );
  const [saveState, saveAction, saving] = useActionState<CountEntryState, FormData>(saveCount, {
    error: null,
  });
  const [postState, postAction, posting] = useActionState<CountEntryState, FormData>(postCount, {
    error: null,
  });

  const filteredLines = lines.filter(
    (l) =>
      l.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.item_code.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const countedCount = Object.values(entered).filter((v) => v !== '').length;
  const totalVariance = lines.reduce((sum, l) => {
    const v = entered[l.stock_count_line_id] ?? '';
    if (v === '') return sum;
    const { variance } = grade(new Decimal(l.theoretical_qty), v);
    return sum.plus(variance.times(new Decimal(l.unit_cost)));
  }, new Decimal(0));

  const recountFlaggedItems = lines.filter((l) => {
    const v = entered[l.stock_count_line_id] ?? '';
    if (v === '') return false;
    const th = new Decimal(l.theoretical_qty);
    const { variance } = grade(th, v);
    const val = variance.abs().times(new Decimal(l.unit_cost));
    const pct = th.isZero()
      ? variance.isZero()
        ? 0
        : 100
      : variance.abs().dividedBy(th.abs()).times(100).toNumber();
    return val.toNumber() > 500 || pct > 5.0;
  });

  return (
    <>
      <div className="px-5 py-3 border-b border-ink-100 dark:border-zinc-800 bg-ink-50/60 dark:bg-[#151515] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[13px] font-medium text-ink-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={blindMode}
              onChange={(e) => setBlindMode(e.target.checked)}
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
            />
            <span>Blind Count Mode (MC Anti-Cheating Audit)</span>
          </label>
          {blindMode && (
            <span className="text-[11px] font-medium bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full">
              Theoretical quantities hidden
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search items…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2.5 py-1 text-[12.5px] w-48 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-1 text-[12.5px] text-ink-700 dark:text-zinc-300 hover:bg-ink-100 cursor-pointer"
          >
            🖨️ Print Sheet
          </button>
        </div>
      </div>

      {!blindMode && recountFlaggedItems.length > 0 && (
        <div className="mx-5 my-4 p-4 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/90 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🚨</span>
              <strong className="text-[13.5px] font-bold">
                Recount Threshold Alert: {recountFlaggedItems.length} article(s) exceed 500 ETB or 5% discrepancy
              </strong>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider bg-rose-200/90 dark:bg-rose-900 px-2.5 py-1 rounded text-rose-800 dark:text-rose-200 shrink-0">
              Supervisor Recount Required
            </span>
          </div>
          <p className="text-[12.5px] text-rose-800 dark:text-rose-300 mt-1 leading-normal">
            Materials Control (HMC) audit policy requires supervisor physical recount verification and classification of discrepancy causes (e.g., spoilage, portioning error, theft, unrecorded waste) before final posting.
          </p>
        </div>
      )}

      <form action={saveAction}>
        <input type="hidden" name="countId" value={countId} />

        <div className="overflow-x-auto max-h-[560px] overflow-y-auto sticky-head">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                  Item
                </th>
                {!blindMode && (
                  <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                    Theoretical
                  </th>
                )}
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111] w-36">
                  Counted Qty
                </th>
                {!blindMode && (
                  <>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                      Variance
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                      Value
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                      Status
                    </th>
                  </>
                )}
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111] w-72">
                  Discrepancy Cause &amp; Memo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filteredLines.map((l) => {
                const value = entered[l.stock_count_line_id] ?? '';
                const theoretical = new Decimal(l.theoretical_qty);
                const { status, variance } = grade(theoretical, value);
                const varianceValue = variance.times(new Decimal(l.unit_cost));

                return (
                  <tr key={l.stock_count_line_id} className="hover:bg-ink-50 dark:bg-[#111111]/40">
                    <td className="px-5 py-2">
                      <div className="text-ink-800 dark:text-zinc-200 font-medium">{l.item_name}</div>
                      <div className="font-mono text-[11px] text-ink-400">
                        {l.item_code} · {l.uom} {!blindMode && `· ${etb(l.unit_cost)}/${l.uom}`}
                      </div>
                    </td>
                    {!blindMode && (
                      <td className="px-3 py-2 text-right tnum text-ink-600">
                        {qty(l.theoretical_qty)}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <input
                        name={`qty_${l.stock_count_line_id}`}
                        value={value}
                        readOnly={readOnly}
                        inputMode="decimal"
                        placeholder="-"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^-?\d*\.?\d*$/.test(v)) {
                            setEntered((s) => ({ ...s, [l.stock_count_line_id]: v }));
                          }
                        }}
                        className={`w-full rounded-md border px-2.5 py-1 text-right tnum font-mono text-[13px] ${
                          readOnly
                            ? 'border-transparent bg-transparent text-ink-700'
                            : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] focus:border-ink-900 focus:outline-none'
                        }`}
                      />
                    </td>
                    {!blindMode && (
                      <>
                        <td
                          className={`px-3 py-2 text-right tnum ${
                            value === ''
                              ? 'text-ink-300'
                              : variance.isZero()
                                ? 'text-ink-500'
                                : variance.isNegative()
                                  ? 'text-rose-700 font-medium'
                                  : 'text-brand-700 font-medium'
                          }`}
                        >
                          {value === '' ? '-' : `${variance.greaterThan(0) ? '+' : ''}${qty(variance)}`}
                        </td>
                        <td className="px-3 py-2 text-right tnum text-ink-700 font-mono">
                          {value === '' ? '-' : etb(varianceValue)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}
                            >
                              {status}
                            </span>
                            {value !== '' && (varianceValue.abs().toNumber() > 500 || (theoretical.toNumber() > 0 && variance.abs().dividedBy(theoretical.abs()).times(100).toNumber() > 5.0)) && (
                              <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/80 px-1 py-0.5 rounded border border-rose-200 dark:border-rose-800 whitespace-nowrap">
                                RECOUNT (&gt;500 ETB / 5%)
                              </span>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                    <td className="px-5 py-2">
                      <div className="space-y-1.5">
                        <select
                          name={`reason_${l.stock_count_line_id}`}
                          defaultValue={l.discrepancy_reason ?? ''}
                          disabled={readOnly}
                          className={`w-full rounded-md border px-2 py-1 text-[11.5px] ${
                            readOnly
                              ? 'border-transparent bg-transparent text-ink-700'
                              : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-800 dark:text-zinc-200 focus:outline-none'
                          }`}
                        >
                          {DISCREPANCY_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <input
                          name={`note_${l.stock_count_line_id}`}
                          defaultValue={l.note ?? ''}
                          readOnly={readOnly}
                          placeholder={readOnly ? '' : 'supervisor audit notes / explanation'}
                          className={`w-full rounded-md border px-2 py-1 text-[12px] ${
                            readOnly
                              ? 'border-transparent bg-transparent text-ink-600'
                              : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] focus:border-ink-900 focus:outline-none'
                          }`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div className="border-t border-ink-100 px-5 py-4 flex items-center justify-between gap-6">
            <div className="text-[13px] text-ink-600">
              <span className="tnum font-medium text-ink-900 dark:text-zinc-100">{countedCount}</span> of{' '}
              <span className="tnum">{lines.length}</span> counted
              {!blindMode && (
                <>
                  {' '}· net variance{' '}
                  <span
                    className={`tnum font-medium ${
                      totalVariance.isNegative() ? 'text-rose-700' : 'text-ink-900 dark:text-zinc-100'
                    }`}
                  >
                    {etb(totalVariance)} ETB
                  </span>
                </>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving…' : 'Save entries'}
            </button>
          </div>
        )}
      </form>

      {saveState.error && (
        <div className="mx-5 mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {saveState.error}
        </div>
      )}
      {saveState.ok && (
        <div className="mx-5 mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {saveState.ok}
        </div>
      )}

      {!readOnly && (
        <form action={postAction} className="border-t border-ink-100 px-5 py-4">
          <input type="hidden" name="countId" value={countId} />
          <div className="flex items-center justify-between gap-6">
            <p className="text-[13px] text-ink-600 max-w-2xl">
              Posting writes adjustment movements to the stock ledger to align book stock with physical count.
              Un-check Blind Mode to audit variances before posting.
            </p>
            <button
              type="submit"
              disabled={posting || countedCount === 0}
              className={`shrink-0 rounded-lg px-5 py-2.5 text-[13.5px] font-medium transition cursor-pointer ${
                countedCount > 0 && !posting
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-ink-200 text-ink-400 cursor-not-allowed'
              }`}
            >
              {posting ? 'Posting…' : 'Post count adjustments'}
            </button>
          </div>
          {postState.error && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
              {postState.error}
            </div>
          )}
          {postState.ok && (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
              {postState.ok}
            </div>
          )}
        </form>
      )}
    </>
  );
}
