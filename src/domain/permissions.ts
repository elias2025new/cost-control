/**
 * Materials Control (HMC) User Roles & Granular Rights Architecture
 * Directly derived from HMC BESTELLER, KSTRIGHTS, and RIGHTS specifications.
 */

export type PermissionKey =
  | 'all'
  // 1. Sales & Depletion Gate
  | 'sales_eod_upload'
  | 'sales_view'
  // 2. Purchasing & Goods Receiving (GRN)
  | 'po_create'
  | 'purchase_receive'
  | 'price_override_approve'
  // 3. Requisitions & Internal Transfers
  | 'issue_request'
  | 'issue_authorize'
  | 'issue_fulfill'
  | 'transfer_manage'
  // 4. Production, Butcher Yields & Recipes
  | 'butcher_test'
  | 'production_batch'
  | 'recipe_view'
  | 'recipe_manage'
  | 'recipe_cost_manage'
  // 5. Stock Take & Recounts
  | 'count_entry'
  | 'recount_authorize'
  // 6. Waste & Spoilage Logging
  | 'waste_log'
  | 'waste_approve'
  // 7. Executive Reports & Audit
  | 'reports_view'
  | 'ledger_view'
  | 'variance_view';

export type PermissionCategory =
  | 'sales'
  | 'purchasing'
  | 'transfers'
  | 'production'
  | 'counts'
  | 'waste'
  | 'reports';

export interface PermissionDefinition {
  key: PermissionKey;
  name: string;
  category: PermissionCategory;
  description: string;
}

export const PERMISSION_CATEGORIES: { id: PermissionCategory; name: string }[] = [
  { id: 'sales', name: 'Sales & Depletion Gate' },
  { id: 'purchasing', name: 'Purchasing & 3-Way Receiving' },
  { id: 'transfers', name: 'Requisitions & Outlet Transfers' },
  { id: 'production', name: 'Production, Butcher Yields & Recipes' },
  { id: 'counts', name: 'Physical Inventory & Recounts' },
  { id: 'waste', name: 'Waste, Spoilage & Write-offs' },
  { id: 'reports', name: 'Executive Reports & Ledger Audit' },
];

