/**
 * Parser for the CNET "Categorized And Summarized By Article" export.
 *
 * The layout, verified against the client's real file rather than assumed:
 *
 *   row 3  F   report generated date          "Monday, August 3, 2026"
 *   row 4  D   report title                   "Categorized And Summarized By Article"
 *   row 9  A   filter line - branch, date criteria, void state, issued state
 *   row 11     headers: Catagory | Sub Category | Article Code | Article Name |
 *                       Quantity | Avg Amount | Total Amount
 *
 * then, values living only in the top-left cell of each merged range:
 *
 *   category row      value in column A only
 *   sub-category row  value in column B only
 *   article row       C = code, D = name, E = qty, F = avg, G = total
 *   subtotal row      D = the group's name, E = qty, G = total, C empty
 *   footer            E = label, F = amount
 *                     Sub Total / Add. Charge / Discount / Total Tax / Grand Total
 *
 * Two things the parser must get right or the whole system is wrong:
 *
 *   Article Code is the only stable key and it is TEXT. Three real codes carry
 *   no 'P-' prefix - '00081', '00040', '00039' - and their leading zeros have
 *   to survive. Nothing here ever calls Number() on a code.
 *
 *   Article names are not keys. The real file contains 'MOJITO' and ' MOJITO'
 *   as two different articles at two different prices, and 'SPECIAL TEA'
 *   likewise. Names are carried verbatim, whitespace included, for display
 *   only. Twenty-one names in the file have stray whitespace.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { Decimal, dec } from '../lib/money';

export interface CnetArticle {
  lineNo: number;
  category: string;
  subCategory: string;
  /** verbatim, TEXT, leading zeros intact */
  articleCode: string;
  /** verbatim, including any stray whitespace */
  articleName: string;
  qty: Decimal;
  avgAmount: Decimal | null;
  totalAmount: Decimal;
}

export interface CnetSubtotal {
  level: 'category' | 'sub_category';
  category: string;
  subCategory: string | null;
  qty: Decimal;
  totalAmount: Decimal;
}

export interface CnetFooter {
  subTotal: Decimal | null;
  addCharge: Decimal | null;
  discount: Decimal | null;
  totalTax: Decimal | null;
  grandTotal: Decimal | null;
}

export interface CnetReport {
  branch: string | null;
  periodStart: string | null; // ISO
  periodEnd: string | null; // ISO
  generatedOn: string | null;
  voidStateFiltered: boolean;
  articles: CnetArticle[];
  subtotals: CnetSubtotal[];
  footer: CnetFooter;
  filename: string;
  sha256: string;
  /** the raw filter line, kept so the client can see we read his own header */
  filterLine: string | null;
}

const FOOTER_LABELS: Record<string, keyof CnetFooter> = {
  'sub total': 'subTotal',
  'add. charge': 'addCharge',
  'add charge': 'addCharge',
  discount: 'discount',
  'total tax': 'totalTax',
  'grand total': 'grandTotal',
};

export function parseCnetFile(path: string): CnetReport {
  const buf = readFileSync(path);
  return parseCnetBuffer(buf, path.split(/[\\/]/).pop() ?? 'upload.xlsx');
}

