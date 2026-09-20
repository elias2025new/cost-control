'use client';

import { useActionState } from 'react';
import { login, type LoginFormState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(login, {
    error: null,
  });

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
          Username
        </span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
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
          autoComplete="current-password"
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2.5 text-[14px]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
    </form>
  );
}
