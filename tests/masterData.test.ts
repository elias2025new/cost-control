import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  convertQuantity,
  calculateYieldAndEffectiveCost,
  classifyInventoryAbc,
  STANDARD_UNITS,
  type ItemMaster,
  type ItemCustomConversion,
} from '../src/domain/masterData';
import { dec, Decimal } from '../src/lib/money';

describe('Phase 1: Materials Control Master Data Engine & Dual Unit Conversion', () => {
  describe('TypeScript Domain Engine (Decimal.js)', () => {
    const mockItem: ItemMaster = {
      id: 'item-1',
      code: 'RM-TEST',
      name: 'Test Flour',
      uom: 'kg',
      purchaseUom: 'bag',
      packFactor: 50,
      lossPercent: 2.5,
    };

    it('converts identical units as identity', () => {
      const res = convertQuantity({
        item: mockItem,
        quantity: '10.5',
        fromUom: 'kg',
        toUom: 'kg',
      });
      expect(res.toString()).toBe('10.5');
    });

    it('converts standard metric weight dimensions (kg <-> g, lb <-> g)', () => {
      // 2.5 kg to g -> 2500 g
      const g = convertQuantity({
        item: mockItem,
        quantity: '2.5',
        fromUom: 'kg',
        toUom: 'g',
      });
      expect(g.toString()).toBe('2500');

      // 500 g to kg -> 0.5 kg
      const kg = convertQuantity({
        item: mockItem,
        quantity: '500',
        fromUom: 'g',
        toUom: 'kg',
      });
      expect(kg.toString()).toBe('0.5');

      // 1 lb in grams -> 453.59237 g
      const lbInG = convertQuantity({
        item: mockItem,
        quantity: '1',
        fromUom: 'lb',
        toUom: 'g',
      });
      expect(lbInG.toString()).toBe('453.59237');
    });

    it('converts standard volume dimensions (l <-> ml, cl <-> ml)', () => {
      const beverageItem: ItemMaster = {
        id: 'bev-1',
        code: 'RM-JUICE',
        name: 'Orange Juice',
        uom: 'l',
      };

      // 1.5 l to ml -> 1500 ml
      const ml = convertQuantity({
        item: beverageItem,
        quantity: '1.5',
        fromUom: 'l',
        toUom: 'ml',
      });
      expect(ml.toString()).toBe('1500');

      // 75 cl to ml -> 750 ml
      const clToMl = convertQuantity({
        item: beverageItem,
        quantity: '75',
        fromUom: 'cl',
        toUom: 'ml',
      });
      expect(clToMl.toString()).toBe('750');
    });

    it('converts packaging units using HMC packaging factor (VPK_INHALT)', () => {
      // 3 bags of flour @ 50 kg/bag -> 150 kg
      const kgFromBags = convertQuantity({
        item: mockItem,
        quantity: '3',
        fromUom: 'bag',
        toUom: 'kg',
      });
      expect(kgFromBags.toString()).toBe('150');

      // 100 kg to bags -> 2 bags
      const bagsFromKg = convertQuantity({
        item: mockItem,
        quantity: '100',
        fromUom: 'kg',
        toUom: 'bag',
      });
      expect(bagsFromKg.toString()).toBe('2');
    });

    it('supports custom item conversions (e.g. bottle volume in ml)', () => {
      const beerBottle: ItemMaster = {
        id: 'item-beer',
        code: 'RM-BEER',
        name: 'Bottled Beer 330ml',
        uom: 'bottle',
        purchaseUom: 'crate',
        packFactor: 24,
      };

      const customConversions: ItemCustomConversion[] = [
        { fromUom: 'bottle', toUom: 'ml', factor: '330' },
      ];

      // 2 bottles -> 660 ml
      const ml = convertQuantity({
        item: beerBottle,
        quantity: '2',
        fromUom: 'bottle',
        toUom: 'ml',
        customConversions,
      });
      expect(ml.toString()).toBe('660');

      // 990 ml -> 3 bottles
      const bottles = convertQuantity({
        item: beerBottle,
        quantity: '990',
        fromUom: 'ml',
        toUom: 'bottle',
        customConversions,
      });
      expect(bottles.toString()).toBe('3');

      // Chained: 1 crate -> 24 bottles -> 7920 ml
      const crateToMl = convertQuantity({
        item: beerBottle,
        quantity: '1',
        fromUom: 'crate',
        toUom: 'ml',
        customConversions,
      });
      expect(crateToMl.toString()).toBe('7920');
    });

    it('throws when conversion path does not exist', () => {
      expect(() =>
        convertQuantity({
          item: mockItem,
          quantity: '5',
          fromUom: 'kg',
          toUom: 'bottle',
        }),
      ).toThrow(/no standard or custom conversion path found/i);
    });

    it('computes HMC yield factor, usable quantity, and effective usable cost', () => {
      // 500 ETB/kg standard cost with 20% loss
      // Yield factor: 1 - 0.20 = 0.80 (80% yield)
      // Effective cost: 500 / 0.80 = 625.00 ETB/kg
      // Usable qty from 10 kg gross: 10 * 0.80 = 8 kg
      const res = calculateYieldAndEffectiveCost({
        standardCost: '500.00',
        lossPercent: '20.00',
        grossQuantity: '10.0',
      });

      expect(res.lossPercent.toString()).toBe('20');
      expect(res.yieldPercent.toString()).toBe('80');
      expect(res.yieldFactor.toString()).toBe('0.8');
      expect(res.effectiveCost.toString()).toBe('625');
      expect(res.usableQuantity?.toString()).toBe('8');

      // Kitfo meat: 1100 ETB/kg with 12% trimming loss
      // 1100 / (1 - 0.12) = 1100 / 0.88 = 1250.00 ETB/kg
      const kitfoRes = calculateYieldAndEffectiveCost({
        standardCost: '1100.00',
        lossPercent: '12.0',
      });
      expect(kitfoRes.effectiveCost.toString()).toBe('1250');
    });

    it('rejects invalid loss percentages (<0 or >=100)', () => {
      expect(() =>
        calculateYieldAndEffectiveCost({ standardCost: '100', lossPercent: '-5' }),
      ).toThrow(/Loss percent must be between 0 and 99.99/);

      expect(() =>
        calculateYieldAndEffectiveCost({ standardCost: '100', lossPercent: '100' }),
      ).toThrow(/Loss percent must be between 0 and 99.99/);
    });

    it('classifies inventory according to HMC ABC rule (80% / 15% / 5%)', () => {
      const items = [
        { itemId: '1', totalValue: '50000' }, // 50% -> A
        { itemId: '2', totalValue: '25000' }, // 25% (cumulative 75%) -> A
        { itemId: '3', totalValue: '15000' }, // 15% (cumulative 90%) -> B
        { itemId: '4', totalValue: '7000' },  // 7%  (cumulative 97%) -> C
        { itemId: '5', totalValue: '3000' },  // 3%  (cumulative 100%) -> C
      ];

      const classified = classifyInventoryAbc(items);
      expect(classified[0].abcClass).toBe('A');
      expect(classified[1].abcClass).toBe('A');
      expect(classified[2].abcClass).toBe('B');
      expect(classified[3].abcClass).toBe('C');
      expect(classified[4].abcClass).toBe('C');
    });
  });

  describe('PostgreSQL / PGlite Schema and Stored Functions', () => {
    let h: Harness;
    let db: Database;
    let tenantId: string;
    let items: Record<string, string>;

    beforeAll(async () => {
      h = await seededDb();
      db = h.db;
      tenantId = h.seeded.tenantId;
      items = h.seeded.itemIds;
    });

    afterAll(async () => {
      await h?.close();
    });

    it('verifies seeded units_of_measure table contains standard dimensions', async () => {
      const { rows } = await db.query<{ count: string }>(
        `select count(*)::text as count from units_of_measure`,
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(20);

      const { rows: kgRow } = await db.query<{ code: string; dimension: string; to_base_factor: string }>(
        `select code, dimension, to_base_factor::text from units_of_measure where code = 'kg'`,
      );
      expect(kgRow[0].dimension).toBe('weight');
      expect(Number(kgRow[0].to_base_factor)).toBe(1000);
    });

    it('verifies items table contains HMC purchase_uom, pack_factor, loss_percent, and abc_class', async () => {
      const { rows } = await db.query<{
        code: string;
        uom: string;
        purchase_uom: string;
        pack_factor: string;
        loss_percent: string;
        abc_class: string;
      }>(
        `select code, uom, purchase_uom, pack_factor::text, loss_percent::text, abc_class
           from items
          where tenant_id = $1 and code in ('RM-TEFF', 'RM-BEEF-KITFO', 'RM-AMBO', 'RM-RUM')
          order by code`,
        [tenantId],
      );

      const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));

      // Teff: uom=Kg, purchase_uom=Bag, pack_factor=50, loss=2%, class=A
      expect(byCode['RM-TEFF'].uom).toBe('Kg');
      expect(byCode['RM-TEFF'].purchase_uom).toBe('Bag');
      expect(Number(byCode['RM-TEFF'].pack_factor)).toBe(50);
      expect(Number(byCode['RM-TEFF'].loss_percent)).toBe(2);
      expect(byCode['RM-TEFF'].abc_class).toBe('A');

      // Kitfo: loss=12%, class=A
      expect(Number(byCode['RM-BEEF-KITFO'].loss_percent)).toBe(12);
      expect(byCode['RM-BEEF-KITFO'].abc_class).toBe('A');

      // Ambo: crate of 24 bottles
      expect(byCode['RM-AMBO'].purchase_uom).toBe('Crate');
      expect(Number(byCode['RM-AMBO'].pack_factor)).toBe(24);
    });

    it('verifies seeded item_unit_conversions contains bottle volume conversions', async () => {
      const { rows } = await db.query<{ from_uom: string; to_uom: string; factor: string }>(
        `select from_uom, to_uom, factor::text
           from item_unit_conversions
          where tenant_id = $1 and item_id = $2`,
        [tenantId, items['RM-AMBO']],
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const bottleToMl = rows.find((r) => r.from_uom === 'bottle' && r.to_uom === 'ml');
      expect(bottleToMl).toBeDefined();
      expect(Number(bottleToMl?.factor)).toBe(500);
    });

    it('executes item_usable_qty() and item_effective_cost() SQL functions', async () => {
      const { rows: usable } = await db.query<{ val: string }>(
        `select item_usable_qty(10.0, 20.0)::text as val`,
      );
      expect(Number(usable[0].val)).toBe(8);

      const { rows: cost } = await db.query<{ val: string }>(
        `select item_effective_cost(500.00, 20.0)::text as val`,
      );
      expect(Number(cost[0].val)).toBe(625.0);

      // Kitfo trimming: 1100 ETB with 12% loss -> 1250 ETB
      const { rows: kitfoCost } = await db.query<{ val: string }>(
        `select item_effective_cost(1100.00, 12.0)::text as val`,
      );
      expect(Number(kitfoCost[0].val)).toBe(1250.0);
    });

    it('executes convert_item_uom() stored function across universal, packaging, and custom units', async () => {
      // 1. Universal dimension: 2.5 kg to g -> 2500 g
      const { rows: universal } = await db.query<{ val: string }>(
        `select convert_item_uom($1, $2, 2.5, 'kg', 'g')::text as val`,
        [tenantId, items['RM-BEEF-KITFO']],
      );
      expect(Number(universal[0].val)).toBe(2500);

      // 2. Packaging factor: 3 Bags of Teff to Kg -> 150 Kg (pack_factor = 50)
      const { rows: pack } = await db.query<{ val: string }>(
        `select convert_item_uom($1, $2, 3, 'bag', 'kg')::text as val`,
        [tenantId, items['RM-TEFF']],
      );
      expect(Number(pack[0].val)).toBe(150);

      // Inverse packaging: 100 Kg of Teff to Bags -> 2 Bags
      const { rows: invPack } = await db.query<{ val: string }>(
        `select convert_item_uom($1, $2, 100, 'kg', 'bag')::text as val`,
        [tenantId, items['RM-TEFF']],
      );
      expect(Number(invPack[0].val)).toBe(2);

      // 3. Custom conversion: 2 bottles of Ambo to ml -> 1000 ml
      const { rows: custom } = await db.query<{ val: string }>(
        `select convert_item_uom($1, $2, 2, 'bottle', 'ml')::text as val`,
        [tenantId, items['RM-AMBO']],
      );
      expect(Number(custom[0].val)).toBe(1000);
    });
  });
});
