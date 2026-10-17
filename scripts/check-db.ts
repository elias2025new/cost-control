import { connect } from '../src/lib/db';

const db = await connect();
try {
  const t = await db.query<{ name: string }>('select name from tenants');
  const a = await db.query<{ c: string }>('select count(*)::text as c from pos_item_map');
  const r = await db.query<{ c: string }>('select count(*)::text as c from recipes');
  const m = await db.query<{ c: string }>('select count(*)::text as c from stock_movements');
  const u = await db.query<{ username: string; display_name: string; department_group: string; all_stores_access: boolean }>(
    'select username, display_name, department_group, all_stores_access from users order by username'
  );
  if (!t.rows.length) {
    console.log('EMPTY — open the app and visit /setup/tenant (or run `npm run db:seed` to load the demo dataset)');
    process.exit(1);
  }
  console.log(`OK  ${t.rows[0].name}`);
  console.log(`    ${a.rows[0].c} articles, ${r.rows[0].c} recipes, ${m.rows[0].c} stock movements, ${u.rows.length} users`);
  for (const user of u.rows) {
    console.log(`    👤 ${user.username.padEnd(12)} | ${user.display_name.padEnd(25)} | ${user.department_group.padEnd(12)} | all-stores: ${user.all_stores_access}`);
  }
} finally {
  await db.close();
}
