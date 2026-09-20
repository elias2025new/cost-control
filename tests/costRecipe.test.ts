/**
 * costRecipe — the recursive cost engine.
 *
 * The numbers asserted here are hand-computed from db/seed/data.ts. They are
 * written out longhand in the comments so a disagreement can be settled
 * without re-deriving anything.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import { costRecipe, RecipeCostError, explodeRecipe } from '../src/domain/costRecipe';
import { Decimal, dec } from '../src/lib/money';

let h: Harness;
let db: Database;
let tenantId: string;
let recipes: Record<string, string>;
let items: Record<string, string>;

const AS_OF = '2026-07-15'; // inside the seeded cost and recipe versions

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  recipes = h.seeded.recipeIds;
  items = h.seeded.itemIds;
});
afterAll(async () => {
  await h?.close();
});

const cost = (code: string, asOf = AS_OF) => costRecipe(db, tenantId, recipes[code], asOf);

async function scalar(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.query<Record<string, string>>(sql, params);
  return Object.values(rows[0])[0];
}

describe('a flat recipe', () => {
  it('costs Traditional Coffee at 17.58', async () => {
    // coffee 0.022 Kg x 750 = 16.50
    // sugar  0.012 Kg x  90 =  1.08
    const c = await cost('RC-TRADCOF');
    expect(c.costPerPortion!.toFixed(2)).toBe('17.58');
    expect(c.lines).toHaveLength(2);
    expect(c.maxDepth).toBe(0);
  });

  it('costs an item bought for resale at its purchase cost', async () => {
    const c = await cost('RC-AMBO');
    expect(c.costPerPortion!.toFixed(2)).toBe('45.00');
    expect(c.lines).toHaveLength(1);
  });

  it('breaks the cost down line by line', async () => {
    const c = await cost('RC-MACC');
    const byCode = Object.fromEntries(c.lines.map((l) => [l.itemCode, l]));

    expect(byCode['RM-COFFEE'].qty.toFixed(6)).toBe('0.018000');
    expect(byCode['RM-COFFEE'].unitCost!.toFixed(2)).toBe('750.00');
    expect(byCode['RM-COFFEE'].lineCost!.toFixed(2)).toBe('13.50');

    expect(byCode['RM-MILK'].lineCost!.toFixed(2)).toBe('5.50');
    expect(byCode['RM-SUGAR'].lineCost!.toFixed(2)).toBe('0.72');

    expect(c.costPerPortion!.toFixed(2)).toBe('19.72');
  });
});

describe('sub-recipes', () => {
  it('costs a batch and a yield unit separately', async () => {
    // Niter Kibbeh batch: butter 3 x 900 = 2700, ginger .05 x 220 = 11,
    // garlic .05 x 400 = 20, korarima .02 x 2200 = 44, besobela .02 x 700 = 14
    //   batch = 2789.00, yield 2.7 Kg  ->  1032.96 per Kg
    const c = await cost('SR-NITER');
    expect(c.kind).toBe('sub');
    expect(c.costPerPortion!.toFixed(2)).toBe('2789.00');
    expect(c.batchYieldQty!.toFixed(1)).toBe('2.7');
    expect(c.batchYieldUom).toBe('Kg');
    expect(c.costPerYieldUnit!.toFixed(2)).toBe('1032.96');
  });

  it('costs Injera at 32.53 a piece', async () => {
    // teff 3 x 130 = 390, salt 0.01 x 30 = 0.30 -> 390.30 / 12 = 32.525
    const c = await cost('SR-INJERA');
    expect(c.costPerPortion!.toFixed(2)).toBe('390.30');
    expect(c.costPerYieldUnit!.toFixed(2)).toBe('32.53');
  });

  it('pulls a sub-recipe into a parent at cost per unit', async () => {
    // Fillet Tibes takes 0.02 Kg of Niter Kibbeh. 0.02 / 2.7 of a batch is
    // 0.0222222 Kg of butter, not 0.02 Kg — the yield has to divide.
    const c = await cost('RC-FILLET');
    const butter = c.lines.find((l) => l.itemCode === 'RM-BUTTER')!;
    expect(butter.qty.toFixed(6)).toBe('0.022222');
    expect(butter.lineCost!.toFixed(2)).toBe('20.00');
  });
});

describe('the tree is walked to raw items', () => {
  it('goes three levels deep', async () => {
    // Yeajet Kitfo -> Kitfo Base -> Niter Kibbeh -> butter
    const c = await cost('RC-KITFO');
    expect(c.maxDepth).toBe(2);

    const butter = c.lines.find((l) => l.itemCode === 'RM-BUTTER')!;
    expect(butter.viaPaths[0]).toEqual(['Yeajet Kitfo', 'Kitfo Base', 'Niter Kibbeh (spiced clarified butter)']);
  });

  it('returns raw items only — no sub-recipe survives the walk', async () => {
    const c = await cost('RC-KITFO');
    const codes = c.lines.map((l) => l.itemCode).sort();
    expect(codes).toEqual([
      'RM-AYIB',
      'RM-BEEF-KITFO',
      'RM-BESOBELA',
      'RM-BUTTER',
      'RM-GARLIC',
      'RM-GINGER',
      'RM-GOMEN',
      'RM-KORARIMA',
      'RM-MITMITA',
      'RM-SALT',
      'RM-TEFF',
    ]);
    // every one of them is a real item, none is a recipe
    for (const code of codes) expect(code.startsWith('RM-')).toBe(true);
  });

  it('sums an ingredient reached by two different branches', async () => {
    // Salt arrives twice in Yeajet Kitfo: 0.005 Kg via Kitfo Base (a quarter
    // batch, so 0.00125) and 0.01 Kg via Injera (2/12 of a batch, so
    // 0.00166667). One line, 0.00291667 Kg, not two lines.
    const c = await cost('RC-KITFO');
    const salt = c.lines.filter((l) => l.itemCode === 'RM-SALT');
    expect(salt).toHaveLength(1);
    expect(salt[0].qty.toFixed(6)).toBe('0.002917');
    expect(salt[0].viaPaths).toHaveLength(2);
  });

  it('reaches the same sub-recipe from two different parents', async () => {
    const kitfo = await cost('RC-KITFO');
    const fillet = await cost('RC-FILLET');
    // Niter Kibbeh feeds both, at different depths
    expect(kitfo.lines.some((l) => l.itemCode === 'RM-KORARIMA')).toBe(true);
    expect(fillet.lines.some((l) => l.itemCode === 'RM-KORARIMA')).toBe(true);
  });
});

describe('the seeded menu costs', () => {
  // Longhand for Yeajet Kitfo, one portion:
  //   Kitfo Base 1 portion = 1/4 batch
  //     beef      0.25      x 1100 = 275.00
  //     niter     0.03 Kg -> butter 0.033333 x 900 = 30.00
  //                          ginger 0.000556 x 220 =  0.12
  //                          garlic 0.000556 x 400 =  0.22
  //                          korarima 0.000222 x 2200 = 0.49
  //                          besobela 0.000222 x 700 =  0.16
  //     mitmita   0.005     x  900 =   4.50
  //     salt      0.00125
  //   ayib        0.08      x  320 =  25.60
  //   gomen       0.10      x   60 =   6.00
  //   injera 2 Pcs = 1/6 batch -> teff 0.5 x 130 = 65.00, salt 0.001667
  //   salt total  0.002917   x   30 =   0.09
  //                                   -------
  //                                    407.18
  const expected: Record<string, string> = {
    'RC-KITFO': '407.18',
    'RC-FILLET': '450.91',
    'RC-TRADCOF': '17.58',
    'RC-MACC': '19.72',
    'RC-TEA': '3.48',
    'RC-AMBO': '45.00',
    'RC-WATER': '25.00',
    'RC-MOJITO': '167.80',
  };

  for (const [code, want] of Object.entries(expected)) {
    it(`${code} costs ${want}`, async () => {
      const c = await cost(code);
      expect(c.costPerPortion!.toFixed(2)).toBe(want);
      expect(c.fullyCosted).toBe(true);
    });
  }

  it('every seeded recipe is marked as a sample', async () => {
    for (const code of Object.keys(recipes)) {
      const c = await cost(code);
      expect(c.isSample).toBe(true);
    }
  });
});

describe('the TypeScript and SQL implementations agree', () => {
  it('produces the same cost for every seeded recipe', async () => {
    for (const [code, id] of Object.entries(recipes)) {
      const ts = await cost(code);
      const { rows } = await db.query<{ c: string | null }>(
        `select recipe_cost($1, $2, $3::date) as c`,
        [tenantId, id, AS_OF],
      );
      const sql = rows[0].c;
      expect(`${code}=${ts.costPerPortion!.toFixed(2)}`).toBe(`${code}=${dec(sql!).toFixed(2)}`);
    }
  });

  it('produces the same explosion for every seeded recipe', async () => {
    for (const [code, id] of Object.entries(recipes)) {
      const ts = await explodeRecipe(db, tenantId, id, AS_OF, new Decimal(1));
      const { rows } = await db.query<{ item_id: string; qty: string }>(
        `select item_id, qty from recipe_explode($1, $2, $3::date, 1)`,
        [tenantId, id, AS_OF],
      );
      expect(rows.length).toBe(ts.size);
      for (const r of rows) {
        const mine = ts.get(r.item_id);
        expect(mine, `${code} missing item ${r.item_id}`).toBeDefined();
        expect(`${code}:${dec(r.qty).toFixed(6)}`).toBe(`${code}:${mine!.toFixed(6)}`);
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/*  The most important behaviour in the system.                             */
/* ------------------------------------------------------------------------ */

