/**
 * How many recipes does it actually take?
 *
 * "Write recipes for 171 articles" sounds endless. Ranked by revenue it is
 * not: restaurant sales are extremely top-heavy. This ranks the client's own
 * articles by revenue and reports how many recipes reach 50%, 80% and 90% of
 * costable revenue.
 *
 *   npx tsx scripts/coverage-curve.ts
 *
 * Articles that can never carry a recipe — the generic ones, the test ones —
 * are counted separately, because they set a ceiling below 100% that no amount
 * of work will lift.
 */

import { join } from 'node:path';
import { parseCnetFile } from '../src/domain/parseCnet';
import { Decimal } from '../src/lib/money';
import { GENERIC_ARTICLE_CODES, TEST_ARTICLE_CODES, MENU_ITEMS } from '../db/seed/data';

const report = parseCnetFile(join(process.cwd(), 'reference', 'cnet_sales_export.xlsx'));

const UNCOSTABLE = new Set([...GENERIC_ARTICLE_CODES, ...TEST_ARTICLE_CODES]);
const SEEDED = new Set(MENU_ITEMS.map((m) => m.articleCode));

const grand = report.articles.reduce((s, a) => s.plus(a.totalAmount), new Decimal(0));

const uncostable = report.articles.filter((a) => UNCOSTABLE.has(a.articleCode));
const uncostableRevenue = uncostable.reduce((s, a) => s.plus(a.totalAmount), new Decimal(0));

// The ceiling: everything that could, in principle, be given a recipe.
const costable = report.articles
  .filter((a) => !UNCOSTABLE.has(a.articleCode))
  .sort((a, b) => b.totalAmount.comparedTo(a.totalAmount));
const costableRevenue = costable.reduce((s, a) => s.plus(a.totalAmount), new Decimal(0));

const pct = (v: Decimal, of: Decimal) => v.dividedBy(of).times(100).toDecimalPlaces(2);
const money = (v: Decimal) =>
  v.toDecimalPlaces(2).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

console.log('\nRECIPE COVERAGE CURVE — Siyonat Branch, 8 July to 3 August 2026\n');
console.log(`Total revenue in the file      ${money(grand).padStart(16)} birr  (171 articles)`);
console.log(
  `Can never be costed            ${money(uncostableRevenue).padStart(16)} birr  ` +
    `(${uncostable.length} articles, ${pct(uncostableRevenue, grand)}%)`,
);
console.log(
  `Costable ceiling               ${money(costableRevenue).padStart(16)} birr  ` +
    `(${costable.length} articles, ${pct(costableRevenue, grand)}%)`,
);

// Walk down the ranked list accumulating revenue.
const milestones = [25, 50, 80, 90, 95, 99];
const hits = new Map<number, { n: number; revenue: Decimal }>();
let running = new Decimal(0);

costable.forEach((a, i) => {
  running = running.plus(a.totalAmount);
  for (const m of milestones) {
    if (!hits.has(m) && running.dividedBy(costableRevenue).times(100).greaterThanOrEqualTo(m)) {
      hits.set(m, { n: i + 1, revenue: running });
    }
  }
});

console.log('\n  Recipes needed to reach a share of costable revenue');
console.log('  ┌────────────┬──────────┬────────────────────┬──────────────┐');
console.log('  │ Target     │ Recipes  │ Revenue covered    │ Of all sales │');
console.log('  ├────────────┼──────────┼────────────────────┼──────────────┤');
for (const m of milestones) {
  const h = hits.get(m);
  if (!h) continue;
  console.log(
    `  │ ${String(m + '%').padEnd(10)} │ ${String(h.n).padStart(8)} │ ` +
      `${money(h.revenue).padStart(14)} ETB │ ${(pct(h.revenue, grand) + '%').padStart(12)} │`,
  );
}
console.log('  └────────────┴──────────┴────────────────────┴──────────────┘');

console.log('\n  Top 15 articles by revenue');
console.log('  ┌────┬────────────┬───────────────────────────────────┬──────────────┬─────────┬───────┐');
console.log('  │  # │ Code       │ Article                           │ Revenue      │ Cum. %  │ Done  │');
console.log('  ├────┼────────────┼───────────────────────────────────┼──────────────┼─────────┼───────┤');
let cum = new Decimal(0);
costable.slice(0, 15).forEach((a, i) => {
  cum = cum.plus(a.totalAmount);
  console.log(
    `  │ ${String(i + 1).padStart(2)} │ ${a.articleCode.padEnd(10)} │ ` +
      `${a.articleName.trim().slice(0, 33).padEnd(33)} │ ` +
      `${money(a.totalAmount).padStart(12)} │ ` +
      `${(pct(cum, costableRevenue) + '%').padStart(7)} │ ` +
      `${(SEEDED.has(a.articleCode) ? '  yes' : '   -').padEnd(5)} │`,
  );
});
console.log('  └────┴────────────┴───────────────────────────────────┴──────────────┴─────────┴───────┘');

const seededRevenue = costable
  .filter((a) => SEEDED.has(a.articleCode))
  .reduce((s, a) => s.plus(a.totalAmount), new Decimal(0));
console.log(
  `\n  The ${MENU_ITEMS.length} recipes already written cover ${money(seededRevenue)} birr — ` +
    `${pct(seededRevenue, costableRevenue)}% of costable revenue.\n`,
);

console.log('  Articles that can never be costed, with their revenue:');
for (const a of uncostable.sort((x, y) => y.totalAmount.comparedTo(x.totalAmount))) {
  console.log(
    `    ${a.articleCode.padEnd(10)} ${a.articleName.trim().padEnd(24)} ` +
      `${money(a.totalAmount).padStart(12)} birr   ${a.qty.toString().padStart(5)} units`,
  );
}
console.log();