export function parseCnetBuffer(buf: Buffer, filename: string): CnetReport {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) throw new Error('The workbook has no readable sheet.');

  const range = XLSX.utils.decode_range(ws['!ref']);

  /** Cell text, never coerced through Number(). */
  const text = (row: number, col: number): string | null => {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) return null;
    if (cell.t === 's' && typeof cell.v === 'string') return cell.v;
    if (cell.v === null || cell.v === undefined) return null;
    if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
    // A code stored as a number has already lost its leading zeros in the
    // file itself; the displayed text is the closest thing to the truth.
    if (typeof cell.w === 'string' && cell.w.length) return cell.w;
    return String(cell.v);
  };

  /**
   * Numeric cell as a Decimal. Amounts in this report carry three decimals
   * (227.743, 683.229) and the footer subtotal is 8,928,373.056, so nothing
   * may be rounded to two on the way in - see db/migrations/004_sales.sql.
   */
  const num = (row: number, col: number): Decimal | null => {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell || cell.v === null || cell.v === undefined || cell.v === '') return null;
    if (typeof cell.v === 'number') return new Decimal(cell.v);
    if (typeof cell.v === 'string') {
      const cleaned = cell.v.replace(/,/g, '').trim();
      if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
      return new Decimal(cleaned);
    }
    return null;
  };

  const rowIsEmpty = (row: number, from: number, to: number) => {
    for (let c = from; c <= to; c++) if (text(row, c) !== null) return false;
    return true;
  };

  // ---- header block --------------------------------------------------------
  let filterLine: string | null = null;
  let generatedOn: string | null = null;
  let headerRow = -1;

  for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 7); c++) {
      const v = text(r, c);
      if (!v) continue;
      if (/Report filtered by/i.test(v)) filterLine = v;
      if (/^\s*Catagory\s*$|^\s*Category\s*$/i.test(v) && headerRow === -1) {
        // confirm this really is the header row
        if ((text(r, c + 2) ?? '').toLowerCase().includes('article code')) headerRow = r;
      }
      if (generatedOn === null && /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/.test(v.trim())) {
        generatedOn = isoFromLongDate(v.trim());
      }
    }
  }
  if (headerRow === -1) {
    throw new Error(
      'Could not find the "Article Code" header row. This does not look like a CNET ' +
        '"Categorized And Summarized By Article" export.',
    );
  }

  const { branch, periodStart, periodEnd, voidStateFiltered } = parseFilterLine(filterLine);

  // ---- body ----------------------------------------------------------------
  const COL = { cat: 0, sub: 1, code: 2, name: 3, qty: 4, avg: 5, total: 6 };
  const articles: CnetArticle[] = [];
  const subtotals: CnetSubtotal[] = [];
  const footer: CnetFooter = {
    subTotal: null,
    addCharge: null,
    discount: null,
    totalTax: null,
    grandTotal: null,
  };

  let currentCategory = '';
  let currentSub = '';
  let lineNo = 0;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const code = text(r, COL.code);
    const name = text(r, COL.name);
    const catCell = text(r, COL.cat);
    const subCell = text(r, COL.sub);
    const label = text(r, COL.qty); // footer labels sit in the Quantity column

    // footer line: "Sub Total" etc. in E with the amount in F
    if (label && FOOTER_LABELS[label.trim().toLowerCase()] && !code) {
      footer[FOOTER_LABELS[label.trim().toLowerCase()]] = num(r, COL.avg);
      continue;
    }

    // article row
    if (code) {
      const total = num(r, COL.total);
      if (total === null) continue;
      articles.push({
        lineNo: ++lineNo,
        category: currentCategory,
        subCategory: currentSub,
        articleCode: code, // TEXT, verbatim
        articleName: name ?? '', // verbatim, whitespace intact
        qty: num(r, COL.qty) ?? new Decimal(0),
        avgAmount: num(r, COL.avg),
        totalAmount: total,
      });
      continue;
    }

    // group subtotal: name repeated in D with figures, no article code
    if (name && num(r, COL.total) !== null) {
      const isCategory = name.trim() === currentCategory.trim();
      subtotals.push({
        level: isCategory ? 'category' : 'sub_category',
        category: currentCategory,
        subCategory: isCategory ? null : currentSub,
        qty: num(r, COL.qty) ?? new Decimal(0),
        totalAmount: num(r, COL.total)!,
      });
      continue;
    }

    // category heading: column A alone
    if (catCell && rowIsEmpty(r, COL.sub, COL.total)) {
      currentCategory = catCell;
      currentSub = '';
      continue;
    }

    // sub-category heading: column B alone
    if (subCell && rowIsEmpty(r, COL.code, COL.total)) {
      currentSub = subCell;
      continue;
    }
  }

  return {
    branch,
    periodStart,
    periodEnd,
    generatedOn,
    voidStateFiltered,
    articles,
    subtotals,
    footer,
    filename,
    sha256,
    filterLine,
  };
}

/* ------------------------------------------------------------ reconciliation */

export interface Reconciliation {
  /** sum of every article row's Total Amount */
  computedSubTotal: Decimal;
  /** the Sub Total printed in the file's own footer */
  declaredSubTotal: Decimal | null;
  subTotalMatches: boolean;
  subTotalDifference: Decimal | null;

  computedQty: Decimal;
  declaredQty: Decimal | null;
  qtyMatches: boolean;

  /** every category subtotal in the file re-added from its own article rows */
  categorySubtotalsMatch: boolean;
  categoryMismatches: { category: string; declared: string; computed: string }[];

  /** grand total = sub total + add charge - discount + tax */
  grandTotalMatches: boolean;
  grandTotalDifference: Decimal | null;

  /**
   * The add-on charge as a share of net. Informational only. In the client's
   * real file this is 4.94%, not 10% - only about half of sales carry the
   * service charge, and which ones is an open question for him. Nothing in
   * this system applies a flat rate per line.
   */
  addChargeRateOfNet: Decimal | null;

  /**
   * VAT is 15% of (net + service charge). The client's file is 0.762 birr
   * away from that across 15,983 items, which is per-bill rounding at the
   * POS and not an error. Reported, never blocking.
   */
  taxDifferenceFromFlatRate: Decimal | null;
}

export const VAT_RATE = new Decimal('0.15');

