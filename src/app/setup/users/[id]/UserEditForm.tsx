'use client';

import { useActionState, useState } from 'react';
import { updateUser, setUserActive, type UserFormState } from '../actions';
import {
  HMC_DEPARTMENT_GROUPS,
  PERMISSIONS_CATALOG,
  PERMISSION_CATEGORIES,
  type DepartmentGroup,
  type PermissionKey,
  type DocumentVisibility,
} from '../../../../domain/permissions';

export function UserEditForm({
  id,
  username,
  displayName,
  role: initialRole,
  storeId: initialStoreId,
  permissions = [],
  departmentGroup: initialDeptGroup = 'custom',
  allStoresAccess: initialAllStores = false,
  assignedStoreIds: initialAssignedStores = [],
  documentVisibility: initialDocVis = 'department',
  stores,
}: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  storeId: string | null;
  permissions: string[];
  departmentGroup?: string;
  allStoresAccess?: boolean;
  assignedStoreIds?: string[];
  documentVisibility?: 'all' | 'department' | 'own';
  stores: { id: string; name: string; kind: string }[];
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(updateUser, {
    error: null,
  });

  const [deptGroup, setDeptGroup] = useState<DepartmentGroup>(
    (initialDeptGroup as DepartmentGroup) in HMC_DEPARTMENT_GROUPS
      ? (initialDeptGroup as DepartmentGroup)
      : 'custom',
  );
  const [allStores, setAllStores] = useState(Boolean(initialAllStores || initialRole === 'admin'));
  const [docVis, setDocVis] = useState<DocumentVisibility>(initialDocVis ?? 'department');
  const [primaryStoreId, setPrimaryStoreId] = useState(initialStoreId ?? '');
  const [assignedStores, setAssignedStores] = useState<string[]>(
    initialAssignedStores.length > 0 ? initialAssignedStores : initialStoreId ? [initialStoreId] : [],
  );
  const [selectedPerms, setSelectedPerms] = useState<string[]>(permissions);

  const handleGroupChange = (grp: DepartmentGroup) => {
    setDeptGroup(grp);
    const config = HMC_DEPARTMENT_GROUPS[grp];
    setAllStores(config.allStoresAccess);
    setDocVis(config.documentVisibility);
    setSelectedPerms(config.defaultPermissions as string[]);

    if (config.defaultStoreKind) {
      const match = stores.find((s) => s.kind === config.defaultStoreKind);
      if (match) {
        setPrimaryStoreId(match.id);
        setAssignedStores([match.id]);
      }
    } else if (config.allStoresAccess) {
      setPrimaryStoreId('');
      setAssignedStores([]);
    }
  };

  const togglePermission = (key: string) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const selectCategoryPerms = (category: string, select: boolean) => {
    const catKeys = PERMISSIONS_CATALOG.filter((p) => p.category === category).map((p) => p.key);
    setSelectedPerms((prev) => {
      const without = prev.filter((p) => !catKeys.includes(p as PermissionKey));
      return select ? [...without, ...catKeys] : without;
    });
  };

  const toggleAssignedStore = (id: string) => {
    setAssignedStores((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  return (
    <form action={action} className="px-6 py-6 space-y-6">
      <input type="hidden" name="id" value={id} />

      {/* 1. Identity & Credentials */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Full Name
          </span>
          <input
            name="displayName"
            required
            defaultValue={displayName}
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Login Username
          </span>
          <input
            name="username"
            required
            defaultValue={username}
            autoComplete="off"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Change Password
          </span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="leave blank to keep current"
            className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
          />
        </label>

        <label>
          <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
            Department / User Group (HMC)
          </span>
          <select
            name="departmentGroup"
            value={deptGroup}
            onChange={(e) => handleGroupChange(e.target.value as DepartmentGroup)}
            className="w-full rounded-lg border border-brand-300 dark:border-brand-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px] font-medium text-brand-700 dark:text-brand-300"
          >
            {Object.values(HMC_DEPARTMENT_GROUPS).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-[12px] text-ink-500 -mt-2">
        {HMC_DEPARTMENT_GROUPS[deptGroup].description}
      </p>

      {/* Hidden input for role */}
      <input
        type="hidden"
        name="role"
        value={deptGroup === 'admin' ? 'admin' : 'store_user'}
      />

      {/* 2. HMC Cost Center / Store Filter (KGT_ALLKST & C/S Filter) */}
      <div className="p-4 rounded-xl border border-ink-200 dark:border-zinc-800 bg-ink-50/50 dark:bg-zinc-900/50 space-y-4">
        <div className="flex items-center justify-between border-b border-ink-200/60 dark:border-zinc-800 pb-3">
          <div>
            <span className="text-[12px] uppercase tracking-wider text-ink-700 dark:text-zinc-200 font-semibold">
              Cost Center & Store Access (HMC C/S Filter)
            </span>
            <p className="text-[12px] text-ink-500">
              Control which stores and inventory outlets this user can access.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-zinc-800 px-3 py-1.5 rounded-lg border border-ink-200 dark:border-zinc-700 shadow-sm">
            <input
              type="checkbox"
              name="allStoresAccess"
              checked={allStores}
              onChange={(e) => setAllStores(e.target.checked)}
              className="rounded border-ink-300 dark:border-zinc-600 text-brand-600"
            />
            <span className="text-[12.5px] font-semibold text-ink-900 dark:text-zinc-100">
              All Stores (Company-wide)
            </span>
          </label>
        </div>

        {!allStores && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
                Primary / Default Store
              </span>
              <select
                name="storeId"
                value={primaryStoreId}
                onChange={(e) => {
                  setPrimaryStoreId(e.target.value);
                  if (e.target.value && !assignedStores.includes(e.target.value)) {
                    setAssignedStores([...assignedStores, e.target.value]);
                  }
                }}
                className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-2 text-[13.5px]"
              >
                <option value="">Choose primary store...</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.kind})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
                Authorized Stores (Multiple Outlets)
              </span>
              <div className="flex flex-wrap gap-2 pt-1">
                {stores.map((s) => (
                  <label
                    key={s.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] border cursor-pointer ${
                      assignedStores.includes(s.id)
                        ? 'bg-brand-50 border-brand-300 text-brand-800 dark:bg-brand-950 dark:border-brand-700 dark:text-brand-200'
                        : 'bg-white border-ink-200 text-ink-600 dark:bg-zinc-800 dark:border-zinc-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="assignedStoreIds"
                      value={s.id}
                      checked={assignedStores.includes(s.id)}
                      onChange={() => toggleAssignedStore(s.id)}
                      className="sr-only"
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Document Visibility */}
        <div className="pt-2 border-t border-ink-200/60 dark:border-zinc-800 flex items-center gap-6">
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
            Document Visibility:
          </span>
          <div className="flex gap-4">
            {(['all', 'department', 'own'] as DocumentVisibility[]).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 text-[12.5px] cursor-pointer">
                <input
                  type="radio"
                  name="documentVisibility"
                  value={mode}
                  checked={docVis === mode}
                  onChange={() => setDocVis(mode)}
                  className="text-brand-600"
                />
                <span className="capitalize text-ink-800 dark:text-zinc-200">{mode} Documents</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Granular Operational Permissions Matrix (RIGHTS) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[12px] uppercase tracking-wider text-ink-700 dark:text-zinc-200 font-semibold">
              Operational Rights Matrix (HMC Functional Permissions)
            </span>
            <p className="text-[12px] text-ink-500">
              Check specific rights for this user.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (selectedPerms.length === PERMISSIONS_CATALOG.length) {
                setSelectedPerms([]);
              } else {
                setSelectedPerms(PERMISSIONS_CATALOG.map((p) => p.key));
              }
            }}
            className="text-[12px] text-brand-600 hover:text-brand-700 font-medium"
          >
            {selectedPerms.length === PERMISSIONS_CATALOG.length ? 'Clear All Rights' : 'Select All Rights'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PERMISSION_CATEGORIES.map((cat) => {
            const catPerms = PERMISSIONS_CATALOG.filter((p) => p.category === cat.id);
            const allChecked = catPerms.every((p) => selectedPerms.includes(p.key));

            return (
              <div
                key={cat.id}
                className="rounded-xl border border-ink-200 dark:border-zinc-800 bg-white dark:bg-[#1a1a1a] p-4 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-ink-100 dark:border-zinc-800/80 pb-2">
                  <span className="text-[11.5px] uppercase tracking-wider font-semibold text-ink-700 dark:text-zinc-300">
                    {cat.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectCategoryPerms(cat.id, !allChecked)}
                    className="text-[11px] text-ink-400 hover:text-brand-600"
                  >
                    {allChecked ? 'none' : 'all'}
                  </button>
                </div>

                <div className="space-y-2">
                  {catPerms.map((perm) => (
                    <label
                      key={perm.key}
                      className="flex items-start gap-2.5 text-[12.5px] cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        name="permissions"
                        value={perm.key}
                        checked={selectedPerms.includes('all') || selectedPerms.includes(perm.key)}
                        onChange={() => togglePermission(perm.key)}
                        className="rounded border-ink-300 dark:border-zinc-600 text-brand-600 mt-0.5"
                      />
                      <div>
                        <span className="font-medium text-ink-900 dark:text-zinc-100 group-hover:text-brand-600">
                          {perm.name}
                        </span>
                        <p className="text-[11px] text-ink-400 leading-tight">
                          {perm.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {state.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
          {state.ok}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-900 dark:bg-zinc-100 px-5 py-2.5 text-[13.5px] font-medium text-white dark:text-ink-900 hover:bg-ink-800 disabled:opacity-50 shadow-sm"
        >
          {pending ? 'Saving Changes…' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}

export function ActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(setUserActive, {
    error: null,
  });

  return (
    <form action={action} className="px-5 py-4 flex items-center justify-between">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />
      <div className="text-[13px] text-ink-600 dark:text-zinc-300">
        {isActive
          ? 'Deactivating blocks future logins while preserving audit trails in the stock ledger.'
          : 'Reactivating allows this person to sign in again with their previous permissions.'}
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
          isActive
            ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
        } disabled:opacity-50`}
      >
        {pending ? 'Updating…' : isActive ? 'Deactivate account' : 'Reactivate account'}
      </button>
    </form>
  );
}
