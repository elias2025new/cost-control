'use client';

import { useActionState } from 'react';
import { createAdmin, type CreateAdminFormState } from './actions';

export function AdminForm() {
  const [state, action, pending] = useActionState<CreateAdminFormState, FormData>(createAdmin, {
    error: null,
  });

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
          Your name
        </span>
        <input
          name="displayName"
          placeholder="Eyob"
          autoFocus
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2.5 text-[14px]"
        />
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
          Username
        </span>
        <input
          name="username"
          autoComplete="username"
          placeholder="admin"
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2.5 text-[14px]"
        />
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2.5 text-[14px]"
        />
        <span className="block text-[11px] text-ink-400 mt-1">At least 8 characters.</span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create admin account'}
      </button>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
    </form>
  );
}
