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
}

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
  const [entered, setEntered] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((l) => [l.stock_count_line_id, l.counted_qty ? new Decimal(l.counted_qty).toFixed(6).replace(/\.?0+$/, '') : '']),
    ),
  );
  const [saveState, saveAction, saving] = useActionState<CountEntryState, FormData>(saveCount, {
    error: null,
  });
  const [postState, postAction, posting] = useActionState<CountEntryState, FormData>(postCount, {
    error: null,
  });

  const countedCount = Object.values(entered).filter((v) => v !== '').length;
  const totalVariance = lines.reduce((sum, l) => {
    const v = entered[l.stock_count_line_id] ?? '';
    if (v === '') return sum;
    const { variance } = grade(new Decimal(l.theoretical_qty), v);
    return sum.plus(variance.times(new Decimal(l.unit_cost)));
  }, new Decimal(0));

  return (
    <>
      <form action={saveAction}>
        <input type="hidden" name="countId" value={countId} />

        <div className="overflow-x-auto max-h-[560px] overflow-y-auto sticky-head">
          <table className="w-full text-[13px]">
            <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                  Item
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                  Theoretical
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111] w-32">
                  Counted
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                  Variance
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                  Value
                </th>
                <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                  Status
                </th>
                <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111] w-64">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {lines.map((l) => {
                const value = entered[l.stock_count_line_id] ?? '';
                const theoretical = new Decimal(l.theoretical_qty);
                const { status, variance } = grade(theoretical, value);
                const varianceValue = variance.times(new Decimal(l.unit_cost));

                return (
                  <tr key={l.stock_count_line_id} className="hover:bg-ink-50 dark:bg-[#111111]/40">
                    <td className="px-5 py-2">
                      <div className="text-ink-800 dark:text-zinc-200">{l.item_name}</div>
                      <div className="font-mono text-[11px] text-ink-400">
                        {l.item_code} · {l.uom} · {etb(l.unit_cost)}/{l.uom}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-600">
                      {qty(l.theoretical_qty)}
                    </td>
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
                        className={`w-full rounded-md border px-2 py-1 text-right tnum text-[13px] ${
                          readOnly
                            ? 'border-transparent bg-transparent text-ink-700'
                            : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] focus:border-ink-900 focus:outline-none'
                        }`}
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right tnum ${
                        value === ''
                          ? 'text-ink-300'
                          : variance.isZero()
                            ? 'text-ink-500'
                            : variance.isNegative()
                              ? 'text-rose-700'
                              : 'text-brand-700'
                      }`}
                    >
                      {value === '' ? '-' : `${variance.greaterThan(0) ? '+' : ''}${qty(variance)}`}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-ink-700">
                      {value === '' ? '-' : etb(varianceValue)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-2">
                      <input
                        name={`note_${l.stock_count_line_id}`}
                        defaultValue={l.note ?? ''}
                        readOnly={readOnly}
                        placeholder={readOnly ? '' : 'why is it different?'}
                        className={`w-full rounded-md border px-2 py-1 text-[12.5px] ${
                          readOnly
                            ? 'border-transparent bg-transparent text-ink-600'
                            : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] focus:border-ink-900 focus:outline-none'
                        }`}
                      />
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
              <span className="tnum">{lines.length}</span> counted · net variance{' '}
              <span
                className={`tnum font-medium ${
                  totalVariance.isNegative() ? 'text-rose-700' : 'text-ink-900 dark:text-zinc-100'
                }`}
              >
                {etb(totalVariance)} ETB
              </span>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50"
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
              Posting writes one adjustment per line that differs, and freezes the sheet. Save
              your entries first - only what is saved will post.
            </p>
            <button
              type="submit"
              disabled={posting || countedCount === 0}
              className={`shrink-0 rounded-lg px-5 py-2.5 text-[13.5px] font-medium transition-colors ${
                countedCount > 0 && !posting
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-ink-200 text-ink-400 cursor-not-allowed'
              }`}
            >
              {posting ? 'Posting…' : 'Post count'}
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
