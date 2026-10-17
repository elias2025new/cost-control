'use client';

import { useActionState, useState } from 'react';
import { login, type LoginFormState } from './actions';

interface StaffPreset {
  username: string;
  roleTitle: string;
  department: string;
  icon: string;
  scope: string;
  responsibilities: string;
}

const STAFF_PRESETS: StaffPreset[] = [
  {
    username: 'storekeeper',
    roleTitle: 'Storekeeper',
    department: 'Central Store',
    icon: '📦',
    scope: 'Central Warehouse (MAIN)',
    responsibilities: 'Requisition fulfillment, goods receiving (GRN), transfer dispatches',
  },
  {
    username: 'chef',
    roleTitle: 'Executive Chef',
    department: 'Main Kitchen',
    icon: '🍳',
    scope: 'Kitchen Cost Center (KITCHEN)',
    responsibilities: 'Daily par requests, butcher tests, batch cooking, waste logs',
  },
  {
    username: 'bar',
    roleTitle: 'Bar Manager',
    department: 'Main Bar',
    icon: '🍸',
    scope: 'Bar Cost Center (BAR)',
    responsibilities: 'Daily par requests, inter-outlet transfers, bar counts, waste logs',
  },
  {
    username: 'controller',
    roleTitle: 'Cost Controller',
    department: 'Finance & Audit',
    icon: '📊',
    scope: 'All Stores (Company-wide)',
    responsibilities: 'EOD CNet sales upload, recipe depletions, recount sign-offs, executive reports',
  },
  {
    username: 'admin',
    roleTitle: 'General Manager / Admin',
    department: 'Management',
    icon: '🛡️',
    scope: 'Full Property',
    responsibilities: 'Full system administration, master data, user permissions',
  },
];

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(login, {
    error: null,
  });

  const [username, setUsername] = useState('controller');
  const [password, setPassword] = useState('password123');

  const selectPreset = (preset: StaffPreset) => {
    setUsername(preset.username);
    setPassword('password123');
  };

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Username
          </span>
          <input
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2.5 text-[14px]"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-ink-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2.5 text-[13.5px] font-medium hover:bg-ink-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
        >
          {pending ? 'Signing in…' : `Sign in as ${username || 'User'}`}
        </button>

        {state.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
            {state.error}
          </div>
        )}
      </form>

      {/* Staff Persona Quick-Select */}
      <div className="pt-2 border-t border-ink-100 dark:border-zinc-800">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-2.5 flex items-center justify-between">
          <span>Role-Based Access Presets</span>
          <span className="text-[10px] lowercase text-ink-400">click to populate</span>
        </div>
        <div className="space-y-1.5">
          {STAFF_PRESETS.map((p) => {
            const isSelected = username === p.username;
            return (
              <button
                key={p.username}
                type="button"
                onClick={() => selectPreset(p)}
                className={`w-full text-left p-2 rounded-lg border transition-all text-[12px] flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20 text-brand-950 dark:text-zinc-100 ring-1 ring-brand-500/30'
                    : 'border-ink-100 dark:border-zinc-800 hover:bg-ink-50 dark:hover:bg-zinc-800/50 text-ink-700 dark:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[14px]">{p.icon}</span>
                  <div className="truncate">
                    <div className="font-semibold text-ink-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <span>{p.roleTitle}</span>
                      <span className="font-mono text-[10.5px] text-ink-400 font-normal">
                        ({p.username})
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate">
                      {p.responsibilities}
                    </div>
                  </div>
                </div>
                <div className="text-right whitespace-nowrap text-[11px] font-mono text-ink-400">
                  {p.scope.split(' ')[0]}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

