import { connect } from '../src/lib/db';

const db = await connect();
try {
  const t = await db.query<{ name: string }>('select name from tenants');
  const a = await db.query<{ c: string }>('select count(*)::text as c from pos_item_map');
  const r = await db.query<{ c: string }>('select count(*)::text as c from recipes');
  const m = await db.query<{ c: string }>('select count(*)::text as c from stock_movements');
  if (!t.rows.length) {
    console.log('EMPTY — open the app and visit /setup/tenant (or run `npm run db:seed` to load the demo dataset)');
    process.exit(1);
  }
  console.log(`OK  ${t.rows[0].name}`);
  console.log(`    ${a.rows[0].c} articles, ${r.rows[0].c} recipes, ${m.rows[0].c} stock movements`);
} finally {
  await db.close();
}
