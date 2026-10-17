-- 023_blind_counts_and_recipe_waste.sql
-- Phase 4: Stock Movement & Physical Count Engine (Stock.exe / INVENTUR.EXE / WASTE)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Blind Physical Count Sheets (hiding book stock from counters)
-- - Variance Recount Flags & Thresholds (INVENTUR.EXE / InventoryBusinessProcessObject.cs)
-- - Discrepancy Reason Codes & Adjustment Journals
-- - Recipe-Exploded Waste & Spoilage Logging (WASTE / AddRecipeToWastePos.cs)

-- 1. Extend stock_counts for Blind Counts & Recount Workflow
alter table stock_counts
  add column if not exists is_blind boolean not null default true,
  add column if not exists recount_requested boolean not null default false,
  add column if not exists recount_notes text,
  add column if not exists recount_by text;

alter table stock_counts drop constraint if exists stock_counts_status_check;

alter table stock_counts add constraint stock_counts_status_check
  check (status in ('draft', 'recount_required', 'approved', 'posted', 'reversed'));

-- 2. Extend stock_count_lines for Recount Tracking & Discrepancy Classification
alter table stock_count_lines
  add column if not exists first_counted_qty numeric(18,6),
  add column if not exists recount_qty numeric(18,6),
  add column if not exists recount_status text not null default 'none'
    check (recount_status in ('none', 'flagged', 'recounted', 'waived')),
  add column if not exists discrepancy_reason text
    check (discrepancy_reason is null or discrepancy_reason in (
      'spoilage', 'unrecorded_waste', 'theft', 'portion_error',
      'receiving_error', 'counting_error', 'other'
    ));

-- 3. Extend waste_log_lines to allow logging waste by Recipe / Dish (AddRecipeToWastePos.cs)
alter table waste_log_lines
  add column if not exists recipe_id uuid references recipes(id),
  add column if not exists portions numeric(18,6) check (portions is null or portions > 0);

alter table waste_log_lines alter column item_id drop not null;

alter table waste_log_lines drop constraint if exists waste_log_lines_item_or_recipe_chk;

alter table waste_log_lines add constraint waste_log_lines_item_or_recipe_chk
  check ((item_id is not null) or (recipe_id is not null));

alter table waste_log_lines drop constraint if exists waste_log_lines_tenant_id_waste_log_id_item_id_reason_key;

-- 4. Stored Procedure: Evaluate Count Recount Flags (HMC InventoryBusinessProcessObject.cs)
-- Checks count lines against variance thresholds (default: value > 500 ETB or variance % > 5%)
-- Flags discrepant lines and updates count status to 'recount_required' if discrepancies found
create or replace function evaluate_count_recounts(
  p_count_id           uuid,
  p_val_threshold      numeric default 500.0,
  p_pct_threshold      numeric default 5.0
) returns table (
  stock_count_id    uuid,
  status            text,
  flagged_lines     integer,
  total_variance_val numeric
) as $$
declare
  v_flagged integer := 0;
  v_total_val numeric := 0.0;
  v_line record;
  v_var_qty numeric;
  v_var_val numeric;
  v_var_pct numeric;
begin
  for v_line in
    select scl.id, scl.theoretical_qty, coalesce(scl.counted_qty, scl.first_counted_qty, 0) as counted, scl.unit_cost
      from stock_count_lines scl
     where scl.stock_count_id = p_count_id
       and (scl.counted_qty is not null or scl.first_counted_qty is not null)
  loop
    v_var_qty := abs(v_line.counted - v_line.theoretical_qty);
    v_var_val := v_var_qty * v_line.unit_cost;
    v_total_val := v_total_val + (v_line.counted - v_line.theoretical_qty) * v_line.unit_cost;

    v_var_pct := case
      when v_line.theoretical_qty > 0 then (v_var_qty / v_line.theoretical_qty) * 100.0
      when v_var_qty > 0 then 100.0
      else 0.0
    end;

    if v_var_val > p_val_threshold or v_var_pct > p_pct_threshold then
      v_flagged := v_flagged + 1;
      update stock_count_lines
         set recount_status = 'flagged'
       where id = v_line.id;
    else
      update stock_count_lines
         set recount_status = 'none'
       where id = v_line.id;
    end if;
  end loop;

  if v_flagged > 0 then
    update stock_counts sc
       set status = 'recount_required', recount_requested = true
     where sc.id = p_count_id and sc.status in ('draft', 'recount_required');
  else
    update stock_counts sc
       set status = 'approved', recount_requested = false
     where sc.id = p_count_id and sc.status in ('draft', 'recount_required');
  end if;

  return query
  select
    p_count_id,
    case when v_flagged > 0 then 'recount_required'::text else 'approved'::text end,
    v_flagged,
    round(v_total_val, 2);
end;
$$ language plpgsql;