describe('cost versioning', () => {
  it('a new cost creates a version and leaves an earlier report unchanged', async () => {
    const before = await cost('RC-KITFO', '2026-07-15');
    expect(before.costPerPortion!.toFixed(2)).toBe('407.18');

    // Butter goes from 900 to 1,150 on 1 August.
    await db.query(`select set_item_cost($1, $2, $3, $4::date, $5)`, [
      tenantId,
      items['RM-BUTTER'],
      '1150.00',
      '2026-08-01',
      'supplier increase',
    ]);

    // July is untouched.
    const july = await cost('RC-KITFO', '2026-07-15');
    expect(july.costPerPortion!.toFixed(2)).toBe('407.18');

    // August reflects the new cost: butter is 0.033333 Kg, so +8.33.
    const august = await cost('RC-KITFO', '2026-08-15');
    expect(august.costPerPortion!.toFixed(2)).toBe('415.51');

    // And it flows through both parents that use Niter Kibbeh.
    const filletJuly = await cost('RC-FILLET', '2026-07-15');
    const filletAug = await cost('RC-FILLET', '2026-08-15');
    expect(filletJuly.costPerPortion!.toFixed(2)).toBe('450.91');
    expect(filletAug.costPerPortion!.toFixed(2)).toBe('456.47'); // butter 0.022222 x 1150 = 25.56
  });

  it('keeps both versions, closing the old one rather than editing it', async () => {
    const { rows } = await db.query<{
      standard_cost: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `select standard_cost, effective_from::text, effective_to::text
         from item_cost_versions
        where tenant_id = $1 and item_id = $2
        order by effective_from`,
      [tenantId, items['RM-BUTTER']],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      standard_cost: '900.00',
      effective_from: '2026-07-01',
      effective_to: '2026-08-01',
    });
    expect(rows[1]).toMatchObject({
      standard_cost: '1150.00',
      effective_from: '2026-08-01',
      effective_to: null,
    });
  });

  it('refuses overlapping cost versions', async () => {
    await expect(
      db.query(
        `insert into item_cost_versions (tenant_id, item_id, standard_cost, effective_from, effective_to)
         values ($1, $2, 999, '2026-07-10'::date, '2026-07-20'::date)`,
        [tenantId, items['RM-BUTTER']],
      ),
    ).rejects.toThrow(/overlaps/);
  });

  it('never reports a partial cost as if it were the answer', async () => {
    // An ingredient with no cost version on the date must make the whole
    // recipe come back null. A smaller number that looks like a real figure
    // is worse than no figure, because nobody checks it.
    const uncostedItemId = await scalar(
      `insert into items (tenant_id, code, name, category_id, uom)
       values ($1, 'RM-NOCOST', 'Ingredient with no cost yet',
               (select id from item_categories where tenant_id = $1 and code = 'SPICE'), 'Kg')
       returning id`,
      [tenantId],
    );
    const recipeId = await scalar(
      `insert into recipes (tenant_id, code, name, kind, batch_yield_qty, batch_yield_uom)
       values ($1, 'SR-PARTIAL', 'Partly costed test blend', 'sub', 1, 'Kg') returning id`,
      [tenantId],
    );
    const versionId = await scalar(
      `insert into recipe_versions (tenant_id, recipe_id, version_no, effective_from)
       values ($1, $2, 1, '2026-07-01'::date) returning id`,
      [tenantId, recipeId],
    );
    // one ingredient priced, one not
    await db.query(
      `insert into recipe_lines (tenant_id, recipe_version_id, line_no, component_item_id, qty)
       values ($1, $2, 1, $3, 0.5), ($1, $2, 2, $4, 0.5)`,
      [tenantId, versionId, items['RM-SALT'], uncostedItemId],
    );

    const c = await costRecipe(db, tenantId, recipeId, AS_OF);
    expect(c.costPerPortion).toBeNull();
    expect(c.costPerYieldUnit).toBeNull();
    expect(c.fullyCosted).toBe(false);
    expect(c.uncostedItemCodes).toEqual(['RM-NOCOST']);

    // the costed line is still shown, so the gap is visible rather than hidden
    const salt = c.lines.find((l) => l.itemCode === 'RM-SALT')!;
    expect(salt.lineCost!.toFixed(2)).toBe('15.00');

    // SQL agrees that there is no answer
    const { rows } = await db.query<{ c: string | null }>(
      `select recipe_cost($1, $2, $3::date) as c`,
      [tenantId, recipeId, AS_OF],
    );
    expect(rows[0].c).toBeNull();
  });

  it('returns no cost for a date before the ingredient had one', async () => {
    // Move Traditional Coffee's recipe back so it is active in June, while
    // the ingredient costs still only start on 1 July.
    const rv = await scalar(
      `select id::text from recipe_versions where tenant_id = $1 and recipe_id = $2`,
      [tenantId, recipes['RC-TRADCOF']],
    );
    await db.query(`update recipe_versions set effective_from = '2026-05-01' where id = $1`, [rv]);

    const c = await cost('RC-TRADCOF', '2026-06-01');
    expect(c.costPerPortion).toBeNull();
    expect(c.fullyCosted).toBe(false);
    expect(c.uncostedItemCodes.sort()).toEqual(['RM-COFFEE', 'RM-SUGAR']);

    await db.query(`update recipe_versions set effective_from = '2026-07-01' where id = $1`, [rv]);
  });
});

