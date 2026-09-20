-- 013_purchase_requests.sql
-- Purchase Requests: an outlet asks the main store/purchasing to buy an item from a supplier.

create table purchase_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  requesting_store_id  uuid not null references stores(id),
  status               text not null default 'draft'
                       check (status in ('draft', 'requested', 'resolved', 'cancelled')),
  requested_by_user_id uuid references users(id),
  requested_at         timestamptz not null default now(),
  note                 text
);

create index purchase_requests_by_store on purchase_requests (tenant_id, requesting_store_id, status);

create table purchase_request_lines (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  request_id         uuid not null references purchase_requests(id) on delete cascade,
  item_id            uuid not null references items(id),
  requested_qty      numeric(18,6) not null check (requested_qty > 0),
  note               text,
  unique (tenant_id, request_id, item_id)
);

create index purchase_request_lines_by_request on purchase_request_lines (request_id);

-- Forward-only discipline
create or replace function purchase_requests_status_forward_only() returns trigger as $$
begin
  if old.status = 'resolved' and new.status <> 'resolved' then
    raise exception 'a resolved purchase request is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled purchase request is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger purchase_requests_status_forward_only_trg
  before update on purchase_requests
  for each row execute function purchase_requests_status_forward_only();
