/**
 * Migration runner. Applies db/migrations/*.sql in filename order, once each.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './db';

export const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

export async function migrate(db: Database, opts: { quiet?: boolean } = {}) {
  await db.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await db.query<{ filename: string }>('select filename from schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Each migration is one transaction: it applies whole or not at all.
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (filename) values ($1)', [file]);
    });
    ran.push(file);
    if (!opts.quiet) console.log(`  applied ${file}`);
  }
  return ran;
}
