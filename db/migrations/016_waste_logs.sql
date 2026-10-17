-- 016_waste_logs.sql
-- Waste & Leakage Logging: tracks kitchen burns, bar breakages, spoilage, comps, and staff meals.
-- Entered by kitchen/bar staff, approved by F&B Cost Controller before posting to the ledger.

create table waste_logs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  store_id            uuid not null references stores(id),
  occurred_on         date not null,
  status              text not null default 'draft'
                      check (status in ('draft', 'submitted', 'approved', 'rejected')),
  logged_by_user_id   uuid references users(id),
  approved_by_user_id uuid references users(id),
  approved_at         timestamptz,
  rejection_reason    text,
  note                text,
  created_at          timestamptz not null default now()
);

create index waste_logs_by_store on waste_logs (tenant_id, store_id, status);

create table waste_log_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  waste_log_id  uuid not null references waste_logs(id) on delete cascade,
  item_id       uuid not null references items(id),
  qty           numeric(18,6) not null check (qty > 0),
  reason        text not null check (reason in ('spoilage', 'burnt', 'spill', 'expired', 'comp', 'staff_meal')),
  unit_cost     numeric(18,2) check (unit_cost is null or unit_cost >= 0),
  total_cost    numeric(18,2) check (total_cost is null or total_cost >= 0),
  note          text,
  unique (tenant_id, waste_log_id, item_id, reason)
);

create index waste_log_lines_by_log on waste_log_lines (waste_log_id);

-- Forward-only discipline: once approved or rejected, a waste log is final.
create or replace function waste_logs_status_forward_only() returns trigger as $$
begin
  if old.status = 'approved' and new.status <> 'approved' then
    raise exception 'an approved waste log is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'a rejected waste log is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger waste_logs_status_forward_only_trg
  before update on waste_logs
  for each row execute function waste_logs_status_forward_only();

-- Backstop index against double-posting waste lines to stock_movements
create unique index stock_movements_waste_log_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'waste_log';
