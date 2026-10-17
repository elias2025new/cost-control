/**
 * Seeding. One command, repeatable from clean:
 *
 *   npm run db:reset     drop everything, migrate, seed
 *   npm run db:seed      migrate and seed onto whatever is there
 *
 * Master data is seeded from the client's real CNET export where it can be —
 * all 171 article codes, with their real categories and the flags that say
 * why some of them can never be costed. The recipes and the ingredient costs
 * are ours and are marked as samples.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
import type { Database, Tx } from '../../src/lib/db';
import { connect } from '../../src/lib/db';
import { migrate } from '../../src/lib/migrate';
import { Decimal, dec, moneyParam, qtyParam } from '../../src/lib/money';
import { parseCnetFile } from '../../src/domain/parseCnet';
import {
  BRANCH,
  CATEGORIES,
  CATEGORY_STORE_MAP,
  COST_EFFECTIVE_FROM,
  FREE_ARTICLE_MAPPINGS,
  GENERIC_ARTICLE_CODES,
  ITEMS,
  ITEM_CUSTOM_CONVERSIONS,
  MENU_ITEMS,
  MENU_RECIPES,
  RECIPE_EFFECTIVE_FROM,
  SEED_STAFF_USERS,
  STORES,
  SUB_RECIPES,
  SUPPLIERS,
  SUPPLIER_PRICES,
  TENANT,
  TEST_ARTICLE_CODES,
  type SeedRecipe,
} from './data';

export const CNET_PATH = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');

/** Opening stock lands before the first business day in the export. */
export const OPENING_DATE = '2026-07-01';

export interface SeedResult {
  tenantId: string;
  branchId: string;
  storeIds: Record<string, string>;
  itemIds: Record<string, string>;
  menuItemIds: Record<string, string>;
  recipeIds: Record<string, string>;
  supplierIds: Record<string, string>;
  articlesSeeded: number;
}

export async function dropEverything(db: Database) {
  await db.query('drop schema public cascade');
  await db.query('create schema public');
}

