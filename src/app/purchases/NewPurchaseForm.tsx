'use client';

import { useActionState, useState } from 'react';
import { createPurchaseAction } from './actions';

export function NewPurchaseForm({
  stores,
  suppliers,
}: {
  stores: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createPurchaseAction, { error: null });
  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-green-600 text-white text-[13px] font-bold rounded shadow hover:bg-green-700 active:bg-green-800 transition-colors"
      >
        + New Purchase
      </button>
    );
  }

  return (
    <div className="bg-white dark:bg-[#1c1c1c] border border-gray-300 dark:border-zinc-700 rounded shadow-sm p-4 w-full max-w-2xl mb-6">
      <div className="flex items-center justify-between mb-4 border-b border-gray-200 pb-2">
        <h2 className="text-[14px] font-bold text-gray-900 dark:text-zinc-100">New Purchase Receipt</h2>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-600 font-bold"
        >
          ✕
        </button>
      </div>

      <form action={formAction} className="space-y-4">
        {state.error && (
          <div className="p-2 bg-red-50 text-red-700 text-[13px] rounded border border-red-200">
            {state.error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <label className="block text-[13px] font-medium text-gray-700">
            Receiving Store
            <select
              name="storeId"
              required
              className="mt-1 block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px]"
            >
              <option value="">Select store...</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[13px] font-medium text-gray-700">
            Receipt Date
            <input
              type="date"
              name="occurredOn"
              required
              defaultValue={today}
              className="mt-1 block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px]"
            />
          </label>

          <label className="block text-[13px] font-medium text-gray-700">
            Supplier
            <select
              name="supplierId"
              required
              className="mt-1 block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px]"
            >
              <option value="">Select supplier...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[13px] font-medium text-gray-700">
            Invoice / Reference No.
            <input
              type="text"
              name="referenceNumber"
              placeholder="Optional"
              className="mt-1 block w-full rounded border-gray-300 dark:border-zinc-700 shadow-sm focus:border-green-500 focus:ring-green-500 text-[13px]"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-[13px] font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 text-[13px] font-bold text-white bg-green-600 rounded shadow hover:bg-green-700 disabled:opacity-50"
          >
            {pending ? 'Saving...' : 'Create & Add Items'}
          </button>
        </div>
      </form>
    </div>
  );
}
