/**
 * Import and post the reference CNET file into the demo database.
 *
 *   npm run demo:import          import and post
 *   npm run demo:import -- --no-post   import only, leave it awaiting review
 *
 * Stop the dev server first: PGlite holds its data directory open, and two
 * processes must not write to it at once.
 */

import { join } from 'node:path';
import { connect } from '../src/lib/db';
import { importCnetFile } from '../src/domain/importCnet';
import { postSalesImport } from '../src/domain/postSalesImport';

const CNET = join(process.cwd(), 'reference', 'cnet_sales_export.xlsx');
const post = !process.argv.includes('--no-post');

const db = await connect();
try {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from tenants order by created_at limit 1`,
  );
  if (!rows.length) throw new Error('No tenant. Run `npm run db:reset` first.');

  console.log(`Importing ${CNET}`);
  const result = await importCnetFile(db, rows[0].id, CNET);

  console.log(`  ${result.lineCount} lines`);
  console.log(`  period ${result.periodStart} to ${result.periodEnd}`);
  console.log(`  reconciles: ${result.reconciled}`);
  console.log(`  blocking: ${result.blockingCount}   warnings: ${result.warningCount}`);

  if (!post) {
    console.log(`\nLeft awaiting review at /import/${result.importId}`);
  } else if (!result.canPost) {
    console.log(`\nCannot post — ${result.blockingCount} blocking problem(s).`);
  } else {
    const posted = await postSalesImport(db, result.importId);
    console.log(`\nPosted.`);
    console.log(`  ${posted.movementsWritten} stock movements`);
    console.log(`  ${posted.linesDepleted} lines depleted stock`);
    console.log(`  stock consumed: ${posted.totalDepletionValue.toFixed(2)} ETB`);
    console.log(
      `  cost coverage: ${posted.coverage.revenueCostedPct?.toFixed(2)}% ` +
        `(${posted.coverage.revenueUncosted.toFixed(2)} ETB uncosted)`,
    );
    console.log(`\n  /import/${result.importId}`);
  }
} finally {
  await db.close();
}
