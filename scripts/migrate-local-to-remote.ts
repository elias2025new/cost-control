import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrate } from '../src/lib/migrate';
import { Database } from '../src/lib/db';

async function migrateData() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  console.log('Connecting to databases...');
  const local = await PGlite.create({ dataDir: '.pgdata' });
  const remotePool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  
  // We need a wrapper around the remote pool to pass to dropEverything and migrate
  // to reuse the same schema migration logic.
  const remoteDbAdapter: Database = {
    driver: 'pg',
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await remotePool.query(sql, params);
      return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await remotePool.query(sql);
    },
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return await fn(this);
    },
    async close() {
      // Not needed
    }
  };

  const client = await remotePool.connect();

  try {
    console.log('Resetting remote database schema...');
    await client.query('drop schema public cascade');
    await client.query('create schema public');

    console.log('Applying migrations to remote database...');
    await migrate(remoteDbAdapter);

    console.log('Disabling remote foreign key checks for migration...');
    await client.query("SET session_replication_role = 'replica';");

    console.log('Fetching local tables...');
    const { rows: tables } = await local.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE 'pg_%' 
      AND tablename NOT LIKE 'sql_%'
      AND tablename != 'schema_migrations'
    `);

    const { rows: generatedColsRows } = await local.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE is_generated = 'ALWAYS' AND table_schema = 'public'
    `);
    const generatedCols: Record<string, Set<string>> = (generatedColsRows as any[]).reduce((acc: any, row: any) => {
      acc[row.table_name] = acc[row.table_name] || new Set();
      acc[row.table_name].add(row.column_name);
      return acc;
    }, {});

    for (const { tablename } of tables as any[]) {
      const { rows } = await local.query(`SELECT * FROM "${tablename}"`);
      
      if (rows.length === 0) {
        console.log(`Skipping empty table ${tablename}`);
        continue;
      }
      
      console.log(`Migrating ${rows.length} rows for table ${tablename}...`);
      
      const tableGenCols = generatedCols[tablename] || new Set();
      
      for (const row of rows as any[]) {
        const entries = Object.entries(row).filter(([col]) => !tableGenCols.has(col));
        if (entries.length === 0) continue;
        
        const cols = entries.map(e => e[0]);
        const vals = entries.map(e => {
           let val = e[1];
           if (val instanceof Date) {
             return val.toISOString();
           }
           if (typeof val === 'object' && val !== null) {
             return JSON.stringify(val);
           }
           return val;
        });
        
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        const query = `INSERT INTO "${tablename}" ("${cols.join('", "')}") VALUES (${placeholders})`;
        await client.query(query, vals);
      }
    }

    console.log('Re-enabling foreign key checks...');
    await client.query("SET session_replication_role = 'origin';");
    
    console.log('Migration successfully completed!');
  } catch (err) {
    console.error('Migration failed!', err);
  } finally {
    client.release();
    await remotePool.end();
  }
}

migrateData().catch(console.error);
