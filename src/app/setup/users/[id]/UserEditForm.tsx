'use client';

import { useActionState, useState } from 'react';
import { updateUser, setUserActive, type UserFormState } from '../actions';

export function UserEditForm({
  id,
  username,
  displayName,
  role: initialRole,
  storeId,
  permissions = [],
  stores,
}: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  storeId: string | null;
  permissions: string[];
  stores: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(updateUser, {
    error: null,
  });
  const [role, setRole] = useState(initialRole);

  return (
    <form action={action} className="px-5 py-5">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[160px]">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Name
          </span>
          <input
            name="displayName"
            defaultValue={displayName}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label className="w-36">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Username
          </span>
          <input
            name="username"
            defaultValue={username}
            autoComplete="off"
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
            <option value="store_user">Store user</option>
            <option value="admin">Administrator</option>
          </select>
        </label>

        <label className="w-44">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Store
          </span>
          <select
            name="storeId"
            defaultValue={storeId ?? ''}
            disabled={role === 'admin'}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] disabled:bg-ink-50 dark:bg-[#111111] disabled:text-ink-300"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
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
              { value: 'recipe_build', label: 'Create or Edit Recipes' },
              { value: 'recipe_cost_manage', label: 'Change Ingredient Cost (CAIC)' },
              { value: 'ledger_view', label: 'View Store Balance' },
              { value: 'variance_view', label: 'View Deviation' },
              { value: 'report_view', label: 'View Reports' },
            ].map((p) => (
              <label key={p.value} className="flex items-center gap-2 text-[13px] text-ink-900 dark:text-zinc-100 cursor-pointer">
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.value}
                  defaultChecked={permissions.includes(p.value)}
                  className="rounded border-ink-300 dark:border-zinc-600 bg-white dark:bg-[#1c1c1c]"
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="mt-4 block w-64">
        <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
          New password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="leave blank to keep current"
          className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
        />
      </label>

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

export function ActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(setUserActive, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className={
          isActive
            ? 'rounded-lg border border-rose-200 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50'
            : 'rounded-lg border border-ink-300 bg-white dark:bg-[#1c1c1c] px-4 py-2 text-[13.5px] font-medium text-ink-800 dark:text-zinc-200 hover:border-ink-400 disabled:opacity-50'
        }
      >
        {pending ? 'Saving…' : isActive ? 'Deactivate this account' : 'Reactivate this account'}
      </button>
      {state.error && (
        <p className="mt-2 max-w-md text-[12.5px] text-rose-700 leading-snug">{state.error}</p>
      )}
      <p className="text-[12px] text-ink-500 mt-3 leading-snug max-w-2xl">
        Accounts are deactivated, never deleted - their past actions stay attributable. A
        deactivated user can&rsquo;t sign in again, though an already-open session lasts until it
        expires.
      </p>
    </form>
  );
}
