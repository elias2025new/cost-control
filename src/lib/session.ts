import 'server-only';

/**
 * Sessions and passwords - deliberately dependency-free (Node's built-in
 * `crypto`, nothing else) and deliberately DB-free.
 *
 * DB-free is the load-bearing property here, not an accident: proxy.ts
 * verifies every request's session cookie, and Next's own docs warn Proxy
 * "should not rely on shared modules or globals" and may run separately
 * from the render process. This app's db() connection is a globalThis
 * singleton, and in dev (PGlite) it holds its data directory open
 * exclusively - a second connection opened from Proxy risks a real lock
 * conflict. A signed cookie sidesteps the question entirely: verifying it
 * is pure computation (decode, HMAC, compare, check expiry), safe to run
 * identically in two separate module instances because neither holds any
 * state. Nothing in this file may import db.ts or server-db.ts - that
 * boundary is the whole point of the file existing separately from
 * queries.ts.
 *
 * The cost of statelessness: a deactivated user's already-issued cookie
 * can't be revoked early, only blocked from a future login. The cookie is
 * kept short-lived (one shift) specifically to bound that gap, rather than
 * building a DB-backed revocation check this deployment doesn't warrant.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // one shift

export interface SessionPayload {
  uid: string;
  tenantId: string;
  role: 'admin' | 'store_user';
  storeId: string | null;
  displayName: string;
  permissions: string[];
  exp: number; // unix seconds
}

/* ------------------------------------------------------------ the secret */

const SECRET_PATH = join(process.cwd(), '.pgdata', 'session-secret');

function loadOrCreateSecret(): Buffer {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return Buffer.from(fromEnv, 'utf8');

  try {
    return Buffer.from(readFileSync(SECRET_PATH, 'utf8'), 'hex');
  } catch {
    // Fall through to create it.
  }

  const secret = randomBytes(32);
  try {
    mkdirSync(join(process.cwd(), '.pgdata'), { recursive: true });
    // Exclusive create: if another process/module instance won the race to
    // create this first, fall back to reading what they wrote rather than
    // overwriting it - two racing writers must not disagree on the secret.
    writeFileSync(SECRET_PATH, secret.toString('hex'), { flag: 'wx' });
  } catch {
    return Buffer.from(readFileSync(SECRET_PATH, 'utf8'), 'hex');
  }
  return secret;
}

// Computed once, at first import - eagerly, from ordinary request-process
// code (a page or action importing this module), never lazily inside
// proxy.ts, which should not perform first-time side effects.
const SECRET = loadOrCreateSecret();

/* --------------------------------------------------------------- base64url */

const toB64Url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64Url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ---------------------------------------------------------------- signing */

export function signSession(payload: SessionPayload): string {
  const body = toB64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = toB64Url(createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionCookie(cookieValue: string | undefined): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);

  const expectedSig = createHmac('sha256', SECRET).update(body).digest();
  const gotSig = fromB64Url(sig);
  if (gotSig.length !== expectedSig.length || !timingSafeEqual(gotSig, expectedSig)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64Url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  return payload;
}

/* ------------------------------------------------------------- passwords */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const got = scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
