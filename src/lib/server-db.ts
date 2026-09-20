import 'server-only';

import { connect, type Database } from './db';

/**
 * One database handle for the whole server process.
 *
 * PGlite holds its data directory open exclusively, and Next's dev server
 * re-evaluates modules on every change, so the handle has to outlive the
 * module. Hanging it off globalThis is the standard way to survive HMR.
 */
declare global {
  // eslint-disable-next-line no-var
  var __primeDb: Promise<Database> | undefined;
}

export function db(): Promise<Database> {
  if (!globalThis.__primeDb) globalThis.__primeDb = connect();
  return globalThis.__primeDb;
}
