'use client';

import { useActionState, useState } from 'react';
import { createUser, type UserFormState } from './actions';

export function UserForm({ stores }: { stores: { id: string; name: string; kind: string }[] }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(createUser, {
    error: null,
  });
  // A store user needs somewhere to work. Until a store exists, only an
  // administrator can be created - which is fine, since an admin has no
  // store by design.
  const hasStores = stores.length > 0;
  const [role, setRole] = useState(hasStores ? 'store_user' : 'admin');

  return (
    <form action={action} className="px-5 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[160px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Name
          </span>
          <input
            name="displayName"
            placeholder="Almaz"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="w-36">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Username
          </span>
          <input
            name="username"
            autoComplete="off"
            placeholder="almaz"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="w-40">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Password
          </span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="w-36">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Role
          </span>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          >
            <option value="store_user" disabled={!hasStores}>
              Store user
            </option>
            <option value="admin">Administrator</option>
          </select>
        </label>

        <label className="w-44">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store
          </span>
          <select
            name="storeId"
            disabled={role === 'admin' || !hasStores}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] disabled:bg-ink-50 dark:bg-[#111111] disabled:text-ink-300"
          >
            {hasStores ? (
              stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            ) : (
              <option value="">No stores yet</option>
            )}
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 px-4 py-2 text-[13.5px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Add user'}
        </button>
      </div>

      {role === 'store_user' && (
        <div className="mt-5 p-4 rounded-lg border border-ink-200 dark:border-zinc-700 bg-ink-50 dark:bg-zinc-900">
          <span className="block text-[12px] uppercase tracking-wider text-ink-500 font-semibold mb-3">
            Permissions
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { value: 'all', label: 'All Permissions' },
              { value: 'issue_create', label: 'Create Stock Requests' },
              { value: 'issue_authorize', label: 'Authorize Stock Requests' },
              { value: 'recipe_view', label: 'View Recipes' },
              { value: 'recipe_manage', label: 'Manage Recipes' },
              { value: 'ledger_view', label: 'View Store Balance' },
              { value: 'variance_view', label: 'View Deviation' },
              { value: 'report_view', label: 'View Reports' },
            ].map((p) => (
              <label key={p.value} className="flex items-center gap-2 text-[13px] text-ink-900 dark:text-zinc-100 cursor-pointer">
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.value}
                  className="rounded border-ink-300 dark:border-zinc-600 bg-white dark:bg-[#1c1c1c]"
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}

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

      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-3xl">
        An administrator sees everything and manages accounts. A store user only sees their own
        store&rsquo;s stock and counts.
        {!hasStores && ' Add a store first to be able to create store users.'}
      </p>
    </form>
  );
}
