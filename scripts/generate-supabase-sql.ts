import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  BRANCH,
  SEED_STAFF_USERS,
  STORES,
  TENANT,
} from '../db/seed/data';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function generate() {
  const lines: string[] = [];

  lines.push(`-- =============================================================================`);
  lines.push(`-- Prime Hospitality F&B Cost Control ERP — Clean-Slate Supabase Setup`);
  lines.push(`-- =============================================================================`);
  lines.push(`-- Target: Supabase PostgreSQL (SQL Editor)`);
  lines.push(`-- Status: Clean Slate (Tenant, 4 Stores, 5 HMC Staff Accounts, 0 Sample Data)`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- =============================================================================\n`);

  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`-- 1. Reset Schema & Permissions`);
  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`DROP SCHEMA IF EXISTS public CASCADE;`);
  lines.push(`CREATE SCHEMA public;`);
  lines.push(`GRANT ALL ON SCHEMA public TO public;`);
  lines.push(`COMMENT ON SCHEMA public IS 'standard public schema';\n`);
  lines.push(`DO $$`);
  lines.push(`BEGIN`);
  lines.push(`  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN`);
  lines.push(`    GRANT ALL ON SCHEMA public TO postgres;`);
  lines.push(`  END IF;`);
  lines.push(`  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN`);
  lines.push(`    GRANT USAGE, CREATE ON SCHEMA public TO anon;`);
  lines.push(`  END IF;`);
  lines.push(`  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN`);
  lines.push(`    GRANT USAGE, CREATE ON SCHEMA public TO authenticated;`);
  lines.push(`  END IF;`);
  lines.push(`  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN`);
  lines.push(`    GRANT ALL ON SCHEMA public TO service_role;`);
  lines.push(`  END IF;`);
  lines.push(`END $$;\n`);

  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`-- 2. Schema Migrations Ledger`);
  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`CREATE TABLE IF NOT EXISTS schema_migrations (`);
  lines.push(`  filename    text PRIMARY KEY,`);
  lines.push(`  applied_at  timestamptz NOT NULL DEFAULT now()`);
  lines.push(`);\n`);

  const migrationsDir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    lines.push(`-- =============================================================================`);
    lines.push(`-- MIGRATION: ${file}`);
    lines.push(`-- =============================================================================`);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    lines.push(sql.trim());
    lines.push(`\nINSERT INTO schema_migrations (filename) VALUES ('${file}') ON CONFLICT (filename) DO NOTHING;\n`);
  }

  lines.push(`-- =============================================================================`);
  lines.push(`-- 3. Clean-Slate Master Data Seeding (Tenant, Branch, Stores, Staff Users)`);
  lines.push(`-- =============================================================================\n`);

  lines.push(`DO $$`);
  lines.push(`DECLARE`);
  lines.push(`  v_tenant_id uuid;`);
  lines.push(`  v_branch_id uuid;`);
  lines.push(`  v_main_id uuid;`);
  lines.push(`  v_kitchen_id uuid;`);
  lines.push(`  v_bar_id uuid;`);
  lines.push(`  v_prep_id uuid;`);
  lines.push(`BEGIN`);
  lines.push(`  -- Tenant`);
  lines.push(`  INSERT INTO tenants (code, name) VALUES ('${TENANT.code}', '${TENANT.name}')`);
  lines.push(`  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`);
  lines.push(`  RETURNING id INTO v_tenant_id;\n`);

  lines.push(`  -- Branch`);
  lines.push(`  INSERT INTO branches (tenant_id, code, name) VALUES (v_tenant_id, '${BRANCH.code}', '${BRANCH.name}')`);
  lines.push(`  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name`);
  lines.push(`  RETURNING id INTO v_branch_id;\n`);

  lines.push(`  -- 4 Stores`);
  lines.push(`  INSERT INTO stores (tenant_id, branch_id, code, name, kind)`);
  lines.push(`  VALUES (v_tenant_id, v_branch_id, 'MAIN', 'Central Store (Warehouse)', 'main')`);
  lines.push(`  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind`);
  lines.push(`  RETURNING id INTO v_main_id;\n`);

  lines.push(`  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)`);
  lines.push(`  VALUES (v_tenant_id, v_branch_id, 'KITCHEN', 'Main Kitchen', 'kitchen', v_main_id)`);
  lines.push(`  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id`);
  lines.push(`  RETURNING id INTO v_kitchen_id;\n`);

  lines.push(`  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)`);
  lines.push(`  VALUES (v_tenant_id, v_branch_id, 'BAR', 'Main Bar', 'bar', v_main_id)`);
  lines.push(`  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id`);
  lines.push(`  RETURNING id INTO v_bar_id;\n`);

  lines.push(`  INSERT INTO stores (tenant_id, branch_id, code, name, kind, default_fulfilling_store_id)`);
  lines.push(`  VALUES (v_tenant_id, v_branch_id, 'PREP', 'Pastry & Prep Kitchen', 'prep', v_main_id)`);
  lines.push(`  ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, default_fulfilling_store_id = EXCLUDED.default_fulfilling_store_id`);
  lines.push(`  RETURNING id INTO v_prep_id;\n`);

  lines.push(`  -- 5 Staff Users (HMC Role-Based Permissions, default password: password123)`);

  for (const u of SEED_STAFF_USERS) {
    const passHash = hashPassword(u.password);
    const storeVar =
      u.storeCode === 'MAIN'
        ? 'v_main_id'
        : u.storeCode === 'KITCHEN'
        ? 'v_kitchen_id'
        : u.storeCode === 'BAR'
        ? 'v_bar_id'
        : u.storeCode === 'PREP'
        ? 'v_prep_id'
        : 'NULL';

    const assignedStoresSql = u.allStoresAccess
      ? `'[]'::jsonb`
      : storeVar === 'NULL'
      ? `'[]'::jsonb`
      : `jsonb_build_array(${storeVar}::text)`;

    lines.push(`  -- Staff User: ${u.username} (${u.displayName})`);
    lines.push(`  INSERT INTO users (`);
    lines.push(`    tenant_id, username, password_hash, display_name, role, store_id,`);
    lines.push(`    permissions, department_group, all_stores_access, assigned_store_ids, document_visibility`);
    lines.push(`  ) VALUES (`);
    lines.push(`    v_tenant_id, '${u.username}', '${passHash}', '${u.displayName}', '${u.role}', ${storeVar},`);
    lines.push(`    '${JSON.stringify(u.permissions)}'::jsonb, '${u.departmentGroup}', ${u.allStoresAccess ?? false},`);
    lines.push(`    ${assignedStoresSql}, '${u.documentVisibility ?? 'department'}'`);
    lines.push(`  )`);
    lines.push(`  ON CONFLICT (tenant_id, username) DO UPDATE SET`);
    lines.push(`    password_hash = EXCLUDED.password_hash,`);
    lines.push(`    display_name = EXCLUDED.display_name,`);
    lines.push(`    role = EXCLUDED.role,`);
    lines.push(`    store_id = EXCLUDED.store_id,`);
    lines.push(`    permissions = EXCLUDED.permissions,`);
    lines.push(`    department_group = EXCLUDED.department_group,`);
    lines.push(`    all_stores_access = EXCLUDED.all_stores_access,`);
    lines.push(`    assigned_store_ids = EXCLUDED.assigned_store_ids,`);
    lines.push(`    document_visibility = EXCLUDED.document_visibility;\n`);
  }

  lines.push(`END $$;\n`);

  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`-- 4. Verification Check Query`);
  lines.push(`-- -----------------------------------------------------------------------------`);
  lines.push(`SELECT`);
  lines.push(`  (SELECT name FROM tenants LIMIT 1) AS tenant,`);
  lines.push(`  (SELECT count(*) FROM stores) AS stores_count,`);
  lines.push(`  (SELECT count(*) FROM users) AS users_count,`);
  lines.push(`  (SELECT count(*) FROM pos_item_map) AS articles_count,`);
  lines.push(`  (SELECT count(*) FROM recipes) AS recipes_count,`);
  lines.push(`  (SELECT count(*) FROM stock_movements) AS stock_movements_count;`);

  const outPath = join(process.cwd(), 'supabase_setup_clean_slate.sql');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Generated Supabase setup SQL at: ${outPath}`);
}

generate();
