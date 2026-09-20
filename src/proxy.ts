import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionCookie } from './lib/session';

/**
 * The UX layer of access control, not the enforcement layer.
 *
 * This only ever verifies the signed session cookie - pure computation, no
 * database access (see session.ts for why: a second connection to the same
 * PGlite data directory from here risks a real lock conflict). Every
 * Server Action independently calls requireUser() too, which is the real
 * gate - Next's own docs warn a Proxy matcher change can silently stop
 * covering a Server Function's route, so this file redirecting early is a
 * convenience, not the boundary the app's safety depends on.
 *
 * Reachable with no session at all: the bootstrap screens. Each of those
 * pages does its own tenant/user-count check (real DB reads, safe there -
 * they're normal render-process code, not this file) and redirects onward
 * itself, so this file doesn't need to know whether a tenant or an admin
 * exists yet, only whether the request carries a valid cookie.
 */

const PUBLIC_PATHS = ['/login', '/setup/tenant', '/setup/admin'];


export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const session = verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (session.role === 'store_user') {
    const p = pathname;
    const hasPerm = (key: string) => session.permissions?.includes(key) || session.permissions?.includes('all');

    const blocked =
      p === '/' ||
      (p.startsWith('/setup') && !(p.startsWith('/setup/recipes') && hasPerm('recipe_build'))) ||
      p.startsWith('/import') ||
      p.startsWith('/dashboard') ||
      (p.startsWith('/recipes') && !hasPerm('recipe_view') && !hasPerm('recipe_build') && !hasPerm('recipe_cost_manage')) ||
      (p.startsWith('/variance') && !hasPerm('variance_view')) ||
      (p.startsWith('/ledger') && !hasPerm('ledger_view')) ||
      (p.startsWith('/issues') && !hasPerm('issue_create') && !hasPerm('issue_authorize'));

    if (blocked) {
      return NextResponse.redirect(new URL('/issues', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
