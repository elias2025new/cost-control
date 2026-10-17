-- 019_store_cost_centers_and_par.sql
-- Expand stores to support hospitality cost centers, default fulfilling stores,
-- and rich par stock configuration.

-- 1. Relax kind check to allow modern restaurant cost center types
alter table stores drop constraint if exists stores_kind_check;
alter table stores add constraint stores_kind_check check (
  kind in ('main', 'kitchen', 'bar', 'cellar', 'prep', 'outlet')
);

-- 2. Add default fulfilling store and description
alter table stores
  add column if not exists default_fulfilling_store_id uuid references stores(id),
  add column if not exists description text;

-- 3. Avoid self-referencing fulfilling store
alter table stores drop constraint if exists stores_no_self_fulfill;
alter table stores add constraint stores_no_self_fulfill check (
  default_fulfilling_store_id is null or default_fulfilling_store_id <> id
);
