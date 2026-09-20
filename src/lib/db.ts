/**
 * Database access.
 *
 * Everything downstream talks to the `Db` interface, so it does not matter
 * which of the two drivers is underneath:
 *
 *   DATABASE_URL set    -> node-postgres against a real PostgreSQL server
 *   DATABASE_URL unset  -> PGlite, which is PostgreSQL itself compiled to
 *                          WASM, running in-process with nothing to install
 *
 * The SQL is plain PostgreSQL either way: no extensions, no managed-service
 * features, no edge runtime. The deployment target is still undecided and this
 * has to be able to run on a laptop at the property.
 */

import type { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';

export interface QueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number;
}

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
  /**
   * Run a multi-statement script with no parameters - migrations only.
   * `query` goes through the extended protocol, which permits exactly one
   * statement; this uses the simple protocol, which does not.
   */
  exec(sql: string): Promise<void>;
}

/** A Db that is inside a transaction. */
export type Tx = Db;

export interface Database extends Db {
  /**
   * Run `fn` inside a single transaction. Commits on return, rolls back on
   * throw. postSalesImport depends on this being a real transaction: a
   * half-posted import would be worse than no import at all.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: 'pg' | 'pglite';
}

/* ------------------------------------------------------------------ PGlite */

class PgliteDatabase implements Database {
  readonly driver = 'pglite' as const;
  // PGlite is single-connection, so transactions must not interleave.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private pg: PGlite) {}

  async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const res = await this.pg.query(sql, params as never[]);
    return { rows: res.rows as R[], rowCount: res.affectedRows ?? res.rows.length };
  }

  async exec(sql: string) {
    await this.pg.exec(sql);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.pg.exec('begin');
      try {
        const out = await fn({
          query: (sql, params) => this.query(sql, params),
          exec: (sql) => this.exec(sql),
        });
        await this.pg.exec('commit');
        return out;
      } catch (err) {
        await this.pg.exec('rollback');
        throw err;
      }
    };
    const next = this.chain.then(run, run);
    // keep the chain alive even when a transaction throws
    this.chain = next.catch(() => undefined);
    return next;
  }

  async close() {
    await this.pg.close();
  }
}

/* -------------------------------------------------------------- PostgreSQL */

class PgDatabase implements Database {
  readonly driver = 'pg' as const;

  constructor(private pool: Pool) {}

  async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
  }

  async exec(sql: string) {
    // No parameters, so node-postgres uses the simple protocol and accepts a
    // multi-statement script.
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn({
        query: async (sql, params = []) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows as never[], rowCount: res.rowCount ?? res.rows.length };
        },
        exec: async (sql) => {
          await client.query(sql);
        },
      });
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

/* ----------------------------------------------------------------- factory */

export interface ConnectOptions {
  /** Postgres connection string. Falls back to DATABASE_URL. */
  url?: string;
  /** Where PGlite keeps its files. Falls back to PGLITE_DATA_DIR, then ./.pgdata. */
  dataDir?: string;
  /** Discard everything on close. What the tests use, so each run starts from nothing. */
  inMemory?: boolean;
}

export const DEFAULT_PGLITE_DIR = '.pgdata';

export async function connect(opts: ConnectOptions = {}): Promise<Database> {
  const url = opts.url ?? process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import('pg');
    // pg hands numeric back as a string by default, which is what we want:
    // parsing a numeric into a JS float is exactly the bug design rule 4 is
    // there to prevent. Nothing in this codebase should ever undo that.
    return new PgDatabase(new Pool({ connectionString: url }));
  }

  const { PGlite } = await import('@electric-sql/pglite');
  // Persisted by default, so `npm run db:reset` leaves a database behind for
  // the app to read. Tests ask for in-memory explicitly.
  const dataDir = opts.inMemory
    ? undefined
    : (opts.dataDir ?? process.env.PGLITE_DATA_DIR ?? DEFAULT_PGLITE_DIR);
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined);
  return new PgliteDatabase(pg);
}
