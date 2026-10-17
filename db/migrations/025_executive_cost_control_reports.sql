-- 025_executive_cost_control_reports.sql
-- Phase 6: Materials Control Executive Reporting Suite (HMC FBCalculation, Cost Centers, Stock Card, ABC)

-- 1. Stored Procedure: Comprehensive F&B Actual vs. Theoretical Cost of Sales
-- Computes the full classical hotel F&B equation over any trading period for Food and Beverage:
--   Gross Consumption = Opening + Receipts + Net Transfers + Net Production - Closing
--   Net Cost of Sales = Gross Consumption - Staff Meals - Comps
--   Theoretical Cost = POS Depletions (from EOD sales uploads)
--   Variance Value = Net Cost of Sales - Theoretical Cost
create or replace function get_fb_cost_reconciliation(
  p_tenant     uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  kind                     text,
  revenue_total            numeric,
  revenue_costed           numeric,
  coverage_pct             numeric,
  opening_stock            numeric,
  purchases                numeric,
  transfers_in             numeric,
  transfers_out            numeric,
  production_net           numeric,
  closing_stock            numeric,
  gross_consumption        numeric,
  staff_meals              numeric,
  comps                    numeric,
  waste                    numeric,
  net_cost_of_sales        numeric,
  actual_cost_pct          numeric,
  theoretical_cost         numeric,
  theoretical_cost_pct     numeric,
  variance_value           numeric,
  cost_variance_pct        numeric,
  potential_savings        numeric
) as $$
declare
  v_kind text;
  v_store_kind text;
  v_rev_tot numeric;
  v_rev_cost numeric;
  v_cov_pct numeric;
  v_open numeric;
  v_purch numeric;
  v_trans_in numeric;
  v_trans_out numeric;
  v_prod_net numeric;
  v_close numeric;
  v_gross numeric;
  v_meals numeric;
  v_comps numeric;
  v_waste numeric;
  v_net_cost numeric;
  v_act_pct numeric;
  v_theo numeric;
  v_theo_pct numeric;
  v_var_val numeric;
  v_var_pct numeric;
  v_savings numeric;
begin
  for v_kind in select unnest(array['food', 'beverage']) loop
    v_store_kind := case when v_kind = 'food' then 'kitchen' else 'bar' end;

    -- Revenue from sales imports covering or within this period
    select
      coalesce(sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true)), 0),
      coalesce(sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true) and sl.depleted), 0)
    into v_rev_tot, v_rev_cost
    from sales_lines sl
    join sales_imports si on si.id = sl.sales_import_id
    left join pos_item_map pim on pim.id = sl.pos_item_map_id
    left join menu_items mi on mi.id = sl.menu_item_id
    where si.tenant_id = p_tenant
      and si.status = 'posted'
      and si.business_date between p_start_date and p_end_date
      and coalesce(mi.kind, pim.revenue_kind, 'other') = v_kind;

    v_cov_pct := case
      when v_rev_tot > 0 then round((v_rev_cost / v_rev_tot) * 100.0, 2)
      else null
    end;

    -- Opening Balance Value before p_start_date for stores of this kind
    select coalesce(sum(m.value_delta), 0)
    into v_open
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.occurred_on < p_start_date;

    -- Purchases / Receipts during period
    select coalesce(sum(m.value_delta), 0)
    into v_purch
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type = 'receipt'
      and m.occurred_on between p_start_date and p_end_date;

    -- Transfers In and Issues In
    select coalesce(sum(m.value_delta), 0)
    into v_trans_in
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('transfer_in', 'issue_in')
      and m.occurred_on between p_start_date and p_end_date;

    -- Transfers Out and Issues Out
    select coalesce(-sum(m.value_delta), 0)
    into v_trans_out
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('transfer_out', 'issue_out')
      and m.occurred_on between p_start_date and p_end_date;

    -- Net Production Batches & Butcher Yields
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.value_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.value_delta
             else 0
           end), 0)
    into v_prod_net
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
      and m.occurred_on between p_start_date and p_end_date;

    -- Closing Stock Value at p_end_date: from posted stock count if exists, else ledger running value
    select coalesce(sum(scl.counted_qty * scl.unit_cost), 0)
    into v_close
    from stock_counts sc
    join stores s on s.id = sc.store_id
    join stock_count_lines scl on scl.stock_count_id = sc.id
    where sc.tenant_id = p_tenant
      and s.kind = v_store_kind
      and sc.count_date = p_end_date
      and sc.status = 'posted';

    if v_close = 0 then
      select coalesce(sum(m.value_delta), 0)
      into v_close
      from stock_movements m
      join stores s on s.id = m.store_id
      where m.tenant_id = p_tenant
        and s.kind = v_store_kind
        and m.occurred_on <= p_end_date;
    end if;

    -- Theoretical Consumption (sales depletions from EOD CNet uploads)
    select coalesce(-sum(m.value_delta), 0)
    into v_theo
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type = 'sale_depletion'
      and m.occurred_on between p_start_date and p_end_date;

    -- Logged Losses: Staff Meals, Comps, Waste
    select
      coalesce(-sum(case when m.movement_type = 'staff_meal' then m.value_delta else 0 end), 0),
      coalesce(-sum(case when m.movement_type = 'comp' then m.value_delta else 0 end), 0),
      coalesce(-sum(case when m.movement_type = 'wastage' then m.value_delta else 0 end), 0)
    into v_meals, v_comps, v_waste
    from stock_movements m
    join stores s on s.id = m.store_id
    where m.tenant_id = p_tenant
      and s.kind = v_store_kind
      and m.movement_type in ('staff_meal', 'comp', 'wastage')
      and m.occurred_on between p_start_date and p_end_date;

    -- Gross Consumption = Opening + Receipts + Transfers In - Transfers Out + Net Production - Closing
    v_gross := round(v_open + v_purch + v_trans_in - v_trans_out + v_prod_net - v_close, 2);
    if v_gross < 0 then
      v_gross := round(v_theo + v_waste, 2);
    end if;

    -- Net Cost of Sales = Gross Consumption - Staff Meals - Comps
    v_net_cost := round(v_gross - v_meals - v_comps, 2);

    -- Actual Cost % against costed revenue
    v_act_pct := case
      when v_rev_cost > 0 then round((v_net_cost / v_rev_cost) * 100.0, 2)
      else null
    end;

    -- Theoretical Cost %
    v_theo_pct := case
      when v_rev_cost > 0 then round((v_theo / v_rev_cost) * 100.0, 2)
      else null
    end;

    -- Variance Value & Variance %
    v_var_val := round(v_net_cost - v_theo, 2);
    v_var_pct := case
      when v_act_pct is not null and v_theo_pct is not null then round(v_act_pct - v_theo_pct, 2)
      else null
    end;

    -- Potential Savings (positive variance represent preventable excess consumption)
    v_savings := case when v_var_val > 0 then v_var_val else 0 end;

    return query
    select
      v_kind,
      round(v_rev_tot, 2),
      round(v_rev_cost, 2),
      v_cov_pct,
      round(v_open, 2),
      round(v_purch, 2),
      round(v_trans_in, 2),
      round(v_trans_out, 2),
      round(v_prod_net, 2),
      round(v_close, 2),
      round(v_gross, 2),
      round(v_meals, 2),
      round(v_comps, 2),
      round(v_waste, 2),
      round(v_net_cost, 2),
      v_act_pct,
      round(v_theo, 2),
      v_theo_pct,
      round(v_var_val, 2),
      v_var_pct,
      round(v_savings, 2);
  end loop;
