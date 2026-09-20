-- 014_purchase_returns.sql
-- Allow reversing a posted purchase receipt.

-- Drop the old constraint that only allowed 'draft' and 'posted'
alter table purchases drop constraint purchases_status_check;

-- Add the new constraint
alter table purchases add constraint purchases_status_check
  check (status in ('draft', 'posted', 'reversed'));

-- Update the forward-only trigger to allow posted -> reversed,
-- and make reversed a final terminal state.
create or replace function purchases_status_forward_only() returns trigger as $$
begin
  if old.status = 'posted' and new.status not in ('posted', 'reversed') then
    raise exception 'a posted purchase is final and can only be reversed'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'a reversed purchase is final'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;
