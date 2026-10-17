import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  calculateYieldTest,
  createYieldTestRecord,
  postButcherYieldBatch,
  createProductionBatch,
  postProductionBatch,
  ProductionError,
} from '../src/domain/production';
import { dec, Decimal } from '../src/lib/money';

describe('Phase 3: Materials Control Production Batches & Butcher Yield Test Engine', () => {
  let h: Harness;
  let db: Database;
  let tenantId: string;
  let stores: Record<string, string>;
  let items: Record<string, string>;
  let recipes: Record<string, string>;
  let primalBeefId: string;
  let prepNiterId: string;
  let testUserId: string | null = null;

  beforeAll(async () => {
    h = await seededDb();
    db = h.db;
    tenantId = h.seeded.tenantId;
    stores = h.seeded.storeIds;
    items = h.seeded.itemIds;
    recipes = h.seeded.recipeIds;

    const { rows: u } = await db.query<{ id: string }>('select id from users limit 1');
    testUserId = u[0]?.id ?? null;

    // Create primal meat article: RM-BEEF-PRIMAL (Whole Beef Hindquarter)
    const { rows: cat } = await db.query<{ id: string }>(
      `select id from item_categories where tenant_id = $1 and code = 'MEAT'`,
      [tenantId],
    );
    const meatCatId = cat[0].id;

    const { rows: primal } = await db.query<{ id: string }>(
      `insert into items (tenant_id, code, name, category_id, uom, purchase_uom, pack_factor, loss_percent)
       values ($1, 'RM-BEEF-PRIMAL', 'Whole Beef Hindquarter (Primal)', $2, 'Kg', 'Kg', 1, 0)
       returning id`,
      [tenantId, meatCatId],
    );
    primalBeefId = primal[0].id;

    // Create prepared item: PREP-NITER (Clarified Spiced Butter)
    const { rows: dairyCat } = await db.query<{ id: string }>(
      `select id from item_categories where tenant_id = $1 and code = 'DAIRY'`,
      [tenantId],
    );
    const dairyCatId = dairyCat[0].id;

    const { rows: prep } = await db.query<{ id: string }>(
      `insert into items (tenant_id, code, name, category_id, uom, purchase_uom, pack_factor, loss_percent)
       values ($1, 'PREP-NITER', 'Niter Kibbeh (Clarified Spiced Butter)', $2, 'Kg', 'Kg', 1, 0)
       returning id`,
      [tenantId, dairyCatId],
    );
    prepNiterId = prep[0].id;
  });

  afterAll(async () => {
    await h?.close();
  });

  async function getOnHand(storeId: string, itemId: string): Promise<Decimal> {
    const { rows } = await db.query<{ q: string }>(
      `select coalesce(qty_on_hand, 0) as q from v_stock_on_hand
        where tenant_id = $1 and store_id = $2 and item_id = $3`,
      [tenantId, storeId, itemId],
    );
    return dec(rows[0]?.q ?? 0);
  }

  describe('1. Butcher / Yield Test Mathematical Calculation (HMC YIELD)', () => {
    it('calculates primal breakdown, byproduct credit, waste loss, and allocated cut costs', () => {
      // Gross Primal: 50 kg Beef Hindquarter @ 800.00 ETB/kg = 40,000.00 ETB
      // Yields:
      // - 10 kg Tenderloin Fillet (market price: 1600 ETB/kg)
      // - 15 kg Sirloin / Steak (market price: 1200 ETB/kg)
      // - 12 kg Minced / Kitfo (market price: 1000 ETB/kg)
      // - 10 kg Soup Bones & Fat (Byproduct @ 100 ETB/kg = 1,000 ETB)
      // - 3 kg Cutting Waste / Evaporation (Waste = 3 kg, 6% loss)
      const res = calculateYieldTest({
        grossWeight: '50.0',
        grossCostPerKg: '800.00',
        cuts: [
          { cutName: 'Tenderloin Fillet', weight: '10.0', marketPricePerKg: '1600.00' },
          { cutName: 'Sirloin Steak', weight: '15.0', marketPricePerKg: '1200.00' },
          { cutName: 'Kitfo Minced Meat', weight: '12.0', marketPricePerKg: '1000.00' },
          { cutName: 'Soup Bones & Fat', weight: '10.0', isByproduct: true, marketPricePerKg: '100.00' },
        ],
      });

      // Total primal cost
      expect(res.totalPrimalCost.toString()).toBe('40000');

      // Total cut weight = 10 + 15 + 12 + 10 = 47 kg. Waste = 3 kg
      expect(res.totalYieldedWeight.toString()).toBe('47');
      expect(res.wasteWeight.toString()).toBe('3');
      expect(res.lossPercent.toString()).toBe('6'); // 3 / 50 * 100 = 6%

      // Usable prime weight = 37 kg. Yield % = 37 / 50 * 100 = 74%
      expect(res.usableWeight.toString()).toBe('37');
      expect(res.usableYieldPercent.toString()).toBe('74');

      // Byproduct salvage value: 10 kg * 100 = 1000 ETB
      expect(res.byproductTotalValue.toString()).toBe('1000');

      // Net prime cost to allocate = 40,000 - 1,000 = 39,000 ETB
      expect(res.netPrimeCost.toString()).toBe('39000');

      // Verify individual cuts
      const fillet = res.cuts.find((c) => c.cutName === 'Tenderloin Fillet');
      const sirloin = res.cuts.find((c) => c.cutName === 'Sirloin Steak');
      const kitfo = res.cuts.find((c) => c.cutName === 'Kitfo Minced Meat');
      const bones = res.cuts.find((c) => c.cutName === 'Soup Bones & Fat');

      expect(fillet).toBeDefined();
      expect(sirloin).toBeDefined();
      expect(kitfo).toBeDefined();
      expect(bones).toBeDefined();

      // Bones (byproduct) allocated at market salvage price
      expect(bones?.allocatedCostPerKg.toString()).toBe('100');
      expect(bones?.totalLineCost.toString()).toBe('1000');

      // Sum of all line costs must equal total primal cost (40,000 ETB)
      const totalCutCosts = res.cuts.reduce((sum, c) => sum.plus(c.totalLineCost), new Decimal(0));
      expect(totalCutCosts.toString()).toBe('40000');

      // Average cost factor = (39,000 / 37) / 800 = 1054.05 / 800 = 1.3176
      expect(res.costFactor.toNumber()).toBeGreaterThan(1.0);
    });

    it('rejects invalid inputs when cut weights exceed gross weight', () => {
      expect(() =>
        calculateYieldTest({
          grossWeight: '20.0',
          grossCostPerKg: '500.00',
          cuts: [{ cutName: 'Impossible Cut', weight: '25.0' }],
        }),
      ).toThrow(/Total cut weights .* exceed gross primal weight/i);
    });
  });

  describe('2. Butcher Yield Test Database Record & Stock Conversion', () => {
    it('records a butcher test and converts primal meat into portion cuts in stock ledger', async () => {
      // 1. Give Main store 100 kg of Whole Beef Hindquarter @ 800 ETB/kg
      await db.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta, occurred_on, source_doc_type, note)
         values ($1, $2, $3, 'receipt', 100, 800, 80000, '2026-08-01'::date, 'seed_test', 'opening primal beef')`,
        [tenantId, stores.MAIN, primalBeefId],
      );

      const initialPrimalOnHand = await getOnHand(stores.MAIN, primalBeefId);
      const initialFilletOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-FILLET']);
      const initialKitfoOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-KITFO']);

      // 2. Butcher 50 kg of primal beef into fillet and kitfo meat
      const testNumber = `YIELD-TEST-${Date.now().toString().slice(-4)}`;
      const { yieldTestId, result } = await createYieldTestRecord(db, {
        tenantId,
        storeId: stores.MAIN,
        primalItemId: primalBeefId,
        testNumber,
        grossWeight: '50.0',
        grossCostPerKg: '800.00',
        cuts: [
          {
            cutName: 'Beef Fillet',
            itemId: items['RM-BEEF-FILLET'],
            weight: '15.0',
            marketPricePerKg: '1400.00',
          },
          {
            cutName: 'Kitfo Minced Meat',
            itemId: items['RM-BEEF-KITFO'],
            weight: '30.0',
            marketPricePerKg: '1100.00',
          },
        ],
        notes: 'Butchery yield test on fresh local beef hindquarter',
      });

      expect(yieldTestId).toBeDefined();
      expect(result.lossPercent.toNumber()).toBe(10); // 50 - 45 = 5kg loss = 10%

      // 3. Post butcher batch to ledger
      await postButcherYieldBatch(db, tenantId, yieldTestId, testUserId ?? undefined);

      // 4. Verify stock movements in ledger
      const newPrimalOnHand = await getOnHand(stores.MAIN, primalBeefId);
      const newFilletOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-FILLET']);
      const newKitfoOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-KITFO']);

      // Primal reduced by 50 kg
      expect(newPrimalOnHand.toNumber()).toBe(initialPrimalOnHand.minus(50).toNumber());

      // Fillet increased by 15 kg
      expect(newFilletOnHand.toNumber()).toBe(initialFilletOnHand.plus(15).toNumber());

      // Kitfo increased by 30 kg
      expect(newKitfoOnHand.toNumber()).toBe(initialKitfoOnHand.plus(30).toNumber());

      // Check movements logged with exact types
      const { rows: movs } = await db.query<{ movement_type: string; qty_delta: string }>(
        `select movement_type, qty_delta::text from stock_movements
          where source_doc_id = $1 order by movement_type`,
        [yieldTestId],
      );
      expect(movs.some((m) => m.movement_type === 'butcher_primal_issue')).toBe(true);
      expect(movs.some((m) => m.movement_type === 'butcher_cut_receipt')).toBe(true);
    });
  });

  describe('3. Batch Production of Sub-Recipes (HMC PRODUKTION)', () => {
    it('creates and posts a production batch, consuming raw ingredients and booking finished sub-recipe', async () => {
      // 1. Give Kitchen store ample ingredients for Niter Kibbeh
      // Butter: 100 kg, Ginger: 10 kg, Garlic: 10 kg, Korarima: 5 kg, Besobela: 5 kg
      const ingStock = [
        { id: items['RM-BUTTER'], qty: 100, cost: 900 },
        { id: items['RM-GINGER'], qty: 10, cost: 220 },
        { id: items['RM-GARLIC'], qty: 10, cost: 400 },
        { id: items['RM-KORARIMA'], qty: 5, cost: 2200 },
        { id: items['RM-BESOBELA'], qty: 5, cost: 700 },
      ];

      for (const ing of ingStock) {
        await db.query(
          `insert into stock_movements
             (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta, occurred_on, source_doc_type, note)
           values ($1, $2, $3, 'receipt', $4, $5, $6, '2026-08-01'::date, 'seed_test', 'test prep stock')`,
          [tenantId, stores.KITCHEN, ing.id, ing.qty, ing.cost, ing.qty * ing.cost],
        );
      }

      const initialButter = await getOnHand(stores.KITCHEN, items['RM-BUTTER']);
      const initialPrepNiter = await getOnHand(stores.KITCHEN, prepNiterId);

      // 2. Create production batch for 2 batches of SR-NITER
      // 1 batch yields 2.7 kg. 2 batches yield 5.4 kg.
      // Consumes: 2 * 3 = 6 kg Butter, 2 * 0.05 = 0.1 kg Ginger, 2 * 0.05 = 0.1 kg Garlic,
      //           2 * 0.02 = 0.04 kg Korarima, 2 * 0.02 = 0.04 kg Besobela.
      const batchNumber = `BATCH-${Date.now().toString().slice(-4)}`;
      const { batchId, plannedQty, lineCount } = await createProductionBatch(db, {
        tenantId,
        storeId: stores.KITCHEN,
        recipeId: recipes['SR-NITER'],
        targetItemId: prepNiterId,
        batchNumber,
        batchMultiplier: 2,
        notes: 'Bi-weekly kitchen clarification of spiced butter',
      });

      expect(plannedQty.toNumber()).toBe(5.4);
      expect(lineCount).toBe(5);

      // Verify draft lines in database
      const { rows: batchLines } = await db.query<{
        line_no: number;
        planned_qty: string;
        actual_qty: string;
      }>(
        `select line_no, planned_qty::text, actual_qty::text
           from production_batch_lines where batch_id = $1 order by line_no`,
        [batchId],
      );
      expect(batchLines).toHaveLength(5);

      // 3. Post production batch
      const postResult = await postProductionBatch(db, tenantId, batchId, testUserId ?? undefined);

      expect(postResult.producedQty.toNumber()).toBe(5.4);
      expect(postResult.totalCost.toNumber()).toBeGreaterThan(5000); // 6kg butter * 900 = 5400 + spices

      // 4. Verify Stock Ledger Movements
      const newButter = await getOnHand(stores.KITCHEN, items['RM-BUTTER']);
      const newPrepNiter = await getOnHand(stores.KITCHEN, prepNiterId);

      // Butter reduced by 6 kg
      expect(newButter.toNumber()).toBe(initialButter.minus(6.0).toNumber());

      // Finished Niter Kibbeh increased by 5.4 kg
      expect(newPrepNiter.toNumber()).toBe(initialPrepNiter.plus(5.4).toNumber());

      // Verify movement types
      const { rows: movs } = await db.query<{ movement_type: string }>(
        `select movement_type from stock_movements where source_doc_id = $1`,
        [batchId],
      );
      expect(movs.some((m) => m.movement_type === 'production_issue')).toBe(true);
      expect(movs.some((m) => m.movement_type === 'production_receipt')).toBe(true);

      // 5. Guard: Refuse double posting
      await expect(postProductionBatch(db, tenantId, batchId)).rejects.toThrow(
        /Production batch already posted/i,
      );
    });

    it('refuses to produce a non-sub-recipe (e.g. menu recipe)', async () => {
      await expect(
        createProductionBatch(db, {
          tenantId,
          storeId: stores.KITCHEN,
          recipeId: recipes['RC-KITFO'], // Menu recipe, not sub-recipe
          targetItemId: items['RM-BEEF-KITFO'],
          batchNumber: `INVALID-${Date.now().toString().slice(-4)}`,
        }),
      ).rejects.toThrow(/Only sub-recipes can be produced in production batches/i);
    });
  });
});
