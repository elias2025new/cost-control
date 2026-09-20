/**
 * Food and beverage are reported separately and never merged.
 *
 * The trap this guards: 163 of 171 articles have no recipe, but they still
 * earned money that has to land on the food side or the beverage side. If the
 * classification is left to a column default, every one of them falls into
 * "other" and both cost percentages read 100% coverage against a tiny base —
 * a number that looks precise and is nonsense.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import { importCnetFile } from '../src/domain/importCnet';
import { postSalesImport } from '../src/domain/postSalesImport';
import { dec } from '../src/lib/money';

const CNET = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');

let h: Harness;
let db: Database;
let tenantId: string;
let importId: string;

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  const imported = await importCnetFile(db, tenantId, CNET);
  importId = imported.importId;
  await postSalesImport(db, importId);
});
afterAll(async () => {
  await h?.close();
});

describe('revenue classification', () => {
  it('classifies every seeded article as food, beverage or other', async () => {
    const { rows } = await db.query<{ revenue_kind: string; c: string }>(
      `select revenue_kind, count(*)::text as c from pos_item_map
        where tenant_id = $1 group by revenue_kind order by revenue_kind`,
      [tenantId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.revenue_kind, Number(r.c)]));

    // FOOD category articles
    expect(by.food).toBeGreaterThan(60);
    // BEVERAGE plus the CAFE MENU drinks plus the free extras
    expect(by.beverage).toBeGreaterThan(50);
    // only the takeaway boxes should be left over
    expect(by.other ?? 0).toBeLessThan(6);
  });

  it('splits CAFE MENU: the cakes are food, the coffee is not', async () => {
    const { rows } = await db.query<{ article_code: string; revenue_kind: string }>(
      `select article_code, revenue_kind from pos_item_map
        where tenant_id = $1 and article_code in ('P-00237', 'P-00054', 'P-00001', 'P-00045')
        order by article_code`,
      [tenantId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.article_code, r.revenue_kind]));
    expect(by['P-00237']).toBe('food'); // BANANA CAKE, CAFE MENU / CAKE
    expect(by['P-00054']).toBe('beverage'); // TRADTIONAL COFFEE, CAFE MENU / HOT DRINK
    expect(by['P-00001']).toBe('food'); // YEAJET KITFO
    expect(by['P-00045']).toBe('beverage'); // AMBO WATER
  });

  it('leaves no revenue stranded in "other" beyond the takeaway boxes', async () => {
    const { rows } = await db.query<{ kind: string; revenue_all: string }>(
      `select kind, revenue_all from v_fb_cost_summary where sales_import_id = $1`,
      [importId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.kind, dec(r.revenue_all)]));

    // The takeaway boxes are 67,771.16 of an 8.93m file. Anything much larger
    // means articles are falling through the classification.
    expect(by.other.lessThan('100000')).toBe(true);
    expect(by.food.greaterThan('7000000')).toBe(true);
    expect(by.beverage.greaterThan('1700000')).toBe(true);
  });
});

describe('food and beverage cost', () => {
  it('reports them separately, never merged', async () => {
    const { rows } = await db.query<{ kind: string }>(
      `select kind from v_fb_cost_summary where sales_import_id = $1 order by kind`,
      [importId],
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(['beverage', 'food', 'other']);
  });

  it('divides cost by costed revenue, and reports the coverage it used', async () => {
    const { rows } = await db.query<{
      kind: string;
      revenue_all: string;
      revenue_costed: string;
      cost_of_sales: string;
      cost_pct_of_costed: string | null;
      coverage_pct: string | null;
    }>(
      `select kind, revenue_all, revenue_costed, cost_of_sales,
              cost_pct_of_costed, coverage_pct
         from v_fb_cost_summary where sales_import_id = $1 and kind in ('food','beverage')`,
      [importId],
    );

    for (const r of rows) {
      const costed = dec(r.revenue_costed);
      const all = dec(r.revenue_all);

      // the percentage really is cost / costed revenue
      const expectedPct = dec(r.cost_of_sales).dividedBy(costed).times(100).toDecimalPlaces(2);
      expect(dec(r.cost_pct_of_costed!).toFixed(2)).toBe(expectedPct.toFixed(2));

      // and coverage is honest: below 100, because most articles have no recipe
      expect(dec(r.coverage_pct!).lessThan(100)).toBe(true);
      expect(costed.lessThan(all)).toBe(true);
    }
  });

  it('gives a food cost percentage in a believable range', async () => {
    const { rows } = await db.query<{ cost_pct_of_costed: string }>(
      `select cost_pct_of_costed from v_fb_cost_summary
        where sales_import_id = $1 and kind = 'food'`,
      [importId],
    );
    const p = dec(rows[0].cost_pct_of_costed);
    expect(p.greaterThan(10)).toBe(true);
    expect(p.lessThan(60)).toBe(true);
  });

  it('never merges food and beverage into a single figure', async () => {
    const { rows } = await db.query<{ food: string; bev: string }>(
      `select
         (select cost_pct_of_costed from v_fb_cost_summary
           where sales_import_id = $1 and kind = 'food') as food,
         (select cost_pct_of_costed from v_fb_cost_summary
           where sales_import_id = $1 and kind = 'beverage') as bev`,
      [importId],
    );
    expect(rows[0].food).not.toBeNull();
    expect(rows[0].bev).not.toBeNull();
    expect(rows[0].food).not.toBe(rows[0].bev);
  });
});
