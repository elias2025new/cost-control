/**
 * The arithmetic contract.
 *
 * Two things have to hold or every figure downstream is suspect:
 *
 *   1. Numerics come back from the driver as STRINGS, not JS numbers. PGlite
 *      and node-postgres are different implementations and this is exactly the
 *      sort of thing that differs between them. A numeric silently parsed into
 *      a float is design rule 4 broken at the door.
 *
 *   2. The money module rounds the way Postgres rounds. Postgres rounds half
 *      AWAY FROM ZERO; several JS decimal libraries default to half-even.
 *      A half-even default would disagree with the database on exactly the
 *      half-birr cases an accountant checks first.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { freshDb } from './helpers';
import { Decimal, priceLine, roundMoney, roundQty, dec } from '../src/lib/money';

let db: Database;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});

describe('driver contract', () => {
  it('returns numeric as a string, never a JS number', async () => {
    const { rows } = await db.query<{
      money: unknown;
      qty: unknown;
      big: unknown;
      pos: unknown;
    }>(
      `select 1234.56::numeric(18,2)        as money,
              1.234567::numeric(18,6)       as qty,
              8928373.056::numeric(18,4)    as pos,
              99999999999999.99::numeric(18,2) as big`,
    );
    const row = rows[0];

    expect(typeof row.money).toBe('string');
    expect(typeof row.qty).toBe('string');
    expect(typeof row.pos).toBe('string');
    expect(typeof row.big).toBe('string');

    // and the value survives intact
    expect(dec(row.pos as string).toString()).toBe('8928373.056');
    expect(dec(row.big as string).toString()).toBe('99999999999999.99');
  });

  it('round-trips a value that a float would corrupt', async () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    const { rows } = await db.query<{ v: string }>(
      `select (0.1::numeric + 0.2::numeric) as v`,
    );
    expect(rows[0].v).toBe('0.3');
    expect(dec('0.1').plus('0.2').equals(new Decimal('0.3'))).toBe(true);
    // for contrast, the float answer this system must never produce
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('hands back a date as a JS Date unless it is cast, so queries must cast it', async () => {
    // The drivers disagree here: a `date` column can arrive as a Date object
    // or as a string depending on which one is underneath. Every read model
    // casts dates to text in SQL so the screens never have to care. This test
    // pins the hazard down rather than the workaround.
    const { rows } = await db.query<{ raw: unknown; cast: unknown }>(
      `select '2026-08-03'::date as raw, '2026-08-03'::date::text as cast`,
    );
    expect(typeof rows[0].cast).toBe('string');
    expect(rows[0].cast).toBe('2026-08-03');
    // and the uncast one is whatever the driver felt like
    expect(['string', 'object']).toContain(typeof rows[0].raw);
  });

  it('reports which driver is under the tests', () => {
    expect(['pg', 'pglite']).toContain(db.driver);
    console.log(`      driver under test: ${db.driver}`);
  });
});

describe('rounding agrees with Postgres', () => {
  // Values chosen so half-up and half-even disagree: with 0.025, half away
  // from zero gives 0.03 and half-to-even gives 0.02.
  const cases = [
    '0.005', '0.015', '0.025', '0.045', '0.055', '0.125', '0.135',
    '2.5', '2.345', '2.355', '1.005', '100.115', '407.175', '32.525',
    '-0.025', '-0.045', '-2.5', '-1.005', '-32.525',
    '1032.962962962963', '310.527500', '8928373.0565',
  ];

  it('rounds money to 2 dp the same way Postgres does', async () => {
    for (const v of cases) {
      const { rows } = await db.query<{ r: string }>(`select round($1::numeric, 2) as r`, [v]);
      expect(`${v} -> ${roundMoney(v).toFixed(2)}`).toBe(`${v} -> ${dec(rows[0].r).toFixed(2)}`);
    }
  });

  it('rounds quantities to 6 dp the same way Postgres does', async () => {
    const qtyCases = ['0.0000005', '0.0000015', '0.1333333335', '0.0029166665', '-0.0000025'];
    for (const v of qtyCases) {
      const { rows } = await db.query<{ r: string }>(`select round($1::numeric, 6) as r`, [v]);
      expect(`${v} -> ${roundQty(v).toFixed(6)}`).toBe(`${v} -> ${dec(rows[0].r).toFixed(6)}`);
    }
  });

  it('rounds half away from zero, not half to even', () => {
    // The specific behaviour, asserted directly so a change of library
    // default cannot pass silently.
    expect(roundMoney('0.025').toFixed(2)).toBe('0.03');
    expect(roundMoney('0.045').toFixed(2)).toBe('0.05');
    expect(roundMoney('-0.025').toFixed(2)).toBe('-0.03');
  });

  it('a numeric column stores what Postgres rounded it to', async () => {
    const { rows } = await db.query<{ v: string }>(`select 0.025::numeric(18,2) as v`);
    expect(dec(rows[0].v).toFixed(2)).toBe('0.03');
  });
});

describe("the client's own worked example", () => {
  // From his spec, verbatim:
  //   Burger, S.P 100, Qty 1, SC 10, VAT 16.50, TR 126.50
  it('an item selling at 100 birr shows service charge 10, VAT 16.50, total 126.50', () => {
    const p = priceLine('100', '1', '0.10');
    expect(p.net.toFixed(2)).toBe('100.00');
    expect(p.serviceCharge.toFixed(2)).toBe('10.00');
    expect(p.vat.toFixed(2)).toBe('16.50');
    expect(p.total.toFixed(2)).toBe('126.50');
  });

  it('charges VAT on net plus service charge, not on net alone', () => {
    const p = priceLine('100', '1', '0.10');
    // 15% of 100 would be 15.00; the government treats the service charge as
    // revenue, so it is 15% of 110.
    expect(p.vat.toFixed(2)).toBe('16.50');
    expect(p.vat.toFixed(2)).not.toBe('15.00');
  });

  it('applies no service charge when the rate is zero', () => {
    // The real export shows only about half of sales carry the charge, so a
    // flat rate is never assumed anywhere.
    const p = priceLine('100', '1', '0');
    expect(p.serviceCharge.toFixed(2)).toBe('0.00');
    expect(p.vat.toFixed(2)).toBe('15.00');
    expect(p.total.toFixed(2)).toBe('115.00');
  });

  it('scales by quantity', () => {
    const p = priceLine('1655.50', '3', '0.10');
    expect(p.net.toFixed(2)).toBe('4966.50');
    expect(p.serviceCharge.toFixed(2)).toBe('496.65');
    expect(p.vat.toFixed(2)).toBe('819.47'); // (4966.50 + 496.65) x 0.15 = 819.4725
    expect(p.total.toFixed(2)).toBe('6282.62');
  });
});
