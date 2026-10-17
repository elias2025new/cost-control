import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  HMC_DEPARTMENT_GROUPS,
  PERMISSIONS_CATALOG,
  hasPermission,
  canAccessStore,
  canViewDocument,
  type UserAccessContext,
} from '../src/domain/permissions';

describe('Materials Control (HMC) User Roles & Permissions Architecture', () => {
  let harness: Harness;
  let db: Database;
  let tenantId: string;
  let stores: Record<string, string>;

  beforeAll(async () => {
    harness = await seededDb();
    db = harness.db;
    tenantId = harness.seeded.tenantId;
    stores = harness.seeded.storeIds;
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('1. HMC Department Groups Specification (BESTELLER / KSTRIGHTS / RIGHTS)', () => {
    it('defines authentic department groups with correct store scoping policies', () => {
      const controller = HMC_DEPARTMENT_GROUPS.controller;
      expect(controller.allStoresAccess).toBe(true);
      expect(controller.documentVisibility).toBe('all');
      expect(controller.defaultPermissions).toContain('sales_eod_upload');
      expect(controller.defaultPermissions).toContain('recount_authorize');
      expect(controller.defaultPermissions).toContain('reports_view');

      const chef = HMC_DEPARTMENT_GROUPS.chef;
      expect(chef.allStoresAccess).toBe(false);
      expect(chef.defaultStoreKind).toBe('kitchen');
      expect(chef.documentVisibility).toBe('department');
      expect(chef.defaultPermissions).toContain('issue_request');
      expect(chef.defaultPermissions).toContain('butcher_test');
      expect(chef.defaultPermissions).toContain('production_batch');

      const storekeeper = HMC_DEPARTMENT_GROUPS.storekeeper;
      expect(storekeeper.allStoresAccess).toBe(false);
      expect(storekeeper.defaultStoreKind).toBe('main');
      expect(storekeeper.defaultPermissions).toContain('purchase_receive');
      expect(storekeeper.defaultPermissions).toContain('issue_fulfill');

      const bar = HMC_DEPARTMENT_GROUPS.bar;
      expect(bar.allStoresAccess).toBe(false);
      expect(bar.defaultStoreKind).toBe('bar');
      expect(bar.defaultPermissions).toContain('issue_request');
      expect(bar.defaultPermissions).toContain('transfer_manage');

      const management = HMC_DEPARTMENT_GROUPS.management;
      expect(management.allStoresAccess).toBe(true);
      expect(management.documentVisibility).toBe('all');
      expect(management.defaultPermissions).toContain('reports_view');
      expect(management.defaultPermissions).toContain('variance_view');
    });

    it('contains all 21 canonical F&B operational rights across 7 categories', () => {
      expect(PERMISSIONS_CATALOG.length).toBe(21);
      const keys = PERMISSIONS_CATALOG.map((p) => p.key);

      // Verify core operational pillars are covered
      expect(keys).toContain('sales_eod_upload');
      expect(keys).toContain('purchase_receive');
      expect(keys).toContain('issue_request');
      expect(keys).toContain('issue_fulfill');
      expect(keys).toContain('butcher_test');
      expect(keys).toContain('production_batch');
      expect(keys).toContain('count_entry');
      expect(keys).toContain('recount_authorize');
      expect(keys).toContain('waste_log');
      expect(keys).toContain('waste_approve');
      expect(keys).toContain('reports_view');
    });
  });

  describe('2. Permission & Rights Evaluators', () => {
    it('evaluates hasPermission correctly based on role and permissions array', () => {
      const admin: UserAccessContext = { uid: 'u1', role: 'admin' };
      expect(hasPermission(admin, 'sales_eod_upload')).toBe(true);
      expect(hasPermission(admin, 'recount_authorize')).toBe(true);

      const chef: UserAccessContext = {
        uid: 'u2',
        role: 'store_user',
        departmentGroup: 'chef',
        permissions: ['issue_request', 'butcher_test'],
      };
      expect(hasPermission(chef, 'issue_request')).toBe(true);
      expect(hasPermission(chef, 'butcher_test')).toBe(true);
      expect(hasPermission(chef, 'sales_eod_upload')).toBe(false);
      expect(hasPermission(chef, 'recount_authorize')).toBe(false);
    });

    it('evaluates canAccessStore correctly for HMC C/S Filter & All-Stores Flag (KGT_ALLKST)', () => {
      const controller: UserAccessContext = {
        uid: 'u1',
        role: 'store_user',
        allStoresAccess: true,
      };
      expect(canAccessStore(controller, stores.MAIN)).toBe(true);
      expect(canAccessStore(controller, stores.KITCHEN)).toBe(true);
      expect(canAccessStore(controller, stores.BAR)).toBe(true);

      const chef: UserAccessContext = {
        uid: 'u2',
        role: 'store_user',
        allStoresAccess: false,
        storeId: stores.KITCHEN,
        assignedStoreIds: [stores.KITCHEN],
      };
      expect(canAccessStore(chef, stores.KITCHEN)).toBe(true);
      expect(canAccessStore(chef, stores.BAR)).toBe(false);
      expect(canAccessStore(chef, stores.MAIN)).toBe(false);

      // Multi-store user (e.g. Relief Chef managing Kitchen and Pastry)
      const reliefChef: UserAccessContext = {
        uid: 'u3',
        role: 'store_user',
        allStoresAccess: false,
        storeId: stores.KITCHEN,
        assignedStoreIds: [stores.KITCHEN, stores.BAR],
      };
      expect(canAccessStore(reliefChef, stores.KITCHEN)).toBe(true);
      expect(canAccessStore(reliefChef, stores.BAR)).toBe(true);
      expect(canAccessStore(reliefChef, stores.MAIN)).toBe(false);
    });

    it('evaluates canViewDocument based on HMC Document Visibility (All | Department | Own)', () => {
      const controller: UserAccessContext = {
        uid: 'c1',
        role: 'store_user',
        allStoresAccess: true,
        documentVisibility: 'all',
      };
      expect(canViewDocument(controller, { ownerId: 'other-user', storeId: stores.KITCHEN })).toBe(true);

      const chef: UserAccessContext = {
        uid: 'chef-1',
        role: 'store_user',
        allStoresAccess: false,
        storeId: stores.KITCHEN,
        assignedStoreIds: [stores.KITCHEN],
        documentVisibility: 'department',
      };
      // Can view kitchen documents, even if created by another kitchen cook
      expect(canViewDocument(chef, { ownerId: 'cook-2', storeId: stores.KITCHEN })).toBe(true);
      // Cannot view bar documents
      expect(canViewDocument(chef, { ownerId: 'bartender-1', storeId: stores.BAR })).toBe(false);

      // User with 'own' visibility
      const trainee: UserAccessContext = {
        uid: 'trainee-1',
        role: 'store_user',
        allStoresAccess: false,
        storeId: stores.KITCHEN,
        documentVisibility: 'own',
      };
      expect(canViewDocument(trainee, { ownerId: 'trainee-1', storeId: stores.KITCHEN })).toBe(true);
      expect(canViewDocument(trainee, { ownerId: 'cook-2', storeId: stores.KITCHEN })).toBe(false);
    });
  });

  describe('3. Database Persistence & HMC Schema Verification (Migration 026)', () => {
    it('verifies users carry HMC department group and store access defaults', async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into users (tenant_id, username, password_hash, display_name, role)
         values ($1, 'admin_test', 'hash123', 'Admin Tester', 'admin')
         returning id`,
        [tenantId],
      );
      expect(rows.length).toBe(1);

      const { rows: fetched } = await db.query<{
        department_group: string;
        all_stores_access: boolean;
        document_visibility: string;
      }>(
        `select department_group, all_stores_access, document_visibility
           from users where id = $1`,
        [rows[0].id],
      );

      expect(fetched.length).toBe(1);
      // Migration 026 sets default values
      expect(fetched[0].department_group).toBeDefined();
      expect(typeof fetched[0].all_stores_access).toBe('boolean');
      expect(fetched[0].document_visibility).toBeDefined();
    });

    it('creates a Cost Controller with all-stores access and no single store constraint', async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into users (
           tenant_id, username, password_hash, display_name, role, store_id,
           permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
         )
         values ($1, $2, $3, $4, $5, null, $6, $7, $8, $9, $10)
         returning id`,
        [
          tenantId,
          'controller_test',
          'dummy_hash',
          'Test Controller',
          'store_user',
          JSON.stringify(['sales_eod_upload', 'recount_authorize', 'reports_view']),
          'controller',
          true,
          JSON.stringify([]),
          'all',
        ],
      );

      expect(rows.length).toBe(1);
      const id = rows[0].id;

      const { rows: fetched } = await db.query<{
        department_group: string;
        all_stores_access: boolean;
        store_id: string | null;
      }>(`select department_group, all_stores_access, store_id from users where id = $1`, [id]);

      expect(fetched[0].department_group).toBe('controller');
      expect(fetched[0].all_stores_access).toBe(true);
      expect(fetched[0].store_id).toBeNull();
    });

    it('creates an Executive Chef with kitchen store scoping and C/S filter', async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into users (
           tenant_id, username, password_hash, display_name, role, store_id,
           permissions, department_group, all_stores_access, assigned_store_ids, document_visibility
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          tenantId,
          'chef_test',
          'dummy_hash',
          'Head Chef Tariku',
          'store_user',
          stores.KITCHEN,
          JSON.stringify(['issue_request', 'butcher_test', 'production_batch']),
          'chef',
          false,
          JSON.stringify([stores.KITCHEN]),
          'department',
        ],
      );

      expect(rows.length).toBe(1);
      const id = rows[0].id;

      const { rows: fetched } = await db.query<{
        department_group: string;
        all_stores_access: boolean;
        store_id: string;
        assigned_store_ids: string[];
      }>(`select department_group, all_stores_access, store_id, assigned_store_ids from users where id = $1`, [id]);

      expect(fetched[0].department_group).toBe('chef');
      expect(fetched[0].all_stores_access).toBe(false);
      expect(fetched[0].store_id).toBe(stores.KITCHEN);
      expect(fetched[0].assigned_store_ids).toContain(stores.KITCHEN);
    });
  });
});
