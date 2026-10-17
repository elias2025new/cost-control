-- 021_purchasing_and_3way_matching.sql
-- Phase 2: Purchasing & Receiving Engine (Auto-PO from Par, 3-Way Match)
--
-- Re-engineers Oracle Hospitality Materials Control:
-- - Supplier Price Books (LIEFERART) with pack sizes, contract prices, and lead times
-- - Purchase Orders (BESTELLUNG / BESTPOS) with approval workflows and statuses
-- - Automated Par Ordering from min/max levels and pending orders (OrderCalculation.cs)
-- - 3-Way Matching: Purchase Order vs. Goods Receiving Note (GRN) vs. Supplier Invoice (LIEFSCH)

-- 1. Supplier Article Catalog & Price Book (HMC LIEFERART)
create table if not exists supplier_item_prices (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  supplier_id         uuid not null references suppliers(id),
  item_id             uuid not null references items(id),
  supplier_item_code  text,
  purchase_uom        text not null,
  pack_factor         numeric(18,6) not null default 1.0 check (pack_factor > 0),
  contract_price      numeric(18,2) not null check (contract_price >= 0),
  tax_rate            numeric(5,2) not null default 15.0 check (tax_rate >= 0),
  min_order_qty       numeric(18,6) not null default 1.0 check (min_order_qty > 0),
  lead_time_days      integer not null default 1 check (lead_time_days >= 0),
  is_preferred        boolean not null default false,
  effective_from      date not null default current_date,
  effective_to        date,
  created_at          timestamptz not null default now(),
  unique (tenant_id, supplier_id, item_id, purchase_uom),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_supplier_item_prices_lookup
  on supplier_item_prices (tenant_id, item_id, is_preferred);

-- 2. Purchase Orders (HMC BESTELLUNG)
create table if not exists purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  po_number              text not null,
  supplier_id            uuid not null references suppliers(id),
  destination_store_id   uuid not null references stores(id),
  order_date             date not null default current_date,
  expected_delivery_date date,
  status                 text not null default 'draft'
                         check (status in ('draft', 'approved', 'sent', 'partially_received', 'completed', 'cancelled')),
  notes                  text,
  approved_by            uuid references users(id),
  approved_at            timestamptz,
  created_by             text not null default 'system',
  created_at             timestamptz not null default now(),
  unique (tenant_id, po_number)
);

create index if not exists idx_purchase_orders_tenant_status
  on purchase_orders (tenant_id, status, supplier_id);

-- 3. Purchase Order Lines (HMC BESTPOS)
create table if not exists purchase_order_lines (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  purchase_order_id      uuid not null references purchase_orders(id) on delete cascade,
  line_no                integer not null,
  item_id                uuid not null references items(id),
  order_uom              text not null,
  ordered_pack_qty       numeric(18,6) not null check (ordered_pack_qty > 0),
  pack_factor            numeric(18,6) not null default 1.0 check (pack_factor > 0),
  ordered_inventory_qty  numeric(18,6) not null check (ordered_inventory_qty > 0),
  unit_price             numeric(18,2) not null check (unit_price >= 0),
  line_total             numeric(18,2) not null check (line_total >= 0),
  received_inventory_qty numeric(18,6) not null default 0 check (received_inventory_qty >= 0),
  status                 text not null default 'open'
                         check (status in ('open', 'partial', 'received', 'cancelled')),
  unique (purchase_order_id, line_no)
);

create index if not exists idx_purchase_order_lines_po
  on purchase_order_lines (purchase_order_id, item_id);

-- 4. Extend Purchases (GRN / Delivery Note) for 3-Way Matching (HMC LIEFSCH)
alter table purchases
  add column if not exists purchase_order_id uuid references purchase_orders(id),
  add column if not exists invoice_number text,
  add column if not exists invoice_amount numeric(18,2),
  add column if not exists match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'variance_flagged', 'variance_approved')),
  add column if not exists variance_reason text,
  add column if not exists variance_approved_by uuid references users(id),
  add column if not exists variance_approved_at timestamptz;

alter table purchase_lines
  add column if not exists po_line_id uuid references purchase_order_lines(id),
  add column if not exists ordered_qty numeric(18,6),
  add column if not exists ordered_unit_cost numeric(18,2),
  add column if not exists invoiced_qty numeric(18,6),
  add column if not exists invoiced_unit_cost numeric(18,2),
  add column if not exists price_variance numeric(18,2) default 0.0,
  add column if not exists qty_variance numeric(18,6) default 0.0,
  add column if not exists variance_status text not null default 'ok'
    check (variance_status in ('ok', 'price_mismatch', 'over_delivery', 'under_delivery', 'approved'));