export async function seed(db: Database, opts: { quiet?: boolean; bare?: boolean } = {}): Promise<SeedResult> {
  const log = (m: string) => {
    if (!opts.quiet) console.log(m);
  };

  return db.transaction(async (tx) => {
    // ---- tenant, branch, stores -------------------------------------------
    const tenantId = await one(
      tx,
      `insert into tenants (code, name) values ($1, $2)
       on conflict (code) do update set name = excluded.name
       returning id`,
      [TENANT.code, TENANT.name],
    );
    const branchId = await one(
      tx,
      `insert into branches (tenant_id, code, name) values ($1, $2, $3)
       on conflict (tenant_id, code) do update set name = excluded.name
       returning id`,
      [tenantId, BRANCH.code, BRANCH.name],
    );

    const storeIds: Record<string, string> = {};
    for (const s of STORES) {
      storeIds[s.code] = await one(
        tx,
        `insert into stores (tenant_id, branch_id, code, name, kind)
         values ($1, $2, $3, $4, $5)
         on conflict (tenant_id, code) do update set name = excluded.name, kind = excluded.kind
         returning id`,
        [tenantId, branchId, s.code, s.name, s.kind],
      );
    }

    // Link satellite outlets to Central Store (MAIN) as default fulfilling warehouse
    if (storeIds['MAIN']) {
      for (const [code, id] of Object.entries(storeIds)) {
        if (code !== 'MAIN') {
          await tx.query(
            `update stores set default_fulfilling_store_id = $1 where id = $2`,
            [storeIds['MAIN'], id],
          );
        }
      }
    }
    log(`  tenant, branch, ${STORES.length} stores (Central Store hierarchy established)`);

    if (opts.bare) {
      log('  bare mode — skipping items, recipes, POS articles, and opening stock');
      await seedStaffUsers(tx, tenantId, storeIds);
      log(`  ${SEED_STAFF_USERS.length} staff accounts seeded with HMC role-based permissions`);
      return {
        tenantId,
        branchId,
        storeIds,
        itemIds: {},
        menuItemIds: {},
        recipeIds: {},
        supplierIds: {},
        articlesSeeded: 0,
      };
    }

    // ---- categories and items ---------------------------------------------
    const categoryIds: Record<string, string> = {};
    for (const c of CATEGORIES) {
      categoryIds[c.code] = await one(
        tx,
        `insert into item_categories (tenant_id, code, name, kind)
         values ($1, $2, $3, $4) returning id`,
        [tenantId, c.code, c.name, c.kind],
      );
    }

    const itemIds: Record<string, string> = {};
    for (const i of ITEMS) {
      itemIds[i.code] = await one(
        tx,
        `insert into items (tenant_id, code, name, category_id, uom, purchase_uom, pack_factor, loss_percent, abc_class, is_sample)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) returning id`,
        [
          tenantId,
          i.code,
          i.name,
          categoryIds[i.category],
          i.uom,
          i.purchaseUom ?? i.uom,
          i.packFactor ?? '1',
          i.lossPercent ?? '0',
          i.abcClass ?? null,
        ],
      );
      // The first cost version. Changing a cost later goes through
      // set_item_cost(), which closes this one rather than editing it.
      await tx.query(
        `insert into item_cost_versions
           (tenant_id, item_id, standard_cost, effective_from, note)
         values ($1, $2, $3, $4::date, $5)`,
        [
          tenantId,
          itemIds[i.code],
          i.cost,
          COST_EFFECTIVE_FROM,
          'sample standard cost pending confirmation',
        ],
      );
      if (i.min || i.max) {
        await tx.query(
          `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
           values ($1, $2, $3, $4, $5)`,
          [tenantId, storeIds[i.outlet], itemIds[i.code], i.min ?? '0', i.max ?? '0'],
        );

        // Also seed Central Store buffer Par levels (2x min, 3x max) for warehouse replenishment
        if (storeIds['MAIN']) {
          const mainMin = i.min ? String(Number(i.min) * 2) : '0';
          const mainMax = i.max ? String(Number(i.max) * 3) : '0';
          await tx.query(
            `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
             values ($1, $2, $3, $4, $5)
             on conflict (tenant_id, store_id, item_id) do nothing`,
            [tenantId, storeIds['MAIN'], itemIds[i.code], mainMin, mainMax],
          );
        }

        // Seed Prep Kitchen Par levels for prep goods and baking ingredients
        if (
          storeIds['PREP'] &&
          ['RM-BUTTER', 'RM-TEFF', 'RM-SUGAR', 'RM-SALT', 'RM-GINGER', 'RM-GARLIC', 'RM-KORARIMA', 'RM-BESOBELA'].includes(i.code)
        ) {
          await tx.query(
            `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
             values ($1, $2, $3, $4, $5)
             on conflict (tenant_id, store_id, item_id) do nothing`,
            [tenantId, storeIds['PREP'], itemIds[i.code], i.min ?? '0', i.max ?? '0'],
          );
        }
      }
    }

    // Seed HMC item custom unit conversions (density, bottle ml, etc.)
    for (const conv of ITEM_CUSTOM_CONVERSIONS) {
      const itemId = itemIds[conv.itemCode];
      if (itemId) {
        await tx.query(
          `insert into item_unit_conversions (tenant_id, item_id, from_uom, to_uom, factor, note)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (tenant_id, item_id, from_uom, to_uom) do nothing`,
          [tenantId, itemId, conv.fromUom, conv.toUom, conv.factor, conv.note ?? null],
        );
      }
    }
    log(`  ${CATEGORIES.length} categories, ${ITEMS.length} items with HMC dual units & shrinkage`);

    // ---- suppliers and price catalogs (HMC LIEFER / LIEFERART) -------------
    const supplierIds: Record<string, string> = {};
    for (const sup of SUPPLIERS) {
      supplierIds[sup.code] = await one(
        tx,
        `insert into suppliers (tenant_id, code, name, contact)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, code) do update set name = excluded.name
         returning id`,
        [tenantId, sup.code, sup.name, sup.contact ?? null],
      );
    }

    for (const sp of SUPPLIER_PRICES) {
      const sId = supplierIds[sp.supplierCode];
      const iId = itemIds[sp.itemCode];
      if (sId && iId) {
        await tx.query(
          `insert into supplier_item_prices
             (tenant_id, supplier_id, item_id, purchase_uom, pack_factor, contract_price,
              min_order_qty, lead_time_days, is_preferred)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (tenant_id, supplier_id, item_id, purchase_uom) do nothing`,
          [
            tenantId,
            sId,
            iId,
            sp.purchaseUom,
            sp.packFactor,
            sp.contractPrice,
            sp.minOrderQty ?? '1.0',
            sp.leadTimeDays ?? 1,
            sp.isPreferred ?? false,
          ],
        );
      }
    }
    log(`  ${SUPPLIERS.length} suppliers, ${SUPPLIER_PRICES.length} contract price catalogs`);

    // ---- menu items --------------------------------------------------------
    const menuItemIds: Record<string, string> = {};
    for (const m of MENU_ITEMS) {
      menuItemIds[m.code] = await one(
        tx,
        `insert into menu_items (tenant_id, code, name, kind) values ($1, $2, $3, $4) returning id`,
        [tenantId, m.code, m.name, m.kind],
      );
    }

    // ---- which store does each POS category deplete from? ------------------
    for (const c of CATEGORY_STORE_MAP) {
      await tx.query(
        `insert into pos_category_store_map
           (tenant_id, branch_id, source, pos_category, pos_sub_category, store_id,
            is_assumed, note)
         values ($1, $2, 'CNET', $3, $4, $5, true, $6)`,
        [tenantId, branchId, c.category, c.subCategory, storeIds[c.store], c.note],
      );
    }

    // ---- every article out of the client's real export ---------------------
    let articlesSeeded = 0;
    if (existsSync(CNET_PATH)) {
      const report = parseCnetFile(CNET_PATH);
      const menuByArticle = new Map(MENU_ITEMS.map((m) => [m.articleCode, m.code]));
      const freeByArticle = new Map(FREE_ARTICLE_MAPPINGS.map((f) => [f.articleCode, f]));

      for (const a of report.articles) {
        const isGeneric = GENERIC_ARTICLE_CODES.includes(a.articleCode);
        const isTest = TEST_ARTICLE_CODES.includes(a.articleCode);
        const free = freeByArticle.get(a.articleCode);
        const mapped = menuByArticle.get(a.articleCode);

        const flag = isGeneric ? 'generic' : isTest ? 'test' : free ? 'free_comp' : 'normal';
        const menuItemId = free
          ? free.menuItem
            ? menuItemIds[free.menuItem]
            : null
          : mapped
            ? menuItemIds[mapped]
            : null;

        await tx.query(
          // revenue_kind is set here, not left to the column default: food and
          // beverage are reported separately, and the 163 articles with no
          // recipe still earned money that has to land on one side or the other.
          `insert into pos_item_map
             (tenant_id, source, article_code, article_name_seen, pos_category,
              pos_sub_category, menu_item_id, article_flag, depletes, counts_as_sale, note,
              revenue_kind)
           values ($1, 'CNET', $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   classify_revenue_kind($4, $5))`,
          [
            tenantId,
            a.articleCode, // TEXT, verbatim — '00081' keeps its leading zeros
            a.articleName, // verbatim, whitespace intact
            a.category,
            a.subCategory,
            menuItemId,
            flag,
            // A free article consumes stock — when we know what product it is.
            // A generic or test one never can, because no recipe can exist.
            menuItemId !== null && (flag === 'free_comp' || flag === 'normal'),
            flag !== 'free_comp',
            noteFor(flag, free?.note),
          ],
        );
        articlesSeeded += 1;
      }
      log(`  ${articlesSeeded} POS articles from the real CNET export`);
      log(
        `    ${GENERIC_ARTICLE_CODES.length} generic, ${TEST_ARTICLE_CODES.length} test, ` +
          `${FREE_ARTICLE_MAPPINGS.length} free/comp, ${MENU_ITEMS.length} mapped to recipes`,
      );
    } else {
      log(`  ! ${CNET_PATH} not found — POS articles not seeded`);
    }

    // ---- recipes -----------------------------------------------------------
    const recipeIds: Record<string, string> = {};

    // Sub-recipes first: a parent may reference one, so it must exist. Within
    // the sub-recipes, SR-KITFOBASE references SR-NITER, so order matters
    // there too — they are declared in dependency order in data.ts.
    for (const r of [...SUB_RECIPES, ...MENU_RECIPES]) {
      recipeIds[r.code] = await insertRecipe(tx, tenantId, r, menuItemIds, itemIds, recipeIds);
    }
    log(`  ${SUB_RECIPES.length} sub-recipes, ${MENU_RECIPES.length} menu recipes (all sample)`);

    // ---- opening stock -----------------------------------------------------
    // Received into the main store, then issued out to the outlet that will
    // deplete it. Two receipts at different prices for a few items, so the
    // moving weighted average is visibly moving rather than equal to the
    // standard cost by construction.
    let movements = 0;
    for (const i of ITEMS) {
      const itemId = itemIds[i.code];
      const mainId = storeIds.MAIN;
      const outletId = storeIds[i.outlet];

      movements += await receipt(tx, tenantId, mainId, itemId, i.openingQty, i.cost, OPENING_DATE);
      if (i.secondReceipt) {
        movements += await receipt(
          tx,
          tenantId,
          mainId,
          itemId,
          i.secondReceipt.qty,
          i.secondReceipt.cost,
          OPENING_DATE,
        );
      }

      // Issue three quarters of it to the outlet, at the main store's moving
      // weighted average — which is what an issue is valued at.
      const totalQty = dec(i.openingQty).plus(i.secondReceipt?.qty ?? 0);
      const issueQty = totalQty.times('0.75').toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      if (issueQty.greaterThan(0)) {
        movements += await issue(tx, tenantId, mainId, outletId, itemId, issueQty, OPENING_DATE);
      }
    }
    log(`  ${movements} opening stock movements`);

    // ---- staff users & HMC role-based access -------------------------------
    await seedStaffUsers(tx, tenantId, storeIds);
    log(`  ${SEED_STAFF_USERS.length} staff accounts seeded with HMC role-based permissions`);

    return {
      tenantId,
      branchId,
      storeIds,
      itemIds,
      menuItemIds,
      recipeIds,
      supplierIds,
      articlesSeeded,
    };
  });
}

