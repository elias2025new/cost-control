-- 011_transfers.sql
-- Inter-store / inter-outlet stock transfers.
--
-- A transfer moves stock from one store to another at the current moving
-- weighted average cost of the SOURCE store. Two ledger rows are written
-- in the same transaction: transfer_out (negative qty_delta in the source)
-- and transfer_in (positive qty_delta in the destination).
--
-- Like purchases and issue requests, a transfer has a header + lines and
-- a forward-only status: draft → posted.

create table transfers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  from_store_id   uuid not null references stores(id),
  to_store_id     uuid not null references stores(id),
  status          text not null default 'draft'
                  check (status in ('draft', 'posted')),
  occurred_on     date not null,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      text not null default 'system',
  check (from_store_id <> to_store_id)
);

create index transfers_by_from_store on transfers (tenant_id, from_store_id, status);
create index transfers_by_to_store   on transfers (tenant_id, to_store_id,   status);

create table transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  transfer_id uuid not null references transfers(id) on delete cascade,
  item_id     uuid not null references items(id),
  qty         numeric(18,6) not null check (qty > 0),
  unique (tenant_id, transfer_id, item_id)
);

create index transfer_lines_by_transfer on transfer_lines (transfer_id);

-- Forward-only: once posted a transfer is final.
create or replace function transfers_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted transfer is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger transfers_status_forward_only_trg
  before update on transfers
  for each row execute function transfers_status_forward_only();

-- Prevent double-posting the same transfer line.
create unique index stock_movements_transfer_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'transfer'
    and movement_type in ('transfer_out', 'transfer_in');