-- 5. Stored Procedure: Auto-Ordering Calculation from Par Levels (OrderCalculation.cs)
-- Suggests order quantities where Current On-Hand + Pending On-Order <= Min Qty
-- Order Qty = RoundUp((Max Qty - On-Hand - Pending) / Pack Factor) * Pack Factor
create or replace function calculate_par_order_suggestions(
  p_tenant uuid,
  p_store  uuid
) returns table (
  item_id               uuid,
  item_code             text,
  item_name             text,
  inventory_uom         text,
  purchase_uom          text,
  pack_factor           numeric,
  supplier_id           uuid,
  supplier_name         text,
  contract_price        numeric,
  min_qty               numeric,
  max_qty               numeric,
  qty_on_hand           numeric,
  pending_ordered_qty   numeric,
  suggested_pack_qty    numeric,
  suggested_inv_qty     numeric,
  estimated_cost        numeric
) as $$
begin
  return query
  with pending_po as (
    -- Unfulfilled quantities currently on approved/sent purchase orders
    select pol.item_id,
           sum(pol.ordered_inventory_qty - pol.received_inventory_qty) as pending_qty
      from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
     where po.tenant_id = p_tenant
       and po.destination_store_id = p_store
       and po.status in ('approved', 'sent', 'partially_received')
       and pol.status in ('open', 'partial')
     group by pol.item_id
  ),
  stock_current as (
    select s.item_id, coalesce(s.qty_on_hand, 0) as on_hand
      from v_stock_on_hand s
     where s.tenant_id = p_tenant and s.store_id = p_store
  ),
  preferred_vendor as (
    -- Pick preferred supplier price record, or fallback to first valid price record
    select distinct on (sip.item_id)
           sip.item_id,
           sip.supplier_id,
           sup.name as supplier_name,
           sip.purchase_uom,
           sip.pack_factor,
           sip.contract_price,
           sip.min_order_qty
      from supplier_item_prices sip
      join suppliers sup on sup.id = sip.supplier_id
     where sip.tenant_id = p_tenant
       and (sip.effective_to is null or sip.effective_to >= current_date)
     order by sip.item_id, sip.is_preferred desc, sip.contract_price asc
  )
  select
    i.id as item_id,
    i.code as item_code,
    i.name as item_name,
    i.uom as inventory_uom,
    coalesce(pv.purchase_uom, i.purchase_uom, i.uom) as purchase_uom,
    coalesce(pv.pack_factor, i.pack_factor, 1.0)::numeric as pack_factor,
    pv.supplier_id,
    pv.supplier_name,
    coalesce(pv.contract_price, 0.0)::numeric as contract_price,
    lvl.min_qty::numeric,
    lvl.max_qty::numeric,
    coalesce(sc.on_hand, 0.0)::numeric as qty_on_hand,
    coalesce(ppo.pending_qty, 0.0)::numeric as pending_ordered_qty,
    -- Round up to full packs (ceil((Max - OnHand - Pending) / PackFactor))
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        greatest(
          ceil(
            (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
            / coalesce(pv.pack_factor, i.pack_factor, 1.0)
          ),
          coalesce(pv.min_order_qty, 1.0)
        )
      else 0.0
    end::numeric as suggested_pack_qty,
    -- Suggested inventory units
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        greatest(
          ceil(
            (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
            / coalesce(pv.pack_factor, i.pack_factor, 1.0)
          ),
          coalesce(pv.min_order_qty, 1.0)
        ) * coalesce(pv.pack_factor, i.pack_factor, 1.0)
      else 0.0
    end::numeric as suggested_inv_qty,
    -- Estimated total cost
    case
      when (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty then
        round(
          greatest(
            ceil(
              (lvl.max_qty - (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)))
              / coalesce(pv.pack_factor, i.pack_factor, 1.0)
            ),
            coalesce(pv.min_order_qty, 1.0)
          ) * coalesce(pv.contract_price, 0.0),
          2
        )
      else 0.0
    end::numeric as estimated_cost
  from store_item_levels lvl
  join items i on i.id = lvl.item_id
  left join stock_current sc on sc.item_id = lvl.item_id
  left join pending_po ppo on ppo.item_id = lvl.item_id
  left join preferred_vendor pv on pv.item_id = lvl.item_id
  where lvl.tenant_id = p_tenant
    and lvl.store_id  = p_store
    and (coalesce(sc.on_hand, 0) + coalesce(ppo.pending_qty, 0)) <= lvl.min_qty
    and lvl.max_qty > lvl.min_qty
  order by i.code;
end;
$$ language plpgsql stable;

-- 6. Stored Function: 3-Way Matching Verification (HMC LIEFSCH Matching)
-- Evaluates Price Variance: (Actual Unit Cost - PO Unit Cost) * Qty
-- Evaluates Qty Variance: Received Qty - PO Ordered Qty
-- Flags receipts where price variance % exceeds tolerance
create or replace function match_3way_receipt(
  p_purchase_id          uuid,
  p_price_tolerance_pct  numeric default 2.0
) returns table (
  purchase_id        uuid,
  match_status       text,
  total_ordered_cost numeric,
  total_actual_cost  numeric,
  total_variance     numeric,
  flagged_lines      integer
) as $$
declare
  v_tenant   uuid;
  v_po_id    uuid;
  v_flagged  integer := 0;
  v_ord_sum  numeric := 0;
  v_act_sum  numeric := 0;
  v_var_sum  numeric := 0;
  v_status   text := 'matched';
  v_line     record;
  v_pct_diff numeric;
begin
  select tenant_id, purchase_order_id into v_tenant, v_po_id
    from purchases where id = p_purchase_id;

  if v_po_id is null then
    -- Non-PO direct receipt: matched automatically without PO lines
    update purchases set match_status = 'matched' where id = p_purchase_id;
    return query select p_purchase_id, 'matched'::text, 0.0::numeric, 0.0::numeric, 0.0::numeric, 0;
    return;
  end if;

  -- Walk through each purchase line and compare against PO line
  for v_line in
    select pl.id as line_id,
           pl.item_id,
           pl.qty,
           pl.unit_cost,
           pol.id as po_line_id,
           pol.ordered_inventory_qty as po_qty,
           pol.unit_price as po_unit_cost
      from purchase_lines pl
      left join purchase_order_lines pol
        on pol.purchase_order_id = v_po_id and pol.item_id = pl.item_id
     where pl.purchase_id = p_purchase_id
  loop
    if v_line.po_line_id is not null then
      -- Calculate variances
      v_pct_diff := case
        when v_line.po_unit_cost > 0 then
          abs((v_line.unit_cost - v_line.po_unit_cost) / v_line.po_unit_cost) * 100.0
        else 0.0
      end;

      v_ord_sum := v_ord_sum + (v_line.qty * v_line.po_unit_cost);
      v_act_sum := v_act_sum + (v_line.qty * v_line.unit_cost);
      v_var_sum := v_var_sum + (v_line.qty * (v_line.unit_cost - v_line.po_unit_cost));

      if v_pct_diff > p_price_tolerance_pct then
        v_flagged := v_flagged + 1;
        update purchase_lines
           set po_line_id = v_line.po_line_id,
               ordered_qty = v_line.po_qty,
               ordered_unit_cost = v_line.po_unit_cost,
               price_variance = round(v_line.qty * (v_line.unit_cost - v_line.po_unit_cost), 2),
               qty_variance = round(v_line.qty - v_line.po_qty, 6),
               variance_status = 'price_mismatch'
         where id = v_line.line_id;
      else
        update purchase_lines
           set po_line_id = v_line.po_line_id,
               ordered_qty = v_line.po_qty,
               ordered_unit_cost = v_line.po_unit_cost,
               price_variance = round(v_line.qty * (v_line.unit_cost - v_line.po_unit_cost), 2),
               qty_variance = round(v_line.qty - v_line.po_qty, 6),
               variance_status = 'ok'
         where id = v_line.line_id;
      end if;
    end if;
  end loop;

  if v_flagged > 0 then
    v_status := 'variance_flagged';
  else
    v_status := 'matched';
  end if;

  update purchases
     set match_status = v_status
   where id = p_purchase_id;

  return query select
    p_purchase_id,
    v_status,
    round(v_ord_sum, 2)::numeric,
    round(v_act_sum, 2)::numeric,
    round(v_var_sum, 2)::numeric,
    v_flagged;
end;
$$ language plpgsql;
