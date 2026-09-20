-- 012_suppliers.sql
-- Supplier master list.
-- 
-- Before adding the supplier_id FK on purchases, we harvest any names already
-- stored there (from earlier free-text entries) so no data is lost.

create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,                       -- short reference code
  name        text not null,
  contact     text,                                -- contact person / phone
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, name)
);

create index suppliers_by_tenant on suppliers (tenant_id, is_active);

-- Harvest any free-text supplier names already in purchases so existing rows
-- survive the migration. Each unique name becomes one supplier record.
insert into suppliers (tenant_id, code, name)
select distinct
  p.tenant_id,
  -- code = upper-cased first 8 chars of name, stripped to alphanumeric
  upper(substring(regexp_replace(p.supplier_name, '[^a-zA-Z0-9]', '', 'g'), 1, 8)) as code,
  p.supplier_name as name
from purchases p
on conflict do nothing;

-- Add the FK column (nullable first so existing rows don't violate it).
alter table purchases add column supplier_id uuid references suppliers(id);

-- Wire up existing purchases to their newly-created supplier rows.
update purchases p
set    supplier_id = s.id
from   suppliers s
where  s.tenant_id = p.tenant_id
  and  s.name      = p.supplier_name;

-- Now make it mandatory, and drop the old free-text column.
alter table purchases alter column supplier_id set not null;
alter table purchases drop column supplier_name;
