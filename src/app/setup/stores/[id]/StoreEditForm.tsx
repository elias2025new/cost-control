'use client';

import { useActionState } from 'react';
import { updateStore, type StoreFormState } from '../actions';

export function StoreEditForm({
  id,
  code,
  name,
  kind,
  branchId,
  branches,
}: {
  id: string;
  code: string;
  name: string;
  kind: string;
  branchId: string;
  branches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<StoreFormState, FormData>(updateStore, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-52">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Branch
          </span>
          <select
            name="branchId"
            defaultValue={branchId}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="w-32">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Code
          </span>
          <input
            name="code"
            defaultValue={code}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="flex-1 min-w-[200px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Name
          </span>
          <input
            name="name"
            defaultValue={name}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="w-36">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Kind
          </span>
          <select
            name="kind"
            defaultValue={kind}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            <option value="main">Main store</option>
            <option value="kitchen">Kitchen</option>
            <option value="bar">Bar</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}
    </form>
  );
}
