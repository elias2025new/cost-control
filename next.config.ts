import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite and SheetJS are Node-side only. Never bundle them for the browser,
  // and never run any of this on an edge runtime.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'xlsx'],
};

export default config;
