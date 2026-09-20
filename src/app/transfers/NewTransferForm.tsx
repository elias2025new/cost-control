'use client';

import { useState, useTransition } from 'react';
import { createTransferAction } from './actions';

interface Store {
  id: string;
  name: string;
  code: string;
}

export function NewTransferForm({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-brand-600 text-white font-bold text-[13px] hover:bg-brand-700 border border-brand-700"
      >
        + New Transfer
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div
        className="bg-gray-100 border-2 border-gray-500 shadow-md w-full max-w-md"
        style={{ boxShadow: '4px 4px 0 rgba(0,0,0,0.3)' }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-3 py-1.5 text-white text-[13px] font-bold"
          style={{ background: '#000080' }}
        >
          <span>New Store Transfer</span>
          <button onClick={() => setOpen(false)} className="text-white hover:text-gray-300 font-bold leading-none">&times;</button>
        </div>

        <form
          action={(fd) => startTransition(() => createTransferAction(fd))}
          className="p-5 flex flex-col gap-4"
        >
          <div>
            <label className="block text-[13px] font-medium text-gray-800 dark:text-zinc-200 mb-1">From Store</label>
            <select
              name="fromStoreId"
              required
              className="w-full border border-gray-400 dark:border-zinc-700 px-2 py-1.5 text-[13px] bg-white dark:bg-[#1c1c1c]"
            >
              <option value="">— select —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-800 dark:text-zinc-200 mb-1">To Store</label>
            <select
              name="toStoreId"
              required
              className="w-full border border-gray-400 dark:border-zinc-700 px-2 py-1.5 text-[13px] bg-white dark:bg-[#1c1c1c]"
            >
              <option value="">— select —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-800 dark:text-zinc-200 mb-1">Transfer Date</label>
            <input
              type="date"
              name="occurredOn"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="w-full border border-gray-400 dark:border-zinc-700 px-2 py-1.5 text-[13px] bg-white dark:bg-[#1c1c1c]"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-gray-800 dark:text-zinc-200 mb-1">Note (optional)</label>
            <input
              type="text"
              name="note"
              placeholder="e.g. Weekly kitchen requisition"
              className="w-full border border-gray-400 dark:border-zinc-700 px-2 py-1.5 text-[13px] bg-white dark:bg-[#1c1c1c]"
            />
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
              disabled={isPending}
              className="px-4 py-1.5 text-[13px] font-bold text-white bg-brand-600 border border-brand-700 hover:bg-brand-700 disabled:opacity-50"
            >
              {isPending ? 'Creating…' : 'Create Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
