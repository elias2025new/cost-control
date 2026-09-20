'use client';

import { useActionState, useState } from 'react';
import { createPurchaseRequestAction } from './actions';

export function NewPurchaseRequestForm({
  stores,
}: {
  stores: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createPurchaseRequestAction, { error: null });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-brand-600 text-white font-bold text-[13px] border border-brand-700 hover:bg-brand-700"
      >
        + New Purchase Request
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div
        className="bg-gray-100 border-2 border-gray-500 w-full max-w-md"
        style={{ boxShadow: '4px 4px 0 rgba(0,0,0,0.3)' }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-3 py-1.5 text-white text-[13px] font-bold"
          style={{ background: '#000080' }}
        >
          <span>New Purchase Request</span>
          <button onClick={() => setOpen(false)} className="text-white hover:text-gray-300 font-bold">&times;</button>
        </div>

        <form action={formAction} className="p-5 flex flex-col gap-4">
          {state.error && (
            <div className="p-2 bg-red-50 text-red-700 text-[12px] border border-red-300">
              {state.error}
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-gray-800 dark:text-zinc-200 mb-1">
              Requesting Department <span className="text-red-500">*</span>
            </label>
            <select
              name="requestingStoreId"
              required
              className="w-full border border-gray-400 dark:border-zinc-700 px-2 py-1.5 text-[13px] bg-white dark:bg-[#1c1c1c]"
            >
              <option value="">Select your department...</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-0.5">
              The items will be purchased for this department.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-1.5 text-[13px] font-medium text-gray-700 bg-gray-200 border border-gray-400 dark:border-zinc-700 hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-1.5 text-[13px] font-bold text-white bg-brand-600 border border-brand-700 hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
