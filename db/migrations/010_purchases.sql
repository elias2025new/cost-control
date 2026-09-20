-- 010_purchases.sql
-- Purchase Register: inbound deliveries from suppliers.

create table purchases (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  store_id         uuid not null references stores(id),
  supplier_name    text not null,
  reference_number text,
  status           text not null default 'draft'
                   check (status in ('draft', 'posted')),
  occurred_on      date not null,
  created_at       timestamptz not null default now(),
  created_by       text not null default 'system'
);

create index purchases_by_store on purchases (tenant_id, store_id, status);

create table purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  purchase_id  uuid not null references purchases(id) on delete cascade,
  item_id      uuid not null references items(id),
  qty          numeric(18,6) not null check (qty > 0),
  unit_cost    numeric(18,2) not null check (unit_cost >= 0),
  unique (tenant_id, purchase_id, item_id)
);

create index purchase_lines_by_purchase on purchase_lines (purchase_id);

-- Forward-only discipline: once posted, a purchase never returns to draft.
create or replace function purchases_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted purchase is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger purchases_status_forward_only_trg
  before update on purchases
  for each row execute function purchases_status_forward_only();

-- A backstop against double-posting a purchase line to the ledger.
create unique index stock_movements_purchase_receipt_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'purchase_receipt'
    and movement_type = 'receipt';
