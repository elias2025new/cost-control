-- 022_production_batches_and_yield_tests.sql
-- Phase 3: Production Batches & Yield Engineering (PROD.EXE / MENU.EXE)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Batch Production of Sub-Recipes (PRODUKTION / PRODPOS / ProductionDBusinessObject.cs)
-- - Butcher Tests & Yield Cut Calculations (YIELD / YIELDPOS / YieldBusinessObject.cs)

-- 1. Extend stock_movements constraint to allow production & butchery movements
alter table stock_movements drop constraint if exists stock_movements_movement_type_check;

alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in (
    'opening',          -- opening balance
    'receipt',          -- purchase received into a store
    'issue_out',        -- leaves the issuing store
    'issue_in',         -- arrives at the receiving store
    'transfer_out',     -- inter-outlet, leaves
    'transfer_in',      -- inter-outlet, arrives
    'sale_depletion',   -- exploded from a recipe on a posted sale
    'wastage',
    'comp',             -- complimentary
    'staff_meal',       -- costed at raw ingredient cost
    'count_adjustment', -- physical count correction
    'reversal',
    'production_issue',   -- raw ingredients consumed in batch prep
    'production_receipt', -- finished sub-recipe batch booked to stock
    'butcher_primal_issue', -- primal cut issued to butcher block
    'butcher_cut_receipt'   -- prime cuts/byproducts yielded from butchery
  ));

-- 2. Production Batches (HMC PRODUKTION)
create table if not exists production_batches (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  batch_number     text not null,
  store_id         uuid not null references stores(id),
  recipe_id        uuid references recipes(id),
  target_item_id   uuid references items(id),
  batch_qty        numeric(18,6) not null check (batch_qty > 0),
  produced_qty     numeric(18,6) not null check (produced_qty > 0),
  produced_uom     text not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'scheduled', 'posted', 'reversed')),
  production_date  date not null default current_date,
  notes            text,
  total_cost       numeric(18,2) not null default 0.0 check (total_cost >= 0),
  unit_cost        numeric(18,2) not null default 0.0 check (unit_cost >= 0),
  created_by       text not null default 'system',
  created_at       timestamptz not null default now(),
  posted_at        timestamptz,
  unique (tenant_id, batch_number)
);

create index if not exists idx_production_batches_store
  on production_batches (tenant_id, store_id, status);

-- 3. Production Batch Ingredient Lines (HMC PRODPOS)
create table if not exists production_batch_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  batch_id     uuid not null references production_batches(id) on delete cascade,
  line_no      integer not null,
  item_id      uuid not null references items(id),
  planned_qty  numeric(18,6) not null check (planned_qty > 0),
  actual_qty   numeric(18,6) not null check (actual_qty > 0),
  uom          text not null,
  unit_cost    numeric(18,2) not null default 0.0 check (unit_cost >= 0),
  line_cost    numeric(18,2) not null default 0.0 check (line_cost >= 0),
  unique (batch_id, line_no)
);

create index if not exists idx_production_batch_lines_batch
  on production_batch_lines (batch_id, item_id);

-- 4. Butcher / Yield Tests (HMC YIELD)
create table if not exists yield_tests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  test_number        text not null,
  store_id           uuid not null references stores(id),
  primal_item_id     uuid not null references items(id),
  test_date          date not null default current_date,
  gross_weight       numeric(18,6) not null check (gross_weight > 0),
  gross_cost_per_kg  numeric(18,2) not null check (gross_cost_per_kg >= 0),
  total_primal_cost  numeric(18,2) not null check (total_primal_cost >= 0),
  usable_weight      numeric(18,6) not null default 0.0 check (usable_weight >= 0),
  waste_weight       numeric(18,6) not null default 0.0 check (waste_weight >= 0),
  yield_percent      numeric(5,2) not null default 0.0,
  loss_percent       numeric(5,2) not null default 0.0,
  cost_factor        numeric(8,4) not null default 1.0,
  status             text not null default 'draft'
                     check (status in ('draft', 'posted', 'reversed')),
  notes              text,
  created_by         text not null default 'system',
  created_at         timestamptz not null default now(),
  posted_at          timestamptz,
  unique (tenant_id, test_number)
);

create index if not exists idx_yield_tests_lookup
  on yield_tests (tenant_id, primal_item_id, test_date);

-- 5. Butcher / Yield Test Breakdown Lines (HMC YIELDPOS)
create table if not exists yield_test_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  yield_test_id         uuid not null references yield_tests(id) on delete cascade,
  line_no               integer not null,
  cut_name              text not null,
  item_id               uuid references items(id),
  is_byproduct          boolean not null default false,
  weight                numeric(18,6) not null check (weight >= 0),
  weight_percent        numeric(5,2) not null default 0.0,
  market_price_per_kg   numeric(18,2) not null default 0.0,
  allocated_cost_per_kg numeric(18,2) not null default 0.0,
  total_line_cost       numeric(18,2) not null default 0.0,
  unique (yield_test_id, line_no)
);

create index if not exists idx_yield_test_lines_test
  on yield_test_lines (yield_test_id, item_id);