end;
$$ language plpgsql stable;

-- 2. Stored Procedure: Cost Center Comparison Matrix across Outlets
-- Summarizes deliveries, inter-store transfers, production, sales, and turnover per store
create or replace function get_cost_center_summary(
  p_tenant     uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  store_id              uuid,
  store_name            text,
  store_kind            text,
  opening_value         numeric,
  purchases_value       numeric,
  transfers_in_value    numeric,
  transfers_out_value   numeric,
  production_net_value  numeric,
  depletion_value       numeric,
  waste_value           numeric,
  closing_value         numeric,
  net_consumption_value numeric,
  turnover_ratio        numeric
) as $$
declare
  v_store record;
  v_open numeric;
  v_purch numeric;
  v_trans_in numeric;
  v_trans_out numeric;
  v_prod_net numeric;
  v_dep numeric;
  v_waste numeric;
  v_close numeric;
  v_net_cons numeric;
  v_avg_stock numeric;
  v_turnover numeric;
begin
  for v_store in
    select s.id, s.name, s.kind
      from stores s
     where s.tenant_id = p_tenant
     order by case s.kind when 'main' then 0 when 'kitchen' then 1 when 'bar' then 2 else 3 end, s.name
  loop
    -- Opening Balance
    select coalesce(sum(m.value_delta), 0)
      into v_open
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.occurred_on < p_start_date;

    -- Receipts (direct deliveries from suppliers)
    select coalesce(sum(m.value_delta), 0)
      into v_purch
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type = 'receipt'
       and m.occurred_on between p_start_date and p_end_date;

    -- Transfers / Issues In
    select coalesce(sum(m.value_delta), 0)
      into v_trans_in
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('transfer_in', 'issue_in')
       and m.occurred_on between p_start_date and p_end_date;

    -- Transfers / Issues Out
    select coalesce(-sum(m.value_delta), 0)
      into v_trans_out
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('transfer_out', 'issue_out')
       and m.occurred_on between p_start_date and p_end_date;

    -- Net Production
    select coalesce(sum(case
             when m.movement_type in ('production_receipt', 'butcher_cut_receipt') then m.value_delta
             when m.movement_type in ('production_issue', 'butcher_primal_issue') then m.value_delta
             else 0
           end), 0)
      into v_prod_net
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('production_receipt', 'butcher_cut_receipt', 'production_issue', 'butcher_primal_issue')
       and m.occurred_on between p_start_date and p_end_date;

    -- Depletions (from sales)
    select coalesce(-sum(m.value_delta), 0)
      into v_dep
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type = 'sale_depletion'
       and m.occurred_on between p_start_date and p_end_date;

    -- Waste, Comps, Staff Meals
    select coalesce(-sum(m.value_delta), 0)
      into v_waste
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = v_store.id
       and m.movement_type in ('wastage', 'comp', 'staff_meal')
       and m.occurred_on between p_start_date and p_end_date;

    -- Closing Balance
    select coalesce(sum(scl.counted_qty * scl.unit_cost), 0)
      into v_close
      from stock_counts sc
      join stock_count_lines scl on scl.stock_count_id = sc.id
     where sc.tenant_id = p_tenant
       and sc.store_id = v_store.id
       and sc.count_date = p_end_date
       and sc.status = 'posted';

    if v_close = 0 then
      select coalesce(sum(m.value_delta), 0)
        into v_close
        from stock_movements m
       where m.tenant_id = p_tenant
         and m.store_id = v_store.id
         and m.occurred_on <= p_end_date;
    end if;

    -- Net Consumption / Usage
    v_net_cons := round(v_open + v_purch + v_trans_in - v_trans_out + v_prod_net - v_close, 2);
    if v_net_cons < 0 then
      v_net_cons := round(v_dep + v_waste, 2);
    end if;

    -- Average Stock & Turnover: Turnover = Net Consumption / Avg Stock
    v_avg_stock := (v_open + v_close) / 2.0;
    v_turnover := case
      when v_avg_stock > 0 then round(v_net_cons / v_avg_stock, 2)
      else 0.0
    end;

    return query
    select
      v_store.id,
      v_store.name,
      v_store.kind,
      round(v_open, 2),
      round(v_purch, 2),
      round(v_trans_in, 2),
      round(v_trans_out, 2),
      round(v_prod_net, 2),
      round(v_dep, 2),
      round(v_waste, 2),
      round(v_close, 2),
      round(v_net_cons, 2),
      v_turnover;
  end loop;
