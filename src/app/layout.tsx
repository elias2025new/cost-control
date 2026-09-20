import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { NavLink } from '../components/NavLink';
import { NavDropdown } from '../components/NavDropdown';
import { currentTenant, currentUser } from '../lib/queries';
import { LogoutButton } from '../components/LogoutButton';
import { ThemeProvider } from '../components/ThemeProvider';
import { ThemeToggle } from '../components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Prime F&B Cost Control',
  description: 'Food and beverage cost control - Prime Hospitality Business Group',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [tenant, user] = await Promise.all([currentTenant(), currentUser()]);

  // Signed out - the login and bootstrap screens are self-contained and
  // get no sidebar, since none of its links would be reachable anyway.
  if (!user) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className="font-sans bg-ink-50 dark:bg-[#111111]">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
          </ThemeProvider>
        </body>
      </html>
    );
  }

  const isAdmin = user.role === 'admin';
  const hasPermission = (key: string) => {
    if (isAdmin) return true;
    if (user.permissions?.includes('all')) return true;
    return user.permissions?.includes(key);
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans flex flex-col min-h-screen bg-[#f5f5f5] dark:bg-[#111111] text-black dark:text-[#ededed]">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {/* ── Top navigation bar ── */}
        <header className="shrink-0 sticky top-0 z-50 print:hidden bg-[#d4d0c8] dark:bg-zinc-900 border-b border-[#808080] dark:border-zinc-800 text-[#1a1a1a] dark:text-zinc-100">
          {/* Brand row */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-[#808080] dark:border-zinc-800 bg-[#d4d0c8] dark:bg-zinc-900">
            <Link
              href={user.role === 'admin' ? '/' : '/ledger'}
              className="flex items-center gap-3 min-w-0"
            >
              <div className="flex flex-col leading-tight text-[#1a1a1a] dark:text-zinc-100">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#444444] dark:text-zinc-400">
                  {tenant ? tenant.name : 'Prime F&B Cost Control'}
                </span>
                <span className="text-[14px] font-bold text-[#1a1a1a] dark:text-zinc-100">
                  F&amp;B Cost Control
                </span>
              </div>
              {tenant && (
                <span className="text-[11px] pl-3 text-[#666666] dark:text-zinc-500 border-l border-[#999] dark:border-zinc-700">
                  {tenant.code}
                </span>
              )}
            </Link>

            {/* Push user info to the right */}
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-[12px] font-medium leading-tight text-[#1a1a1a] dark:text-zinc-200">
                  {user.displayName}
                </div>
                <div className="text-[10px] text-[#666666] dark:text-zinc-400">
                  {user.role === 'admin' ? 'Administrator' : 'Store user'}
                </div>
              </div>

              {/* Admin-only Setup shortcut — hidden from store users */}
              {isAdmin && (
                <Link
                  href="/setup"
                  title="System setup (admin only)"
                  className="inline-flex items-center justify-center w-[28px] h-[28px] rounded border border-[#999] dark:border-zinc-700 bg-[#c8c4bc] dark:bg-zinc-800 text-[#333] dark:text-zinc-300 hover:bg-[#b8b4ac] dark:hover:bg-zinc-700 shrink-0 transition-colors text-[15px] no-underline"
                >
                  ⚙
                </Link>
              )}
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>

          {/* Nav link row */}
          <nav className="flex items-center flex-wrap gap-0 px-1 bg-[#ece9d8] dark:bg-zinc-900 border-b border-[#808080] dark:border-zinc-800">
            <NavLink
              href="/"
              icon="🗠"
              label="Overview"
              disabled={!isAdmin}
              disabledReason="Only an administrator can open this."
            />
            
            <NavLink
              href="/purchases"
              icon="📦"
              label="Purchases"
            />
            
            <NavLink
              href="/issues"
              icon="📋"
              label="Issues"
              disabled={!hasPermission('issue_create') && !hasPermission('issue_authorize')}
            />
            
            <NavLink
              href="/transfers"
              icon="⇄"
              label="Transfers"
            />

            <NavLink
              href="/import"
              icon="↧"
              label="Sales import"
              disabled={!isAdmin}
              disabledReason="Only an administrator can open this."
            />

            <NavLink
              href="/ledger"
              icon="≡"
              label="Stock ledger"
              disabled={!hasPermission('ledger_view')}
              disabledReason="You do not have permission to view the ledger."
            />

            <NavLink
              href="/recipes"
              icon="🍽"
              label="Recipes & costs"
              disabled={!hasPermission('recipe_view') && !hasPermission('recipe_build') && !hasPermission('recipe_cost_manage')}
              disabledReason="You do not have permission to view recipes."
            />

            <NavLink
              href="/counts"
              icon="☑"
              label="Physical count"
            />

            <NavLink
              href="/variance"
              icon="⚠"
              label="Variance"
              disabled={!hasPermission('variance_view')}
              disabledReason="You do not have permission to view variance reports."
            />
          </nav>
        </header>

          {/* ── Main content area ── */}
          <main className="flex-1 overflow-x-hidden min-h-0 bg-[#f5f5f5] dark:bg-[#111111]">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