/* ------------------------------------------------------------------ helpers */

async function seedStaffUsers(tx: Tx, tenantId: string, storeIds: Record<string, string>) {
  for (const u of SEED_STAFF_USERS) {
    const storeId = u.storeCode && storeIds[u.storeCode] ? storeIds[u.storeCode] : null;
    const assignedStoreIds = storeId ? [storeId] : [];
    const passHash = hashPasswordSeed(u.password);

    await tx.query(
      `insert into users
         (tenant_id, username, password_hash, display_name, role, store_id,
          permissions, department_group, all_stores_access, assigned_store_ids, document_visibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (tenant_id, username) do update set
         password_hash = excluded.password_hash,
         display_name = excluded.display_name,
         role = excluded.role,
         store_id = excluded.store_id,
         permissions = excluded.permissions,
         department_group = excluded.department_group,
         all_stores_access = excluded.all_stores_access,
         assigned_store_ids = excluded.assigned_store_ids,
         document_visibility = excluded.document_visibility`,
      [
        tenantId,
        u.username,
        passHash,
        u.displayName,
        u.role,
        storeId,
        JSON.stringify(u.permissions),
        u.departmentGroup,
        u.allStoresAccess ?? false,
        JSON.stringify(u.allStoresAccess ? [] : assignedStoreIds),
        u.documentVisibility ?? 'department',
      ],
    );
  }
}