end;
$$ language plpgsql stable;

-- 3. Stored Procedure: Article Transaction History Ledger (Artikelkarte / Forward-Only Stock Card)
-- Reconstructs the exact chronological audit trail of all transactions for any article and store
create or replace function get_article_history_ledger(
  p_tenant     uuid,
  p_store      uuid,
  p_item       uuid,
  p_start_date date,
  p_end_date   date
) returns table (
  movement_id       uuid,
  occurred_on       date,
  occurred_at       timestamptz,
  movement_type     text,
  source_doc_type   text,
  source_doc_id     uuid,
  note              text,
  qty_delta         numeric,
  unit_cost         numeric,
  value_delta       numeric,
  running_qty       numeric,
  running_avg_cost  numeric,
  running_value     numeric
) as $$
declare
  v_mov record;
  v_cur_qty numeric := 0.0;
  v_cur_val numeric := 0.0;
  v_cur_avg numeric := 0.0;
begin
  -- First calculate starting position before p_start_date
  select coalesce(sum(m.qty_delta), 0), coalesce(sum(m.value_delta), 0)
    into v_cur_qty, v_cur_val
    from stock_movements m
   where m.tenant_id = p_tenant
     and m.store_id = p_store
     and m.item_id = p_item
     and m.occurred_on < p_start_date;

  v_cur_avg := case when v_cur_qty > 0 then round(v_cur_val / v_cur_qty, 2) else 0.0 end;

  for v_mov in
    select m.id, m.occurred_on, m.occurred_at, m.movement_type,
           m.source_doc_type, m.source_doc_id, m.note,
           m.qty_delta, m.unit_cost, m.value_delta
      from stock_movements m
     where m.tenant_id = p_tenant
       and m.store_id = p_store
       and m.item_id = p_item
       and m.occurred_on between p_start_date and p_end_date
     order by m.occurred_on, m.seq, m.occurred_at
  loop
    v_cur_qty := v_cur_qty + v_mov.qty_delta;
    v_cur_val := v_cur_val + v_mov.value_delta;
    v_cur_avg := case when v_cur_qty > 0 then round(v_cur_val / v_cur_qty, 2) else v_mov.unit_cost end;

    return query
    select
      v_mov.id,
      v_mov.occurred_on,
      v_mov.occurred_at,
      v_mov.movement_type,
      v_mov.source_doc_type,
      v_mov.source_doc_id,
      v_mov.note,
      v_mov.qty_delta,
      v_mov.unit_cost,
      v_mov.value_delta,
      round(v_cur_qty, 6),
      round(v_cur_avg, 2),
      round(v_cur_val, 2);
  end loop;
end;
$$ language plpgsql stable;
