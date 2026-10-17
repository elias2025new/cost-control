-- 024_pos_depletion_and_theoretical_reconciliation.sql
-- Phase 5: End-of-Day Sales Depletion & Theoretical Reconciliation Engine (HMC Soll-Ist-Vergleich, FBCalculation.cs)
-- Note: Sales enter the system via End-of-Day CNet export file uploads (sales_imports), NOT direct POS connection.

-- 1. Drop pos_daily_sessions if previously created
drop table if exists pos_daily_sessions cascade;

-- 2. Stored Procedure: Calculate Theoretical vs. Actual Consumption Matrix (HMC Soll-Ist-Vergleich)
-- Calculates full Material Consumption equation over any given date range per store:
--   Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
--   Theoretical Consumption = POS Depletions (from EOD CNet uploads) + Approved Wastage + Comps + Staff Meals
--   Unexplained Variance = Actual - Theoretical
create or replace function calculate_theoretical_vs_actual_matrix(
  p_tenant     uuid,
  p_store      uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  item_id                     uuid,
  item_code                   text,
  item_name                   text,
  category                    text,
  uom                         text,
  opening_qty                 numeric,
  received_qty                numeric,
  transfers_net_qty           numeric,
  production_net_qty          numeric,
  closing_qty                 numeric,
  actual_consumption_qty      numeric,
  pos_depletion_qty           numeric,
  waste_qty                   numeric,
  comp_qty                    numeric,
  staff_meal_qty              numeric,
  theoretical_consumption_qty numeric,
  variance_qty                numeric,
  unit_cost                   numeric,
  variance_value              numeric,
  variance_pct                numeric,
  variance_status             text,
  probable_cause              text
) as $$
declare
  v_item record;
  v_open_qty numeric;
  v_rec_qty numeric;
  v_trans_qty numeric;
  v_prod_qty numeric;
  v_close_qty numeric;
  v_act_cons numeric;
  v_dep_qty numeric;
  v_wast_qty numeric;
  v_comp_qty numeric;
  v_meal_qty numeric;
  v_theo_cons numeric;
  v_var_qty numeric;
  v_cost numeric;
  v_var_val numeric;
  v_var_pct numeric;
  v_status text;
  v_cause text;