describe('recipe versioning', () => {
  it('has no active version before the recipe existed', async () => {
    await expect(cost('RC-KITFO', '2026-06-30')).rejects.toThrow(RecipeCostError);
    await expect(cost('RC-KITFO', '2026-06-30')).rejects.toThrow(/no active version/);
  });
});

describe('guards', () => {
  it('detects a cycle rather than looping forever', async () => {
    // Point Niter Kibbeh at Kitfo Base, which already reaches Niter Kibbeh.
    const { rows } = await db.query<{ id: string }>(
      `select id from recipe_versions where tenant_id = $1 and recipe_id = $2`,
      [tenantId, recipes['SR-NITER']],
    );
    await db.query(
      `insert into recipe_lines (tenant_id, recipe_version_id, line_no, component_recipe_id, qty)
       values ($1, $2, 99, $3, 1)`,
      [tenantId, rows[0].id, recipes['SR-KITFOBASE']],
    );

    await expect(cost('RC-KITFO')).rejects.toThrow(/cycle/i);
    await expect(
      db.query(`select recipe_cost($1, $2, $3::date)`, [tenantId, recipes['RC-KITFO'], AS_OF]),
    ).rejects.toThrow(/cycle/i);

    await db.query(`delete from recipe_lines where recipe_version_id = $1 and line_no = 99`, [
      rows[0].id,
    ]);
  });

  it('refuses a recipe that references itself', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from recipe_versions where tenant_id = $1 and recipe_id = $2`,
      [tenantId, recipes['SR-NITER']],
    );
    await expect(
      db.query(
        `insert into recipe_lines (tenant_id, recipe_version_id, line_no, component_recipe_id, qty)
         values ($1, $2, 98, $3, 1)`,
        [tenantId, rows[0].id, recipes['SR-NITER']],
      ),
    ).rejects.toThrow(/may not reference itself/);
  });

  it('refuses a recipe line that pulls in a menu recipe', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from recipe_versions where tenant_id = $1 and recipe_id = $2`,
      [tenantId, recipes['SR-NITER']],
    );
    await expect(
      db.query(
        `insert into recipe_lines (tenant_id, recipe_version_id, line_no, component_recipe_id, qty)
         values ($1, $2, 97, $3, 1)`,
        [tenantId, rows[0].id, recipes['RC-KITFO']],
      ),
    ).rejects.toThrow(/only reference a sub-recipe/);
  });

  it('refuses a line that names both an item and a recipe, or neither', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from recipe_versions where tenant_id = $1 and recipe_id = $2`,
      [tenantId, recipes['SR-NITER']],
    );
    await expect(
      db.query(
        `insert into recipe_lines
           (tenant_id, recipe_version_id, line_no, component_item_id, component_recipe_id, qty)
         values ($1, $2, 96, $3, $4, 1)`,
        [tenantId, rows[0].id, items['RM-SALT'], recipes['SR-INJERA']],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `insert into recipe_lines (tenant_id, recipe_version_id, line_no, qty)
         values ($1, $2, 95, 1)`,
        [tenantId, rows[0].id],
      ),
    ).rejects.toThrow();
  });
});
