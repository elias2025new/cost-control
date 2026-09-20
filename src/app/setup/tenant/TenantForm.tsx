'use client';

import { useActionState } from 'react';
import { createTenant, type TenantFormState } from './actions';

export function TenantForm() {
  const [state, action, pending] = useActionState<TenantFormState, FormData>(createTenant, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-40">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Code
          </span>
          <input
            name="code"
            placeholder="PRIME"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="flex-1 min-w-[240px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Name
          </span>
          <input
            name="name"
            placeholder="Prime Hospitality Business Group"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create tenant'}
        </button>
      </div>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}

      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-3xl">
        Currency is fixed at ETB. Everything else - branches, stores, items, recipes - belongs to
        this tenant.
      </p>
    </form>
  );
}
