-- 017_request_approvals.sql
-- Add Chef/Bar Manager pre-approval workflow to issue requests before storekeeper fulfillment.

alter table issue_requests drop constraint issue_requests_status_check;

alter table issue_requests add constraint issue_requests_status_check
  check (status in ('draft', 'requested', 'approved', 'fulfilled', 'cancelled'));

alter table issue_requests add column approved_by_user_id uuid references users(id);
alter table issue_requests add column approved_at timestamptz;

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