export const PERMISSIONS_CATALOG: PermissionDefinition[] = [
  // 1. Sales & Depletion Gate
  {
    key: 'sales_eod_upload',
    name: 'EOD Sales Upload & Depletion',
    category: 'sales',
    description: 'Upload daily CNet sales export file, reconcile against footer, and post recipe depletions.',
  },
  {
    key: 'sales_view',
    name: 'View Sales Imports',
    category: 'sales',
    description: 'View sales import history, reconciliation status, and daily sales totals.',
  },

  // 2. Purchasing & Goods Receiving (GRN)
  {
    key: 'po_create',
    name: 'Create Purchase Orders',
    category: 'purchasing',
    description: 'Generate purchase orders from Par level replenishment calculations.',
  },
  {
    key: 'purchase_receive',
    name: 'Receive Deliveries (GRN)',
    category: 'purchasing',
    description: 'Book vendor delivery notes and perform 3-way matching against purchase orders.',
  },
  {
    key: 'price_override_approve',
    name: 'Authorize Purchase Price Variance',
    category: 'purchasing',
    description: 'Authorize receiving goods with price deviations exceeding contractual tolerance thresholds.',
  },

  // 3. Requisitions & Internal Transfers
  {
    key: 'issue_request',
    name: 'Request Outlet Stock',
    category: 'transfers',
    description: 'Create store issue requisitions from Central Store (Fill to Par).',
  },
  {
    key: 'issue_authorize',
    name: 'Authorize Department Requisitions',
    category: 'transfers',
    description: 'Department Head pre-approval of ingredient requisitions before warehouse picking.',
  },
  {
    key: 'issue_fulfill',
    name: 'Fulfill & Dispatch Issues',
    category: 'transfers',
    description: 'Pick, issue, and dispatch stock out of Central Store to outlet kitchens and bars.',
  },
  {
    key: 'transfer_manage',
    name: 'Inter-Outlet Transfers',
    category: 'transfers',
    description: 'Initiate and accept stock transfers directly between outlets (e.g. Kitchen <-> Bar).',
  },

  // 4. Production, Butcher Yields & Recipes
  {
    key: 'butcher_test',
    name: 'Butcher Carcass Yield Tests',
    category: 'production',
    description: 'Record primal cut breakdowns, byproduct valuation, and book portion cut inventory.',
  },
  {
    key: 'production_batch',
    name: 'Batch Prep Production',
    category: 'production',
    description: 'Execute batch production of prepared sub-recipes and sauces, consuming raw materials.',
  },
  {
    key: 'recipe_view',
    name: 'View Recipes & Portion Costs',
    category: 'production',
    description: 'View standard recipes, bill of materials ingredients, and calculated food cost %.',
  },
  {
    key: 'recipe_manage',
    name: 'Manage Recipe Trees',
    category: 'production',
    description: 'Create and modify standard recipes, sub-recipe nesting, and portion yields.',
  },
  {
    key: 'recipe_cost_manage',
    name: 'Change Ingredient Costs (CAIC)',
    category: 'production',
    description: 'Override base cost prices and yield loss percentages in recipe calculations.',
  },

  // 5. Stock Take & Recounts
  {
    key: 'count_entry',
    name: 'Enter Physical Counts',
    category: 'counts',
    description: 'Enter blind physical stock count sheets for scheduled inventory stock takes.',
  },
  {
    key: 'recount_authorize',
    name: 'Authorize Recount Waivers',
    category: 'counts',
    description: 'Resolve variance alerts (>500 ETB or >5%) and sign off recount discrepancy adjustments.',
  },

  // 6. Waste & Spoilage Logging
  {
    key: 'waste_log',
    name: 'Log Waste & Spoilage',
    category: 'waste',
    description: 'Record kitchen/bar waste, burnt dishes, expired bottles, and customer returns.',
  },
  {
    key: 'waste_approve',
    name: 'Approve Waste Write-offs',
    category: 'waste',
    description: 'Financial sign-off and write-off approval for waste logs into company stock ledger.',
  },

  // 7. Executive Reports & Audit
  {
    key: 'reports_view',
    name: 'View Cost Control Reports',
    category: 'reports',
    description: 'View Food & Beverage Cost Reconciliation, Cost Center Matrix, and ABC Pareto Analysis.',
  },
  {
    key: 'ledger_view',
    name: 'View Stock Ledger & Cards',
    category: 'reports',
    description: 'View immutable stock movements, chronological audit trails, and moving average costs.',
  },
  {
    key: 'variance_view',
    name: 'View Theoretical Variance Matrix',
    category: 'reports',
    description: 'View theoretical consumption vs actual consumption and cost leakage detection.',
  },
];

export type DepartmentGroup =
  | 'controller'
  | 'storekeeper'
  | 'chef'
  | 'bar'
  | 'purchasing'
  | 'management'
  | 'admin'
  | 'custom';

export type DocumentVisibility = 'all' | 'department' | 'own';

export interface DepartmentGroupConfig {
  id: DepartmentGroup;
  name: string;
  description: string;
  allStoresAccess: boolean;
  defaultStoreKind: 'main' | 'kitchen' | 'bar' | null;
  documentVisibility: DocumentVisibility;
  defaultPermissions: PermissionKey[];
}

