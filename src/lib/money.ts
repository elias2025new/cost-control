/**
 * Fixed-point arithmetic.
 *
 * Design rule 4: numeric, never float. That applies in TypeScript as much as
 * in the database. A JS number is a float, so no money or quantity in this
 * codebase is ever a `number` - values arrive from Postgres as strings and
 * stay as Decimal until they are formatted for a screen.
 *
 * Precision matches the columns:
 *   quantity  6 dp
 *   money     2 dp   (ETB)
 *   rate      4 dp
 *   POS-sourced amounts 4 dp - see the note in db/migrations/004_sales.sql
 */

import Decimal from 'decimal.js';

// 30 significant digits is far more than numeric(18,6) needs, so intermediate
// steps in a recipe roll-up never lose anything before the final rounding.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Numeric = Decimal;

export const QTY_DP = 6;
export const MONEY_DP = 2;
export const RATE_DP = 4;
export const POS_DP = 4;

export function dec(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v);
}

/** Null-preserving: a missing cost must never quietly become zero. */
export function decOrNull(v: Decimal.Value | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === '') return null;
  return new Decimal(v);
}

export const roundQty = (v: Decimal.Value) => dec(v).toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP);
export const roundMoney = (v: Decimal.Value) => dec(v).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
export const roundRate = (v: Decimal.Value) => dec(v).toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP);
export const roundPos = (v: Decimal.Value) => dec(v).toDecimalPlaces(POS_DP, Decimal.ROUND_HALF_UP);

/** Fixed-point string for binding to a numeric column. */
export const qtyParam = (v: Decimal.Value) => roundQty(v).toFixed(QTY_DP);
export const moneyParam = (v: Decimal.Value) => roundMoney(v).toFixed(MONEY_DP);
export const posParam = (v: Decimal.Value) => roundPos(v).toFixed(POS_DP);

/** ETB for display. */
export function formatETB(v: Decimal.Value | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return roundMoney(v)
    .toFixed(MONEY_DP)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ------------------------------------------------------- sales line pricing */

/**
 * The client's own worked example, from his spec:
 *
 *   Burger, selling price 100, qty 1
 *   Service charge  100 x 10%       =  10
 *   VAT             (100 + 10) x 15% = 16.50
 *   Total revenue                    = 126.50
 *
 * VAT is charged on net plus service charge because the government treats the
 * service charge as revenue. That much is confirmed against the client's own
 * totals.
 *
 * The service charge RATE is not. Across the client's real export the add-on
 * charge came to 4.94% of net sales, not 10% - so only about half of sales
 * carry it, takeaway being the likely reason. This function therefore takes
 * the rate as an argument and never assumes one. Import reconciliation uses
 * the figure printed in the file rather than re-deriving it per line.
 */
export interface LinePricing {
  net: Decimal;
  serviceCharge: Decimal;
  vat: Decimal;
  total: Decimal;
}

export const VAT_RATE = new Decimal('0.15');

export function priceLine(
  sellingPrice: Decimal.Value,
  qty: Decimal.Value,
  serviceChargeRate: Decimal.Value,
  vatRate: Decimal.Value = VAT_RATE,
): LinePricing {
  const net = roundMoney(dec(sellingPrice).times(dec(qty)));
  const serviceCharge = roundMoney(net.times(dec(serviceChargeRate)));
  const vat = roundMoney(net.plus(serviceCharge).times(dec(vatRate)));
  const total = roundMoney(net.plus(serviceCharge).plus(vat));
  return { net, serviceCharge, vat, total };
}
