'use client';

import { useActionState, useState } from 'react';
import { fulfillRequest, type FulfillFormState } from './actions';
import { cancelRequest, type RequestFormState } from '../actions';
import { qty as fmtQty } from '../../../lib/format';
import { dec } from '../../../lib/money';

export interface RequestLine {
  id: string;
  item_code: string;
  item_name: string;
  uom: string;
  requested_qty: string;
  fulfilled_qty: string | null;
  note: string | null;
  available_qty: string | null;
}

export function FulfillForm({
  requestId,
  lines,
  canRelease,
}: {
  requestId: string;
  lines: RequestLine[];
  canRelease: boolean;
}) {
  const [state, action, pending] = useActionState<FulfillFormState, FormData>(fulfillRequest, {
    error: null,
  });
  const [entered, setEntered] = useState<Record<string, string>>(
    Object.fromEntries(
      lines.map((l) => [l.id, dec(l.requested_qty).toFixed(6).replace(/\.?0+$/, '')]),
    ),
  );

  return (
    <form action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
            <tr className="text-left">
              <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                Item
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                Asked for
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                On hand there
              </th>
              <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right w-32">
                Releasing
              </th>
              <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                Note
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((l) => {
              const value = entered[l.id] ?? '';
              const available = dec(l.available_qty ?? 0);
              const short = value !== '' && dec(value).greaterThan(available);
              return (
                <tr key={l.id} className="hover:bg-ink-50 dark:bg-[#111111]/40">
                  <td className="px-5 py-2">
                    <div className="text-ink-800 dark:text-zinc-200">{l.item_name}</div>
                    <div className="font-mono text-[11px] text-ink-400">
                      {l.item_code} · {l.uom}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tnum text-ink-600">
                    {fmtQty(l.requested_qty)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tnum ${
                      short ? 'text-amber-700 font-medium' : 'text-ink-500'
                    }`}
                  >
                    {fmtQty(l.available_qty ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    {canRelease ? (
                      <input
                        name={`qty_${l.id}`}
                        value={value}
                        inputMode="decimal"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '' || /^\d*\.?\d*$/.test(v)) {
                            setEntered((s) => ({ ...s, [l.id]: v }));
                          }
                        }}
                        className="w-full rounded-md border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-2 py-1 text-right tnum text-[13px] focus:border-ink-900 focus:outline-none"
                      />
                    ) : (
                      <div className="text-right tnum text-ink-700">
                        {l.fulfilled_qty === null ? '-' : fmtQty(l.fulfilled_qty)}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2 text-ink-500">{l.note ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canRelease && (
        <div className="border-t border-ink-100 px-5 py-4 flex items-center justify-between gap-6">
          <p className="text-[12px] text-ink-500 max-w-xl">
            Releasing moves the stock now: out of the main store, into the outlet, valued at the
            main store&rsquo;s weighted average. Release less than asked for if that is all you
            have - the difference is recorded honestly rather than blocked.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-lg bg-brand-600 px-5 py-2.5 text-[13.5px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? 'Releasing…' : 'Release stock'}
          </button>
        </div>
      )}

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

export function CancelForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<RequestFormState, FormData>(cancelRequest, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13px] font-medium text-ink-700 hover:border-ink-400 disabled:opacity-50"
      >
        {pending ? 'Cancelling…' : 'Cancel this request'}
      </button>
      {state.error && (
        <p className="mt-2 text-[12.5px] text-rose-700 leading-snug">{state.error}</p>
      )}
      {state.ok && <p className="mt-2 text-[12.5px] text-brand-700">{state.ok}</p>}
    </form>
  );
}