export function reconcile(report: CnetReport): Reconciliation {
  const computedSubTotal = report.articles.reduce((s, a) => s.plus(a.totalAmount), new Decimal(0));
  const computedQty = report.articles.reduce((s, a) => s.plus(a.qty), new Decimal(0));

  const declaredSubTotal = report.footer.subTotal;
  const subTotalMatches = declaredSubTotal !== null && computedSubTotal.equals(declaredSubTotal);

  // category subtotals re-added from the article rows underneath them
  const byCategory = new Map<string, Decimal>();
  const qtyByCategory = new Map<string, Decimal>();
  for (const a of report.articles) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? new Decimal(0)).plus(a.totalAmount));
    qtyByCategory.set(a.category, (qtyByCategory.get(a.category) ?? new Decimal(0)).plus(a.qty));
  }
  const categoryMismatches: Reconciliation['categoryMismatches'] = [];
  let declaredQty = new Decimal(0);
  let sawCategorySubtotal = false;

  for (const st of report.subtotals.filter((s) => s.level === 'category')) {
    sawCategorySubtotal = true;
    declaredQty = declaredQty.plus(st.qty);
    const computed = byCategory.get(st.category) ?? new Decimal(0);
    if (!computed.equals(st.totalAmount)) {
      categoryMismatches.push({
        category: st.category,
        declared: st.totalAmount.toString(),
        computed: computed.toString(),
      });
    }
  }

  const { subTotal, addCharge, discount, totalTax, grandTotal } = report.footer;
  let grandTotalMatches = false;
  let grandTotalDifference: Decimal | null = null;
  if (subTotal && grandTotal) {
    const expected = subTotal
      .plus(addCharge ?? 0)
      .minus(discount ?? 0)
      .plus(totalTax ?? 0);
    grandTotalDifference = grandTotal.minus(expected);
    grandTotalMatches = grandTotalDifference.isZero();
  }

  return {
    computedSubTotal,
    declaredSubTotal,
    subTotalMatches,
    subTotalDifference: declaredSubTotal ? computedSubTotal.minus(declaredSubTotal) : null,
    computedQty,
    declaredQty: sawCategorySubtotal ? declaredQty : null,
    qtyMatches: sawCategorySubtotal ? computedQty.equals(declaredQty) : false,
    categorySubtotalsMatch: categoryMismatches.length === 0,
    categoryMismatches,
    grandTotalMatches,
    grandTotalDifference,
    addChargeRateOfNet:
      subTotal && addCharge && !subTotal.isZero()
        ? addCharge.dividedBy(subTotal).toDecimalPlaces(6)
        : null,
    taxDifferenceFromFlatRate:
      subTotal && totalTax
        ? totalTax.minus(subTotal.plus(addCharge ?? 0).times(VAT_RATE)).toDecimalPlaces(6)
        : null,
  };
}

/* ----------------------------------------------------------- classification */

/**
 * A first guess at why an article may not be costable, used only when an
 * article code has never been seen before. It is a SUGGESTION written against
 * the code, which the controller confirms; it is never re-derived from the
 * name on later imports, because names are not keys.
 */
export function suggestArticleFlag(name: string): 'normal' | 'generic' | 'test' | 'free_comp' {
  const n = name.trim().toUpperCase();
  if (/^FREE\b/.test(n)) return 'free_comp';
  if (/^TEST\b|\bTEST$/.test(n)) return 'test';
  // Names a class of product rather than a product: no recipe can exist.
  if (['SOFT DRINK', 'BEER', 'SEASONAL FRESH JUICE', 'WINE', 'JUICE'].includes(n)) return 'generic';
  return 'normal';
}

/* ----------------------------------------------------------------- helpers */

function parseFilterLine(line: string | null) {
  const out = {
    branch: null as string | null,
    periodStart: null as string | null,
    periodEnd: null as string | null,
    voidStateFiltered: false,
  };
  if (!line) return out;

  const branch = line.match(/Branch\s*=\s*([^,]+?)\s*,/i);
  if (branch) out.branch = branch[1].replace(/\s+/g, ' ').trim();

  // "date criteria:  from 07/08/2026 to 08/03/2026"
  // The report was generated Monday, August 3, 2026 and ends 08/03/2026, so
  // the format is mm/dd/yyyy: this file covers 8 July to 3 August 2026.
  const dates = line.match(
    /from\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (dates) {
    out.periodStart = iso(dates[3], dates[1], dates[2]);
    out.periodEnd = iso(dates[6], dates[4], dates[5]);
  }

  // The report is pre-filtered to non-void, so voids need a separate report.
  out.voidStateFiltered = /Void\s*State\s*=\s*Not void/i.test(line);
  return out;
}

const iso = (y: string, m: string, d: string) =>
  `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function isoFromLongDate(v: string): string | null {
  const m = v.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return iso(m[3], String(month + 1), m[2]);
}

export { dec };