begin
  for v_item in
    select i.id, i.code, i.name, c.code as category, i.uom
      from items i
      join item_categories c on c.id = i.category_id
     where i.tenant_id = p_tenant
     order by c.code, i.code
  loop
    -- A. Opening Stock (on-hand balance before p_start_date)
    select coalesce(sum(m.qty_delta), 0)
      into v_open_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.occurred_on < p_start_date;

    -- B. Receipts (purchases received during period)
    select coalesce(sum(m.qty_delta), 0)
      into v_rec_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type = 'receipt'
       and m.occurred_on between p_start_date and p_end_date;

    -- C. Net Transfers & Issues during period
    select coalesce(sum(case
             when m.movement_type in ('transfer_in', 'issue_in') then m.qty_delta
             when m.movement_type in ('transfer_out', 'issue_out') then m.qty_delta
             else 0
           end), 0)
      into v_trans_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('transfer_in', 'issue_in', 'transfer_out', 'issue_out')
       and m.occurred_on between p_start_date and p_end_date;

    -- D. Net Production (batches & butcher yields)
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.qty_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.qty_delta
             else 0
           end), 0)
      into v_prod_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
       and m.occurred_on between p_start_date and p_end_date;

    -- E. Closing Stock (from posted stock count at p_end_date if exists, else ledger balance)
    select scl.counted_qty
      into v_close_qty
      from stock_counts sc
      join stock_count_lines scl on scl.stock_count_id = sc.id and scl.item_id = v_item.id
     where sc.tenant_id = p_tenant
       and sc.store_id = p_store
       and sc.count_date = p_end_date
       and sc.status = 'posted'
     limit 1;

    if v_close_qty is null then
      -- Fallback to running ledger balance as of p_end_date
      select coalesce(sum(m.qty_delta), 0)
        into v_close_qty
        from stock_movements m
       where m.tenant_id = p_tenant
         and m.store_id = p_store
         and m.item_id = v_item.id
         and m.occurred_on <= p_end_date;
    end if;

    -- F. POS Recipe Depletions (sale_depletion from EOD CNet uploads)
    select coalesce(-sum(m.qty_delta), 0)
      into v_dep_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type = 'sale_depletion'
       and m.occurred_on between p_start_date and p_end_date;

    -- G. Logged Losses: Wastage, Comps, Staff Meals
    select coalesce(-sum(case when m.movement_type = 'wastage' then m.qty_delta else 0 end), 0),
           coalesce(-sum(case when m.movement_type = 'comp' then m.qty_delta else 0 end), 0),
           coalesce(-sum(case when m.movement_type = 'staff_meal' then m.qty_delta else 0 end), 0)
      into v_wast_qty, v_comp_qty, v_meal_qty
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = v_item.id
       and m.movement_type in ('wastage', 'comp', 'staff_meal')
       and m.occurred_on between p_start_date and p_end_date;

    -- Skip items with absolutely zero activity across all dimensions
    if v_open_qty = 0 and v_rec_qty = 0 and v_trans_qty = 0 and v_prod_qty = 0
       and v_close_qty = 0 and v_dep_qty = 0 and v_wast_qty = 0 and v_comp_qty = 0 and v_meal_qty = 0 then
      continue;
    end if;

    -- H. Actual Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
    v_act_cons := round(v_open_qty + v_rec_qty + v_trans_qty + v_prod_qty - v_close_qty, 6);

    -- I. Theoretical Consumption = POS Depletions + Waste + Comps + Staff Meals
    v_theo_cons := round(v_dep_qty + v_wast_qty + v_comp_qty + v_meal_qty, 6);

    -- If no count existed, actual equals theoretical plus uncounted adjustments
    if v_act_cons < 0 and v_theo_cons > 0 then
      v_act_cons := v_theo_cons;
    end if;

    -- J. Unexplained Variance = Actual - Theoretical
    v_var_qty := round(v_act_cons - v_theo_cons, 6);

    -- Current moving average unit cost
    select current_avg_cost(p_tenant, p_store, v_item.id)
      into v_cost;
    v_cost := coalesce(v_cost, 0);

    v_var_val := round(v_var_qty * v_cost, 2);

    v_var_pct := case
      when v_theo_cons > 0 then round((v_var_qty / v_theo_cons) * 100.0, 2)
      when v_var_qty > 0 then 100.0
      else 0.0
    end;

    -- Status classification & probable cause
    if abs(v_var_val) > 500.0 or abs(v_var_pct) > 5.0 then
      v_status := 'LEAKAGE_ALERT';
      if v_var_qty > 0 then
        if v_dep_qty > 0 and v_wast_qty = 0 then
          v_cause := 'OVER_PORTIONING';
        else
          v_cause := 'UNRECORDED_WASTE_OR_THEFT';
        end if;
      else
        v_cause := 'COUNTING_ERROR_OR_SURPLUS';
      end if;
    elsif abs(v_var_val) > 100.0 or abs(v_var_pct) > 2.0 then
      v_status := 'REVIEW';
      v_cause := case when v_var_qty > 0 then 'PORTION_DRIFT' else 'SURPLUS_UNDER_REVIEW' end;
    else
      v_status := 'NORMAL';
      v_cause := 'ON_TARGET';
    end if;

    return query
    select
      v_item.id,
      v_item.code,
      v_item.name,
      v_item.category,
      v_item.uom,
      v_open_qty,
      v_rec_qty,
      v_trans_qty,
      v_prod_qty,
      v_close_qty,
      v_act_cons,
      v_dep_qty,
      v_wast_qty,
      v_comp_qty,
      v_meal_qty,
      v_theo_cons,
      v_var_qty,
      v_cost,
      v_var_val,
      v_var_pct,
      v_status,
      v_cause;
  end loop;
end;
$$ language plpgsql stable;
