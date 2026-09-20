'use client';

import { useActionState } from 'react';
import { loadDemoData, type TenantFormState } from './actions';

export function DemoDataButton() {
  const [state, action, pending] = useActionState<TenantFormState, FormData>(loadDemoData, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5">
      <p className="text-[13px] text-ink-600 leading-relaxed max-w-2xl mb-3">
        Loads the client&rsquo;s real 171 POS articles, plus sample recipes, costs, and opening
        stock - the same fixture the test suite runs against. Every recipe and cost it creates is
        flagged as a sample, not your real figures.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50"
      >
        {pending ? 'Loading…' : 'Load demo data'}
      </button>

      {state.error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
    </form>
  );
}