function hashPasswordSeed(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function one(tx: Tx, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(sql, params);
  return rows[0].id;
}

function noteFor(flag: string, extra?: string) {
  if (extra) return extra;
  switch (flag) {
    case 'generic':
      return 'Names a class of product, not a product — no recipe can exist, so it cannot be costed.';
    case 'test':
      return 'Test article, live in production at around 0.1 birr.';
    default:
      return null;
  }
}

async function insertRecipe(
  tx: Tx,
  tenantId: string,
  r: SeedRecipe,
  menuItemIds: Record<string, string>,
  itemIds: Record<string, string>,
  recipeIds: Record<string, string>,
): Promise<string> {
  const recipeId = await one(
    tx,
    `insert into recipes
       (tenant_id, code, name, kind, menu_item_id, batch_yield_qty, batch_yield_uom, is_sample)
     values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
    [
      tenantId,
      r.code,
      r.name,
      r.kind,
      r.menuItem ? menuItemIds[r.menuItem] : null,
      r.batchYieldQty ?? null,
      r.batchYieldUom ?? null,
    ],
  );

  const versionId = await one(
    tx,
    `insert into recipe_versions (tenant_id, recipe_id, version_no, effective_from, note)
     values ($1, $2, 1, $3::date, $4) returning id`,
    [
      tenantId,
      recipeId,
      RECIPE_EFFECTIVE_FROM,
      'SAMPLE RECIPE — ingredient quantities are our best guess, pending the client’s confirmation',
    ],
  );

  let lineNo = 0;
  for (const line of r.lines) {
    if (line.item && !itemIds[line.item]) throw new Error(`unknown item ${line.item} in ${r.code}`);
    if (line.recipe && !recipeIds[line.recipe]) {
      throw new Error(`sub-recipe ${line.recipe} used by ${r.code} before it was created`);
    }
    await tx.query(
      `insert into recipe_lines
         (tenant_id, recipe_version_id, line_no, component_item_id, component_recipe_id, qty, note)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        versionId,
        ++lineNo,
        line.item ? itemIds[line.item] : null,
        line.recipe ? recipeIds[line.recipe] : null,
        line.qty,
        line.note ?? null,
      ],
    );
  }
  return recipeId;
}

