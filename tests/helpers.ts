/**
 * Test harness: a fresh database per test file.
 *
 * With DATABASE_URL unset this is PGlite — PostgreSQL compiled to WASM,
 * in-process, nothing to install. With DATABASE_URL set the same tests run
 * against a real server, which is how we know the SQL is portable.
 */

import { connect, type Database } from '../src/lib/db';
import { migrate } from '../src/lib/migrate';
import { dropEverything, seed, type SeedResult } from '../db/seed/seed';

export interface Harness {
  db: Database;
  seeded: SeedResult;
  close: () => Promise<void>;
}

export async function freshDb(): Promise<Database> {
  // In-memory, so nothing carries over between runs or between test files.
  const db = await connect({ inMemory: true });
  if (process.env.DATABASE_URL) await dropEverything(db);
  await migrate(db, { quiet: true });
  return db;
}

export async function seededDb(): Promise<Harness> {
  const db = await freshDb();
  const seeded = await seed(db, { quiet: true });
  return { db, seeded, close: () => db.close() };
}

export const CNET_FIXTURE = 'reference/cnet_sales_export.xlsx';
