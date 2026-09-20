-- 009_issue_requests.sql
-- Issue requests: an outlet (kitchen, bar) asks the main store for stock,
-- the main store releases it, and the ledger records the transfer.
--
-- The client's spec describes a fuller chain — three manager approvals, then
-- the requester separately approving and receiving. How many approval levels
-- are really wanted is an open question in the brief, so this models the two
-- ends that are certain (a request is made; stock is released and moves) and
-- the request screen shows the fuller chain inert, the same way every other
-- undecided approval workflow in this app is shown but not built.
--
-- Shaped after stock_counts / stock_count_lines: a header carrying a status,
-- lines carrying quantities, and a forward-only status trigger.

create table issue_requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  requesting_store_id  uuid not null references stores(id),
  fulfilling_store_id  uuid not null references stores(id),
  status               text not null default 'requested'
                       check (status in ('requested', 'fulfilled', 'cancelled')),
  requested_by_user_id uuid references users(id),
  fulfilled_by_user_id uuid references users(id),
  requested_at         timestamptz not null default now(),
  fulfilled_at         timestamptz,
  note                 text,
  -- A store cannot issue to itself. Deliberately NOT constraining the
  -- fulfilling store to kind='main' here: the client's "Inter-Outlet
  -- Transfer" (bar to kitchen) is out of scope now but would reuse this
  -- shape, and an app-level rule can relax without a migration.
  check (requesting_store_id <> fulfilling_store_id)
);

create index issue_requests_by_store
  on issue_requests (tenant_id, requesting_store_id, status);

create table issue_request_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  issue_request_id uuid not null references issue_requests(id) on delete cascade,
  item_id          uuid not null references items(id),
  requested_qty    numeric(18,6) not null check (requested_qty > 0),
  fulfilled_qty    numeric(18,6) check (fulfilled_qty is null or fulfilled_qty >= 0),
  note             text,
  unique (tenant_id, issue_request_id, item_id)
);

create index issue_request_lines_by_request on issue_request_lines (issue_request_id);

-- Same forward-only discipline as stock_counts: once released or cancelled,
-- a request never returns to an earlier state.
create or replace function issue_requests_status_forward_only() returns trigger as $$
begin
  if old.status = 'fulfilled' and new.status <> 'fulfilled' then
    raise exception 'a fulfilled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled issue request is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger issue_requests_status_forward_only_trg
  before update on issue_requests
  for each row execute function issue_requests_status_forward_only();

-- The backstop against a double release, mirroring
-- stock_movements_sale_depletion_once. The domain function locks the header
-- and re-checks status, which should be enough — this index is what makes
-- "should be" unnecessary to trust.
create unique index stock_movements_issue_fulfillment_once
  on stock_movements (source_doc_id, source_doc_line, store_id, item_id)
  where source_doc_type = 'issue_request'
    and movement_type in ('issue_out', 'issue_in');
