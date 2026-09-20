/**
 * Display formatting. Values arrive as fixed-point strings and are formatted
 * as strings - nothing here parses a figure into a JS number.
 */

import { Decimal, dec } from './money';

const group = (s: string) => {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [whole, frac] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
};

/** ETB to 2 dp with thousands separators. */
export function etb(v: string | number | Decimal | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '-';
  return group(dec(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp));
}

/** ETB with no decimals, for headline figures. */
export const etb0 = (v: string | number | Decimal | null | undefined) => etb(v, 0);

/** A quantity, trailing zeros trimmed - 0.002917 not 0.002917000000. */
export function qty(v: string | number | Decimal | null | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  const d = dec(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  return group(d.toFixed(Math.min(6, Math.max(0, decimalsOf(d)))));
}

function decimalsOf(d: Decimal): number {
  const s = d.toFixed(6);
  const trimmed = s.replace(/0+$/, '');
  const dot = trimmed.indexOf('.');
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

export function pct(v: string | number | Decimal | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '-';
  return `${dec(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp)}%`;
}

/** 3 August 2026 */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening balance',
  receipt: 'Receipt',
  issue_out: 'Issued out',
  issue_in: 'Issued in',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  sale_depletion: 'Sale depletion',
  wastage: 'Wastage',
  comp: 'Complimentary',
  staff_meal: 'Staff meal',
  count_adjustment: 'Count adjustment',
  reversal: 'Reversal',
};

export const UNCOSTED_LABELS: Record<string, string> = {
  not_mapped: 'Not mapped to a menu item',
  generic_article: 'Generic article - cannot be costed',
  test_article: 'Test article',
  no_recipe: 'Mapped, but no recipe written',
  no_active_recipe_version: 'No recipe active on this date',
  no_store_mapping: 'No store mapping for this category',
  recipe_error: 'Recipe could not be exploded',
  does_not_deplete: 'Marked as not depleting stock',
};