async function receipt(
  tx: Tx,
  tenantId: string,
  storeId: string,
  itemId: string,
  qty: string,
  unitCost: string,
  on: string,
): Promise<number> {
  const value = dec(qty).times(unitCost);
  await tx.query(
    `insert into stock_movements
       (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
        occurred_on, source_doc_type, note)
     values ($1, $2, $3, 'receipt', $4, $5, $6, $7::date, 'seed', 'opening purchase')`,
    [tenantId, storeId, itemId, qtyParam(qty), moneyParam(unitCost), moneyParam(value), on],
  );
  return 1;
}

async function issue(
  tx: Tx,
  tenantId: string,
  fromStore: string,
  toStore: string,
  itemId: string,
  qty: Decimal,
  on: string,
): Promise<number> {
  // An issue leaves at the issuing store's moving weighted average and arrives
  // at the same figure. Issuing does not move an average — only a receipt does.
  const { rows } = await tx.query<{ avg: string }>(`select current_avg_cost($1, $2, $3) as avg`, [
    tenantId,
    fromStore,
    itemId,
  ]);
  const unitCost = dec(rows[0]?.avg ?? 0);
  const value = qty.times(unitCost);

  await tx.query(
    `insert into stock_movements
       (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
        occurred_on, source_doc_type, note)
     values ($1, $2, $3, 'issue_out', $4, $5, $6, $7::date, 'seed', 'opening issue to outlet')`,
    [tenantId, fromStore, itemId, qtyParam(qty.negated()), moneyParam(unitCost), moneyParam(value.negated()), on],
  );
  await tx.query(
    `insert into stock_movements
       (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
        occurred_on, source_doc_type, note)
     values ($1, $2, $3, 'issue_in', $4, $5, $6, $7::date, 'seed', 'opening issue from main store')`,
    [tenantId, toStore, itemId, qtyParam(qty), moneyParam(unitCost), moneyParam(value), on],
  );
  return 2;
}

/* --------------------------------------------------------------------- CLI */

async function main() {
  const reset = process.argv.includes('--reset');
  const bare = process.argv.includes('--bare');
  const db = await connect();
  try {
    if (reset) {
      console.log('Resetting schema...');
      await dropEverything(db);
    }
    console.log('Migrating...');
    await migrate(db);
    console.log('Seeding...');
    const result = await seed(db, { bare });
    if (bare) {
      console.log(`\nDone (bare). Tenant ${TENANT.name} / ${BRANCH.name}, 3 stores. No sample data.`);
    } else {
      console.log(
        `\nDone. Tenant ${TENANT.name} / ${BRANCH.name}, ` +
          `${result.articlesSeeded} POS articles, ` +
          `${Object.keys(result.recipeIds).length} recipes.`,
      );
      console.log(
        'Recipes and ingredient costs are SAMPLES pending the client\'s confirmation.',
      );
    }
  } finally {
    await db.close();
  }
}

// run only when invoked directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