export const HMC_DEPARTMENT_GROUPS: Record<DepartmentGroup, DepartmentGroupConfig> = {
  controller: {
    id: 'controller',
    name: 'F&B Cost Controller / Auditor',
    description: 'Full cost audit control: daily CNet sales depletions, price tolerance approvals, recount waivers, and executive reporting.',
    allStoresAccess: true,
    defaultStoreKind: null,
    documentVisibility: 'all',
    defaultPermissions: [
      'sales_eod_upload',
      'sales_view',
      'price_override_approve',
      'recount_authorize',
      'waste_approve',
      'reports_view',
      'variance_view',
      'ledger_view',
      'recipe_view',
      'recipe_cost_manage',
    ],
  },
  storekeeper: {
    id: 'storekeeper',
    name: 'Central Storekeeper',
    description: 'Central warehouse management: PO generation from Par, supplier receiving (GRN), issuing approved stock, and central stock counts.',
    allStoresAccess: false,
    defaultStoreKind: 'main',
    documentVisibility: 'all',
    defaultPermissions: [
      'po_create',
      'purchase_receive',
      'issue_fulfill',
      'transfer_manage',
      'count_entry',
      'waste_log',
      'ledger_view',
    ],
  },
  chef: {
    id: 'chef',
    name: 'Executive / Head Chef',
    description: 'Kitchen management: ingredient par requisitions, butcher yield tests, batch prep cooking, kitchen counts, and waste logging.',
    allStoresAccess: false,
    defaultStoreKind: 'kitchen',
    documentVisibility: 'department',
    defaultPermissions: [
      'issue_request',
      'issue_authorize',
      'butcher_test',
      'production_batch',
      'waste_log',
      'count_entry',
      'recipe_view',
      'ledger_view',
    ],
  },
  bar: {
    id: 'bar',
    name: 'Bar Manager / Head Bartender',
    description: 'Bar outlet operations: beverage requisitions, inter-outlet transfers, nightly bar closing counts, and beverage waste.',
    allStoresAccess: false,
    defaultStoreKind: 'bar',
    documentVisibility: 'department',
    defaultPermissions: [
      'issue_request',
      'transfer_manage',
      'waste_log',
      'count_entry',
      'recipe_view',
      'ledger_view',
    ],
  },
  purchasing: {
    id: 'purchasing',
    name: 'Purchasing Agent / Buyer',
    description: 'Procurement operations: creating purchase orders, monitoring supplier price agreements, and coordinating deliveries.',
    allStoresAccess: true,
    defaultStoreKind: null,
    documentVisibility: 'all',
    defaultPermissions: ['po_create', 'purchase_receive', 'ledger_view', 'recipe_view'],
  },
  management: {
    id: 'management',
    name: 'General Manager / Owner',
    description: 'Executive leadership: property-wide read-only access to F&B cost reports, gross profit margins, and variance matrices.',
    allStoresAccess: true,
    defaultStoreKind: null,
    documentVisibility: 'all',
    defaultPermissions: ['sales_view', 'reports_view', 'variance_view', 'ledger_view', 'recipe_view'],
  },
  admin: {
    id: 'admin',
    name: 'System Administrator',
    description: 'Unrestricted system access: user administration, master data, branch/store configuration, and all operational modules.',
    allStoresAccess: true,
    defaultStoreKind: null,
    documentVisibility: 'all',
    defaultPermissions: ['all'],
  },
  custom: {
    id: 'custom',
    name: 'Custom Role',
    description: 'Manually customized store scope and granular permissions.',
    allStoresAccess: false,
    defaultStoreKind: null,
    documentVisibility: 'department',
    defaultPermissions: [],
  },
};

export interface UserAccessContext {
  uid: string;
  role: 'admin' | 'store_user';
  departmentGroup?: DepartmentGroup;
  allStoresAccess?: boolean;
  storeId?: string | null;
  assignedStoreIds?: string[];
  permissions?: string[];
  documentVisibility?: DocumentVisibility;
}

/**
 * Evaluates whether a user has a specific operational permission.
 */
export function hasPermission(
  user: UserAccessContext | null | undefined,
  permission: PermissionKey,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.permissions?.includes('all')) return true;
  return Boolean(user.permissions?.includes(permission));
}

/**
 * Evaluates whether a user is authorized to view or act upon a specific store (HMC C/S Filter).
 */
export function canAccessStore(
  user: UserAccessContext | null | undefined,
  targetStoreId: string | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.allStoresAccess) return true;
  if (!targetStoreId) return false;
  if (user.storeId === targetStoreId) return true;
  if (user.assignedStoreIds && user.assignedStoreIds.includes(targetStoreId)) return true;
  return false;
}

/**
 * Evaluates whether a user can view a document based on HMC Document Visibility (All | Department | Own).
 */
export function canViewDocument(
  user: UserAccessContext | null | undefined,
  doc: {
    ownerId?: string | null;
    storeId?: string | null;
  },
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const visibility = user.documentVisibility ?? 'department';
  if (visibility === 'all') return true;
  if (visibility === 'own') return Boolean(doc.ownerId && doc.ownerId === user.uid);

  // 'department': can view if document belongs to an accessible store
  if (visibility === 'department') {
    if (!doc.storeId) return Boolean(doc.ownerId && doc.ownerId === user.uid);
    return canAccessStore(user, doc.storeId);
  }

  return false;
}
