/**
 * Importing and posting the client's real CNET file.
 *
 * The rule under test throughout: revenue always posts, depletion is
 * best-effort, and only structural problems reject an import.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import { importCnetFile, type ImportResult } from '../src/domain/importCnet';
import { postSalesImport, reverseSalesImport } from '../src/domain/postSalesImport';
import { dec, Decimal } from '../src/lib/money';

const CNET = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');

let h: Harness;
let db: Database;
let tenantId: string;
let stores: Record<string, string>;
let items: Record<string, string>;

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  stores = h.seeded.storeIds;
  items = h.seeded.itemIds;
});
afterAll(async () => {
  await h?.close();
});

async function qty(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ q: string | null }>(
    `select qty_on_hand as q from v_stock_on_hand
      where tenant_id = $1 and store_id = $2 and item_id = $3`,
    [tenantId, stores[store], items[item]],
  );
  expect(rows, `no stock row for ${store}/${item}`).toHaveLength(1);
  return dec(rows[0].q ?? 0);
}

/* ------------------------------------------------------------------------ */

describe('importing the real file', () => {
  let result: ImportResult;

  beforeAll(async () => {
    result = await importCnetFile(db, tenantId, CNET);
  });

  it('records all 171 lines', () => {
    expect(result.lineCount).toBe(171);
  });

  it('reconciles against the footer subtotal exactly', () => {
    expect(result.reconciliation.computedSubTotal.toString()).toBe('8928373.056');
    expect(result.reconciled).toBe(true);
    expect(result.blockingCount).toBe(0);
    expect(result.canPost).toBe(true);
  });

  it('stores article codes as text, leading zeros intact', async () => {
    const { rows } = await db.query<{ article_code: string; article_name: string }>(
      `select article_code, article_name from sales_lines
        where sales_import_id = $1 and article_code not like 'P-%'
        order by article_code`,
      [result.importId],
    );
    expect(rows.map((r) => r.article_code)).toEqual(['00039', '00040', '00081']);
    for (const r of rows) expect(typeof r.article_code).toBe('string');
  });

  it('keeps the two MOJITO articles apart', async () => {
    const { rows } = await db.query<{ article_code: string; article_name: string; avg_amount: string }>(
      `select article_code, article_name, avg_amount from sales_lines
        where sales_import_id = $1 and upper(trim(article_name)) = 'MOJITO'
        order by article_code`,
      [result.importId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.article_code, r.article_name])).toEqual([
      ['P-00257', 'MOJITO'],
      ['P-00402', ' MOJITO'],
    ]);
  });

  it('flags the generic articles with their quantities, as warnings not blockers', () => {
    const generic = result.issues.filter((i) => i.kind === 'generic');
    expect(generic).toHaveLength(3);
    for (const g of generic) expect(g.severity).toBe('warn');

    const byCode = Object.fromEntries(generic.map((g) => [g.articleCode!, g]));
    expect(byCode['P-00052'].qty!.toString()).toBe('1803'); // SOFT DRINK
    expect(byCode['P-00046'].qty!.toString()).toBe('379'); // BEER
    expect(byCode['00081'].qty!.toString()).toBe('44'); // SEASONAL FRESH JUICE
    expect(byCode['P-00052'].message).toMatch(/names a class of product/);
  });

  it('flags the test articles', () => {
    const test = result.issues.filter((i) => i.kind === 'test');
    expect(test.map((t) => t.articleCode).sort()).toEqual(['P-00000', 'P-00129', 'P-00172']);
    for (const t of test) expect(t.severity).toBe('warn');
  });

  it('flags all four free articles as stock without revenue', () => {
    const free = result.issues.filter((i) => i.kind === 'free_comp');
    expect(free.map((f) => f.articleCode).sort()).toEqual([
      'P-00192', // FREE WATER
      'P-00195', // FREE SOFT DRINK
      'P-00196', // FREE AMBO
      'P-00197', // FREE NOVIDA
    ]);
    expect(free[0].message).toMatch(/consumes real stock at no revenue/);
  });

  it('notes the service charge is not a flat rate', () => {
    const sc = result.issues.find((i) => i.kind === 'service_charge')!;
    expect(sc.severity).toBe('info');
    expect(sc.message).toMatch(/4\.9365%/);
  });

  it('notes the tax rounding without blocking on it', () => {
    const tax = result.issues.find((i) => i.kind === 'tax_rounding')!;
    expect(tax.severity).toBe('info');
    expect(tax.message).toMatch(/0\.762/);
  });

  it('notes that the file is a range rather than one business day', () => {
    const multi = result.issues.find((i) => i.kind === 'multi_day_period')!;
    expect(multi.severity).toBe('info');
    expect(result.periodStart).toBe('2026-07-08');
    expect(result.periodEnd).toBe('2026-08-03');
    expect(result.businessDate).toBe('2026-08-03');
  });

  it('warns about the 160 articles with no recipe, and blocks on none of them', () => {
    const noRecipe = result.issues.filter(
      (i) => i.kind === 'unmapped' || i.kind === 'no_active_recipe',
    );
    expect(noRecipe.length).toBeGreaterThan(100);
    for (const n of noRecipe) expect(n.severity).toBe('warn');
    expect(result.blockingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */

describe('posting', () => {
  let importId: string;
  let posted: Awaited<ReturnType<typeof postSalesImport>>;
  let beefBefore: Decimal;
  let ambSoBefore: Decimal;

  beforeAll(async () => {
    const imported = await importCnetFile(db, tenantId, CNET);
    importId = imported.importId;
    beefBefore = await qty('KITCHEN', 'RM-BEEF-KITFO');
    ambSoBefore = await qty('BAR', 'RM-AMBO');
    posted = await postSalesImport(db, importId);
  });

  it('posts', () => {
    expect(posted.posted).toBe(true);
    expect(posted.alreadyPosted).toBe(false);
  });

  it('records revenue for every line, including the ones it cannot cost', async () => {
    const { rows } = await db.query<{ c: string; total: string }>(
      `select count(*)::text as c, sum(total_amount)::text as total
         from sales_lines where sales_import_id = $1`,
      [importId],
    );
    expect(rows[0].c).toBe('171');
    expect(dec(rows[0].total).toString()).toBe('8928373.056');
  });

  it('depletes only the lines that have a recipe', () => {
    // 8 mapped menu items + 2 free articles that map to a menu item
    expect(posted.linesDepleted).toBe(10);
    expect(posted.movementsWritten).toBeGreaterThan(0);
  });

  it('moves stock with no manual entry', async () => {
    // Yeajet Kitfo sold 1,392, at 0.25 Kg of minced beef a portion.
    const beefAfter = await qty('KITCHEN', 'RM-BEEF-KITFO');
    expect(beefBefore.minus(beefAfter).toFixed(6)).toBe('348.000000');
  });

  it('walks the tree: injera and butter move too, though nobody sold them', async () => {
    // Yeajet Kitfo 1392 x 0.5 Kg teff + Fillet Tibes 625 x 0.5 Kg = 1008.5 Kg
    const { rows } = await db.query<{ q: string }>(
      `select -sum(qty_delta) as q from stock_movements
        where source_doc_id = $1 and item_id = $2 and movement_type = 'sale_depletion'`,
      [importId, items['RM-TEFF']],
    );
    expect(dec(rows[0].q).toFixed(6)).toBe('1008.500000');
  });

  it('aggregates an ingredient reached by two branches into one movement', async () => {
    // Salt reaches Yeajet Kitfo through both Kitfo Base and Injera.
    const { rows } = await db.query<{ c: string }>(
      `select count(*)::text as c from stock_movements m
         join sales_lines sl on sl.id = m.source_doc_line
        where m.source_doc_id = $1 and m.item_id = $2 and sl.article_code = 'P-00001'`,
      [importId, items['RM-SALT']],
    );
    expect(rows[0].c).toBe('1');
  });

  it('depletes free articles but does not count them as revenue', async () => {
    expect(posted.freeCompLinesDepleted).toBe(2);

    // FREE AMBO 18 + AMBO WATER 1,447 = 1,465 bottles left the bar.
    const ambAfter = await qty('BAR', 'RM-AMBO');
    expect(ambSoBefore.minus(ambAfter).toFixed(6)).toBe('1465.000000');

    // but the free ones are not in revenue
    const { rows } = await db.query<{ total: string }>(
      `select coalesce(sum(sl.total_amount), 0)::text as total
         from sales_lines sl join pos_item_map p on p.id = sl.pos_item_map_id
        where sl.sales_import_id = $1 and p.counts_as_sale = false`,
      [importId],
    );
    // FREE AMBO 1.80 + FREE WATER 3.50 + FREE SOFT DRINK 2.40 + FREE NOVIDA 0.03
    expect(dec(rows[0].total).toString()).toBe('7.73');
  });

  it('a FREE line writes stock movements but adds nothing to revenue', async () => {
    // The bug this guards against is the mirror image of counting free water
    // as a sale: excluding it from DEPLETION. Free water still leaves the
    // store, and stock that walks out unrecorded is the whole reason the
    // client is buying this.
    const { rows: line } = await db.query<{
      id: string;
      qty: string;
      total_amount: string;
      depleted: boolean;
      counts_as_sale: boolean;
    }>(
      `select sl.id, sl.qty, sl.total_amount, sl.depleted, p.counts_as_sale
         from sales_lines sl join pos_item_map p on p.id = sl.pos_item_map_id
        where sl.sales_import_id = $1 and sl.article_code = 'P-00192'`, // FREE WATER
      [importId],
    );
    expect(line).toHaveLength(1);
    expect(line[0].counts_as_sale).toBe(false);
    expect(line[0].depleted).toBe(true);
    expect(dec(line[0].qty).toString()).toBe('35');

    // it moved real stock, in the right direction and quantity
    const { rows: moves } = await db.query<{
      item_id: string;
      qty_delta: string;
      movement_type: string;
    }>(
      `select item_id, qty_delta, movement_type from stock_movements
        where source_doc_line = $1`,
      [line[0].id],
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].item_id).toBe(items['RM-WATER-S']);
    expect(moves[0].movement_type).toBe('sale_depletion');
    expect(dec(moves[0].qty_delta).toFixed(6)).toBe('-35.000000');

    // and it contributed nothing to revenue
    const { rows: cov } = await db.query<{ revenue_total: string }>(
      `select revenue_total from v_import_cost_coverage where sales_import_id = $1`,
      [importId],
    );
    const { rows: all } = await db.query<{ t: string }>(
      `select sum(total_amount)::text as t from sales_lines where sales_import_id = $1`,
      [importId],
    );
    expect(dec(all[0].t).minus(dec(cov[0].revenue_total)).toString()).toBe('7.73');
    expect(dec(line[0].total_amount).toString()).toBe('3.5');
  });

  it('a free article with no product behind it depletes nothing and is still not revenue', async () => {
    // FREE SOFT DRINK names a class, not a product, so there is nothing to
    // deplete — but counting it as a sale would still be wrong.
    const { rows } = await db.query<{ depleted: boolean; counts_as_sale: boolean; depletes: boolean }>(
      `select sl.depleted, p.counts_as_sale, p.depletes
         from sales_lines sl join pos_item_map p on p.id = sl.pos_item_map_id
        where sl.sales_import_id = $1 and sl.article_code = 'P-00195'`,
      [importId],
    );
    expect(rows[0]).toMatchObject({ depleted: false, counts_as_sale: false, depletes: false });
  });

  it('leaves no stock negative', async () => {
    const { rows } = await db.query<{ c: string }>(
      `select count(*)::text as c from v_stock_on_hand where qty_on_hand < 0`,
    );
    expect(rows[0].c).toBe('0');
  });

  it('values depletion at the moving weighted average, not the standard cost', async () => {
    // Beef was received twice: 300 Kg at 1,100 and 300 Kg at 1,150, so the
    // main store's average is 1,125 and that is what the outlet holds it at.
    const { rows } = await db.query<{ unit_cost: string }>(
      `select distinct unit_cost from stock_movements
        where source_doc_id = $1 and item_id = $2 and movement_type = 'sale_depletion'`,
      [importId, items['RM-BEEF-KITFO']],
    );
    expect(rows).toHaveLength(1);
    expect(dec(rows[0].unit_cost).toFixed(2)).toBe('1125.00');
  });

  /* ---------------------------------------------------------------- */

  it('reports cost coverage in birr and per cent', () => {
    const c = posted.coverage;
    expect(c.revenueTotal.toString()).toBe('8928365.326'); // 8,928,373.056 less the 7.73 of free articles
    expect(c.revenueCosted.plus(c.revenueUncosted).toString()).toBe(c.revenueTotal.toString());
    expect(c.revenueCosted.greaterThan(0)).toBe(true);
    expect(c.revenueUncosted.greaterThan(0)).toBe(true);

    // Eight recipes against 171 articles: the number starts low on purpose.
    expect(c.revenueCostedPct!.greaterThan(0)).toBe(true);
    expect(c.revenueCostedPct!.lessThan(100)).toBe(true);
    console.log(
      `      cost coverage: ${c.revenueCostedPct!.toFixed(2)}% of revenue costed, ` +
        `${c.revenueUncosted.toFixed(2)} birr could not be`,
    );
  });

  it('agrees with the coverage view in SQL', async () => {
    const { rows } = await db.query<{
      revenue_total: string;
      revenue_costed: string;
      revenue_uncosted: string;
      revenue_costed_pct: string;
    }>(`select * from v_import_cost_coverage where sales_import_id = $1`, [importId]);

    expect(dec(rows[0].revenue_total).toString()).toBe(posted.coverage.revenueTotal.toString());
    expect(dec(rows[0].revenue_costed).toString()).toBe(posted.coverage.revenueCosted.toString());
    expect(dec(rows[0].revenue_costed_pct).toFixed(2)).toBe(
      posted.coverage.revenueCostedPct!.toFixed(2),
    );
  });

  it('lists what it could not cost, and why', () => {
    const reasons = new Set(posted.uncosted.map((u) => u.reason));
    expect(reasons.has('not_mapped')).toBe(true);
    expect(reasons.has('generic_article')).toBe(true);
    expect(reasons.has('test_article')).toBe(true);
    expect(posted.uncosted.length).toBe(161); // 171 lines less the 10 depleted
  });

  it('marks each line as depleted or not', async () => {
    const { rows } = await db.query<{ depleted: boolean; c: string }>(
      `select depleted, count(*)::text as c from sales_lines
        where sales_import_id = $1 group by depleted order by depleted`,
      [importId],
    );
    expect(rows).toEqual([
      { depleted: false, c: '161' },
      { depleted: true, c: '10' },
    ]);
  });

  /* ---------------------------------------------------------------- */

  it('posting the same import twice changes nothing', async () => {
    const beforeQty = await qty('KITCHEN', 'RM-BEEF-KITFO');
    const { rows: before } = await db.query<{ c: string }>(
      `select count(*)::text as c from stock_movements where source_doc_id = $1`,
      [importId],
    );

    const second = await postSalesImport(db, importId);

    expect(second.posted).toBe(false);
    expect(second.alreadyPosted).toBe(true);
    expect(second.movementsWritten).toBe(0);

    const { rows: after } = await db.query<{ c: string }>(
      `select count(*)::text as c from stock_movements where source_doc_id = $1`,
      [importId],
    );
    expect(after[0].c).toBe(before[0].c);
    expect((await qty('KITCHEN', 'RM-BEEF-KITFO')).toString()).toBe(beforeQty.toString());
  });

  it('still reports coverage when it was already posted', async () => {
    const again = await postSalesImport(db, importId);
    expect(again.coverage.revenueTotal.toString()).toBe(posted.coverage.revenueTotal.toString());
    expect(again.coverage.revenueCostedPct!.toFixed(2)).toBe(
      posted.coverage.revenueCostedPct!.toFixed(2),
    );
  });

  it('refuses to import the same period twice', async () => {
    const again = await importCnetFile(db, tenantId, CNET);
    const dup = again.issues.find((i) => i.kind === 'duplicate_period')!;
    expect(dup).toBeDefined();
    expect(dup.severity).toBe('block');
    expect(again.canPost).toBe(false);

    await expect(postSalesImport(db, again.importId)).rejects.toThrow(/structural problems/);
  });
});

/* ------------------------------------------------------------------------ */

describe('the reconciliation gate', () => {
  it('will not post an import that does not reconcile', async () => {
    const h2 = await seededDb();
    try {
      const imported = await importCnetFile(h2.db, h2.seeded.tenantId, CNET);
      // Corrupt one line by a single cent.
      await h2.db.query(
        `update sales_lines set total_amount = total_amount + 0.01
          where sales_import_id = $1 and article_code = 'P-00001'`,
        [imported.importId],
      );
      await h2.db.query(
        `update sales_imports set reconciled = false, status = 'rejected' where id = $1`,
        [imported.importId],
      );

      await expect(postSalesImport(h2.db, imported.importId)).rejects.toThrow(/does not reconcile/);

      const { rows } = await h2.db.query<{ c: string }>(
        `select count(*)::text as c from stock_movements where source_doc_id = $1`,
        [imported.importId],
      );
      expect(rows[0].c).toBe('0');
    } finally {
      await h2.close();
    }
  });

  it('detects a mismatch between the lines and the footer', async () => {
    const { parseCnetFile, reconcile } = await import('../src/domain/parseCnet');
    const report = parseCnetFile(CNET);
    report.articles[0].totalAmount = report.articles[0].totalAmount.plus('0.001');
    const rec = reconcile(report);
    expect(rec.subTotalMatches).toBe(false);
    expect(rec.subTotalDifference!.toString()).toBe('0.001');
  });
});

/* ------------------------------------------------------------------------ */

describe('the ledger is append-only', () => {
  it('refuses an update', async () => {
    await expect(
      db.query(`update stock_movements set qty_delta = 1 where movement_type = 'receipt'`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a delete', async () => {
    await expect(
      db.query(`delete from stock_movements where movement_type = 'receipt'`),
    ).rejects.toThrow(/append-only/);
  });

  it('corrects by reversing, never by removing', async () => {
    const h2 = await seededDb();
    try {
      const imported = await importCnetFile(h2.db, h2.seeded.tenantId, CNET);
      await postSalesImport(h2.db, imported.importId);

      const beefId = h2.seeded.itemIds['RM-BEEF-KITFO'];
      const kitchenId = h2.seeded.storeIds['KITCHEN'];
      const before = await h2.db.query<{ q: string }>(
        `select qty_on_hand as q from v_stock_on_hand
          where store_id = $1 and item_id = $2`,
        [kitchenId, beefId],
      );

      const { movementsReversed } = await reverseSalesImport(h2.db, imported.importId);
      expect(movementsReversed).toBeGreaterThan(0);

      const after = await h2.db.query<{ q: string }>(
        `select qty_on_hand as q from v_stock_on_hand where store_id = $1 and item_id = $2`,
        [kitchenId, beefId],
      );
      // stock is back where it started
      expect(dec(after.rows[0].q).minus(dec(before.rows[0].q)).toFixed(6)).toBe('348.000000');

      // and nothing was removed — the original rows are still there
      const { rows } = await h2.db.query<{ c: string }>(
        `select count(*)::text as c from stock_movements
          where source_doc_id = $1 and movement_type = 'sale_depletion'`,
        [imported.importId],
      );
      expect(Number(rows[0].c)).toBe(movementsReversed);
    } finally {
      await h2.close();
    }
  });
});

/* ------------------------------------------------------------------------ */

describe('the stock ledger view', () => {
  it('shows every movement with a running balance, receipts before depletions', async () => {
    const { rows } = await db.query<{
      movement_type: string;
      qty_delta: string;
      running_qty: string;
      unit_cost: string;
    }>(
      `select movement_type, qty_delta, running_qty, unit_cost
         from v_stock_ledger
        where store_id = $1 and item_id = $2
        order by occurred_on, movement_sort_rank(movement_type), seq`,
      [stores['KITCHEN'], items['RM-BEEF-KITFO']],
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // the issue in arrives before the sale depletes it
    expect(rows[0].movement_type).toBe('issue_in');
    expect(rows[rows.length - 1].movement_type).toBe('sale_depletion');

    // the running balance is the sum of everything above it
    let running = new Decimal(0);
    for (const r of rows) {
      running = running.plus(dec(r.qty_delta));
      expect(dec(r.running_qty).toFixed(6)).toBe(running.toFixed(6));
    }
  });
});
