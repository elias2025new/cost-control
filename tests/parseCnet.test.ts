/**
 * Parsing the client's actual CNET export.
 *
 * Every figure asserted here was read out of reference/cnet_sales_export.xlsx,
 * not assumed. If the parser stops reproducing them, the import is wrong.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseCnetFile, reconcile, suggestArticleFlag } from '../src/domain/parseCnet';
import { Decimal } from '../src/lib/money';

const report = parseCnetFile(join(process.cwd(), 'reference', 'cnet_sales_export.xlsx'));
const rec = reconcile(report);

describe('report header', () => {
  it('reads the branch', () => {
    expect(report.branch).toBe('Siyonat Branch');
  });

  it('reads the period as a range, not a single day', () => {
    // "from 07/08/2026 to 08/03/2026", generated Monday August 3 2026, so the
    // format is mm/dd/yyyy: 8 July to 3 August 2026, a 27-day range.
    expect(report.periodStart).toBe('2026-07-08');
    expect(report.periodEnd).toBe('2026-08-03');
    expect(report.periodStart).not.toBe(report.periodEnd);
  });

  it('notices the report is pre-filtered to non-void sales', () => {
    expect(report.voidStateFiltered).toBe(true);
  });
});

describe('article codes are text', () => {
  it('finds all 171 articles, every code distinct', () => {
    expect(report.articles).toHaveLength(171);
    expect(new Set(report.articles.map((a) => a.articleCode)).size).toBe(171);
  });

  it('keeps every code as a string', () => {
    for (const a of report.articles) {
      expect(typeof a.articleCode).toBe('string');
    }
  });

  it('keeps the leading zeros on codes with no P- prefix', () => {
    const codes = report.articles.map((a) => a.articleCode);
    expect(codes).toContain('00081'); // SEASONAL FRESH JUICE
    expect(codes).toContain('00040'); // SPECIAL TEA
    expect(codes).toContain('00039'); // SPECIAL TEA WITH ALCHOL
    expect(codes.filter((c) => !c.startsWith('P-'))).toEqual(['00081', '00040', '00039']);
  });
});

describe('article names are not keys', () => {
  it('keeps stray whitespace verbatim', () => {
    const names = report.articles.map((a) => a.articleName);
    expect(names.filter((n) => n !== n.trim())).toHaveLength(21);
  });

  it('treats MOJITO and " MOJITO" as two different articles at two prices', () => {
    const mojitos = report.articles.filter((a) => a.articleName.trim().toUpperCase() === 'MOJITO');
    expect(mojitos).toHaveLength(2);

    const byCode = new Map(mojitos.map((m) => [m.articleCode, m]));
    expect(byCode.get('P-00402')!.articleName).toBe(' MOJITO');
    expect(byCode.get('P-00402')!.avgAmount!.toString()).toBe('1614.91');
    expect(byCode.get('P-00257')!.articleName).toBe('MOJITO');
    expect(byCode.get('P-00257')!.avgAmount!.toString()).toBe('1490.68');
  });

  it('treats SPECIAL TEA the same way', () => {
    const teas = report.articles.filter(
      (a) => a.articleName.trim().toUpperCase() === 'SPECIAL TEA',
    );
    expect(teas.map((t) => t.articleCode).sort()).toEqual(['00040', 'P-00219']);
  });
});

describe('reconciliation against the file itself', () => {
  it('reproduces the footer Sub Total exactly', () => {
    expect(rec.computedSubTotal.toString()).toBe('8928373.056');
    expect(rec.declaredSubTotal!.toString()).toBe('8928373.056');
    expect(rec.subTotalMatches).toBe(true);
    expect(rec.subTotalDifference!.isZero()).toBe(true);
  });

  it('reproduces every category subtotal', () => {
    expect(rec.categoryMismatches).toEqual([]);
    expect(rec.categorySubtotalsMatch).toBe(true);

    const cats = report.subtotals.filter((s) => s.level === 'category');
    expect(cats.map((c) => `${c.category}=${c.totalAmount.toString()}`).sort()).toEqual([
      'BEVERAGE=1416917.4',
      'CAFE MENU=406736.676',
      'EXTRAS=67778.89',
      'FOOD=7036940.09',
    ]);
  });

  it('reproduces the total quantity of 15,983', () => {
    expect(rec.computedQty.toString()).toBe('15983');
    expect(rec.qtyMatches).toBe(true);
  });

  it('reproduces the Grand Total from its parts', () => {
    // sub total + add charge - discount + tax
    expect(report.footer.grandTotal!.toString()).toBe('10774488.946');
    expect(rec.grandTotalMatches).toBe(true);
    expect(rec.grandTotalDifference!.isZero()).toBe(true);
  });

  it('shows the service charge is 4.94% of net, not a flat 10%', () => {
    expect(report.footer.addCharge!.toString()).toBe('440747.104');
    // 440,747.104 / 8,928,373.056
    expect(rec.addChargeRateOfNet!.times(100).toDecimalPlaces(4).toString()).toBe('4.9365');
    expect(rec.addChargeRateOfNet!.lessThan(new Decimal('0.10'))).toBe(true);
  });

  it('reports the 0.762 birr tax rounding without treating it as an error', () => {
    // 15% of (net + add charge) is 1,405,368.024; the file says 1,405,368.786.
    // That is per-bill rounding at the POS across 15,983 items.
    expect(report.footer.totalTax!.toString()).toBe('1405368.786');
    expect(rec.taxDifferenceFromFlatRate!.toString()).toBe('0.762');
    // it does not touch whether the file reconciles
    expect(rec.subTotalMatches).toBe(true);
  });

  it('keeps three-decimal amounts intact', () => {
    // Rounded to 2 dp on the way in, the sum would no longer reach the footer.
    const banana = report.articles.find((a) => a.articleCode === 'P-00237')!;
    expect(banana.totalAmount.toString()).toBe('683.229');
    expect(banana.avgAmount!.toString()).toBe('227.743');
  });

  it('every line has avg x qty equal to its total', () => {
    for (const a of report.articles) {
      if (!a.avgAmount) continue;
      expect(a.avgAmount.times(a.qty).minus(a.totalAmount).abs().lessThan('0.011')).toBe(true);
    }
  });
});

describe('the articles that cannot be costed', () => {
  const find = (code: string) => report.articles.find((a) => a.articleCode === code)!;

  it('finds the generic articles with their real quantities', () => {
    expect(find('P-00052').articleName).toBe('SOFT DRINK');
    expect(find('P-00052').qty.toString()).toBe('1803');
    expect(find('P-00046').articleName).toBe('BEER');
    expect(find('P-00046').qty.toString()).toBe('379');
    expect(find('00081').articleName).toBe('SEASONAL FRESH JUICE');
    expect(find('00081').qty.toString()).toBe('44');
  });

  it('finds the test articles that are live in production', () => {
    expect(find('P-00129').articleName).toBe('TEST DRINK');
    expect(find('P-00000').articleName).toBe('TEST FOOD');
    expect(find('P-00172').articleName).toBe('TEST');
    for (const c of ['P-00129', 'P-00000', 'P-00172']) {
      expect(find(c).avgAmount!.lessThanOrEqualTo('0.2')).toBe(true);
    }
  });

  it('finds the free articles that consume stock at no revenue', () => {
    const free = report.articles.filter((a) => a.articleName.trim().startsWith('FREE'));
    expect(free.map((f) => f.articleCode).sort()).toEqual([
      'P-00192', // FREE WATER
      'P-00195', // FREE SOFT DRINK
      'P-00196', // FREE AMBO
      'P-00197', // FREE NOVIDA
    ]);
    expect(free.reduce((s, f) => s.plus(f.qty), new Decimal(0)).toString()).toBe('80');
  });
});

describe('first-sighting flag suggestions', () => {
  it('suggests a flag from the name, for review', () => {
    expect(suggestArticleFlag('FREE AMBO')).toBe('free_comp');
    expect(suggestArticleFlag('TEST DRINK')).toBe('test');
    expect(suggestArticleFlag('SOFT DRINK')).toBe('generic');
    expect(suggestArticleFlag('BEER')).toBe('generic');
    expect(suggestArticleFlag('YEAJET KITFO')).toBe('normal');
  });

  it('is not fooled by leading whitespace', () => {
    expect(suggestArticleFlag(' MOJITO')).toBe('normal');
    expect(suggestArticleFlag('FREE NOVIDA ')).toBe('free_comp');
  });
});

describe('rejecting a file that is not this report', () => {
  it('refuses a workbook with no Article Code header', () => {
    expect(() =>
      parseCnetFile(join(process.cwd(), 'reference', 'prime_fnb_workbook.xlsx')),
    ).toThrow(/Article Code/);
  });
});
