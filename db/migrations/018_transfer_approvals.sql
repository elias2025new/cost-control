-- 018_transfer_approvals.sql
-- Add dispatch and acceptance stages to inter-outlet transfers.

alter table transfers drop constraint transfers_status_check;

alter table transfers add constraint transfers_status_check
  check (status in ('draft', 'dispatched', 'posted', 'cancelled'));

alter table transfers add column dispatched_by_user_id uuid references users(id);
alter table transfers add column dispatched_at timestamptz;
alter table transfers add column accepted_by_user_id uuid references users(id);
alter table transfers add column accepted_at timestamptz;

create or replace function transfers_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status <> 'posted' then
    raise exception 'a posted transfer is final'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled transfer is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;
