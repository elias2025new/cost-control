-- 008_auth.sql
-- Users and roles.
--
-- Two roles: 'admin' (full access, no store scope) and 'store_user' (scoped
-- to exactly one store — main, kitchen, or bar, per that store's own kind
-- column; the role does not duplicate stores.kind into a second enum).
--
-- No hard delete anywhere in this app's UI for users: once an account has
-- acted (an issue request, a count) it is FK-referenced almost immediately,
-- so deactivate (is_active) is the only path offered.

create table users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  username      text not null,
  password_hash text not null,
  display_name  text not null,
  role          text not null check (role in ('admin', 'store_user')),
  store_id      uuid references stores(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, username),
  check (role = 'admin' or store_id is not null),
  check (role = 'store_user' or store_id is null)
);
