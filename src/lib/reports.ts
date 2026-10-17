import 'server-only';

import { db } from './server-db';
import { requireTenant } from './queries';
import { dec } from './money';

/* ------------------------------------------------------------------ counts */

export async function listCounts() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    count_date: string;
    status: string;
    counted_by: string | null;
    store_id: string;
    store_name: string;
    line_count: string;
    counted_lines: string;
    investigate: string;
    review: string;
    net_value: string | null;
  }>(
    `select sc.id,
            sc.count_date::text as count_date,
            sc.status,
            sc.counted_by,
            sc.store_id,
            s.name as store_name,
            (select count(*)::text from stock_count_lines l where l.stock_count_id = sc.id)
              as line_count,
            (select count(*)::text from stock_count_lines l
              where l.stock_count_id = sc.id and l.counted_qty is not null) as counted_lines,
            (select count(*)::text from v_stock_count_variance v
              where v.stock_count_id = sc.id and v.variance_status = 'INVESTIGATE') as investigate,
            (select count(*)::text from v_stock_count_variance v
              where v.stock_count_id = sc.id and v.variance_status = 'REVIEW') as review,
            (select coalesce(sum(v.variance_value), 0)::text from v_stock_count_variance v
              where v.stock_count_id = sc.id and v.counted_qty is not null) as net_value
       from stock_counts sc join stores s on s.id = sc.store_id
      where sc.tenant_id = $1
      order by sc.count_date desc, s.name`,
    [t.id],
  );
  return rows;
}

export async function getCount(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    count_date: string;
    status: string;
    counted_by: string | null;
    store_id: string;
    store_name: string;
    posted_at: string | null;
  }>(
    `select sc.id, sc.count_date::text as count_date, sc.status, sc.counted_by,
            sc.store_id, s.name as store_name, sc.posted_at::text as posted_at
       from stock_counts sc join stores s on s.id = sc.store_id
      where sc.tenant_id = $1 and sc.id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function getCountLines(id: string) {
  const d = await db();
  const { rows } = await d.query<{
    stock_count_line_id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    theoretical_qty: string;
    counted_qty: string | null;
    unit_cost: string;
    variance_qty: string;
    variance_value: string;
    variance_ratio: string | null;
    variance_status: string;
    note: string | null;
    discrepancy_reason: string | null;
    recount_status: string | null;
  }>(
    `select v.stock_count_line_id, v.item_id, v.item_code, v.item_name, v.uom,
            v.theoretical_qty, v.counted_qty, v.unit_cost,
            v.variance_qty, v.variance_value, v.variance_ratio, v.variance_status,
            l.note, l.discrepancy_reason, l.recount_status
       from v_stock_count_variance v
       join stock_count_lines l on l.id = v.stock_count_line_id
      where v.stock_count_id = $1
      order by v.item_name`,
    [id],
  );
  return rows;
}

/* ---------------------------------------------------------------- variance */

/** Worst money difference first - what a controller actually opens the page for. */
export async function varianceRows(countId?: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    stock_count_id: string;
    count_date: string;
    store_name: string;
    item_code: string;
    item_name: string;
    uom: string;
    theoretical_qty: string;
    counted_qty: string | null;
    variance_qty: string;
    variance_value: string;
    variance_ratio: string | null;
    variance_status: string;
    unit_cost: string;
    note: string | null;
  }>(
    `select v.stock_count_id, v.count_date::text as count_date, s.name as store_name,
            v.item_code, v.item_name, v.uom, v.theoretical_qty, v.counted_qty,
            v.variance_qty, v.variance_value, v.variance_ratio, v.variance_status,
            v.unit_cost, l.note
       from v_stock_count_variance v
       join stores s on s.id = v.store_id
       join stock_count_lines l on l.id = v.stock_count_line_id
      where v.tenant_id = $1
        and v.counted_qty is not null
        and ($2::uuid is null or v.stock_count_id = $2::uuid)
      order by abs(v.variance_value) desc, v.item_name`,
    [t.id, countId ?? null],
  );
  return rows;
}

export async function postedCounts() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; label: string; count_date: string }>(
    `select sc.id,
            s.name || ' · ' || sc.count_date::text as label,
            sc.count_date::text as count_date
       from stock_counts sc join stores s on s.id = sc.store_id
      where sc.tenant_id = $1 and sc.status = 'posted'
      order by sc.count_date desc, s.name`,
    [t.id],
  );
  return rows;
}

/* --------------------------------------------------------------- dashboard */

export async function latestPostedImport() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    period_start: string;
    period_end: string;
    computed_sub_total: string;
  }>(
    `select id, period_start::text as period_start, period_end::text as period_end,
            computed_sub_total
       from sales_imports
      where tenant_id = $1 and status = 'posted'
      order by period_end desc, posted_at desc
      limit 1`,
    [t.id],
  );
  return rows[0] ?? null;
}

export async function fbCostSummary(importId: string) {
  const d = await db();
  const { rows } = await d.query<{
    kind: string;
    revenue_all: string;
    revenue_costed: string;
    cost_of_sales: string;
    cost_pct_of_costed: string | null;
    coverage_pct: string | null;
    gross_profit: string;
  }>(
    `select kind, revenue_all, revenue_costed, cost_of_sales,
            cost_pct_of_costed, coverage_pct, gross_profit
       from v_fb_cost_summary
      where sales_import_id = $1
      order by case kind when 'food' then 0 when 'beverage' then 1 else 2 end`,
    [importId],
  );
  return rows;
}

export async function topSellers(importId: string, by: 'qty' | 'revenue', limit = 10) {
  const d = await db();
  // `by` is not interpolated from user input - it is one of two literals.
  const orderBy = by === 'qty' ? 'sl.qty' : 'sl.total_amount';
  const { rows } = await d.query<{
    article_code: string;
    article_name: string;
    pos_category: string;
    qty: string;
    total_amount: string;
    depleted: boolean;
  }>(
    `select sl.article_code, sl.article_name, sl.pos_category, sl.qty, sl.total_amount,
            sl.depleted
       from sales_lines sl
       left join pos_item_map p on p.id = sl.pos_item_map_id
      where sl.sales_import_id = $1 and coalesce(p.counts_as_sale, true)
      order by ${orderBy} desc
      limit $2`,
    [importId, limit],
  );
  return rows;
}

/**
 * How many recipes it takes to cost a given share of revenue.
 *
 * Articles that can never carry a recipe are excluded from the ranking and
 * reported separately: they set a ceiling that no amount of recipe writing
 * will lift, and only splitting them in the POS would.
 */
export async function coverageCurve(importId: string) {
  const d = await db();
  const { rows } = await d.query<{
    total_amount: string;
    depleted: boolean;
    article_flag: string;
  }>(
    `select sl.total_amount, sl.depleted, coalesce(p.article_flag, 'normal') as article_flag
       from sales_lines sl
       left join pos_item_map p on p.id = sl.pos_item_map_id
      where sl.sales_import_id = $1 and coalesce(p.counts_as_sale, true)
      order by sl.total_amount desc`,
    [importId],
  );

  const isUncostable = (f: string) => f === 'generic' || f === 'test';
  const uncostable = rows.filter((r) => isUncostable(r.article_flag));
  const costable = rows.filter((r) => !isUncostable(r.article_flag));
  const sum = (xs: typeof rows) => xs.reduce((s, r) => s.plus(dec(r.total_amount)), dec(0));

  const ceiling = sum(costable);
  const milestones = [25, 50, 80, 90];
  const out: { target: number; recipes: number; revenue: string }[] = [];

  let running = dec(0);
  costable.forEach((r, i) => {
    running = running.plus(dec(r.total_amount));
    for (const m of milestones) {
      if (
        !out.some((o) => o.target === m) &&
        !ceiling.isZero() &&
        running.dividedBy(ceiling).times(100).greaterThanOrEqualTo(m)
      ) {
        out.push({ target: m, recipes: i + 1, revenue: running.toFixed(2) });
      }
    }
  });

  return {
    milestones: out.sort((a, b) => a.target - b.target),
    ceiling: ceiling.toFixed(2),
    uncostableRevenue: sum(uncostable).toFixed(2),
    uncostableCount: uncostable.length,
    costableCount: costable.length,
    recipesWritten: costable.filter((r) => r.depleted).length,
  };
}

/* ----------------------------------------------------------- mc analytics */

export interface FBCostCategoryReport {
  kind: 'food' | 'beverage';
  revenue: string;
  openingStock: string;
  purchases: string;
  transfersIn: string;
  transfersOut: string;
  closingStock: string;
  grossConsumption: string;
  staffMeals: string;
  comps: string;
  waste: string;
  netCostOfSales: string;
  actualCostPct: string | null;
  theoreticalCost: string;
  theoreticalCostPct: string | null;
  varianceValue: string;
}

export async function fbCostReconciliation(periodStart?: string, periodEnd?: string) {
  const d = await db();
  const t = await requireTenant();

  // 1. Sales revenue by food vs beverage
  const { rows: salesRows } = await d.query<{ kind: 'food' | 'beverage'; revenue: string }>(
    `select coalesce(mi.kind, 'food')::text as kind,
            coalesce(sum(sl.total_amount), 0)::text as revenue
       from sales_lines sl
       join sales_imports si on si.id = sl.sales_import_id
       left join menu_items mi on mi.id = sl.menu_item_id
      where si.tenant_id = $1 and si.status = 'posted'
        and ($2::date is null or si.period_start >= $2::date)
        and ($3::date is null or si.period_end <= $3::date)
      group by coalesce(mi.kind, 'food')`,
    [t.id, periodStart ?? null, periodEnd ?? null],
  );

  const getRev = (k: 'food' | 'beverage') => dec(salesRows.find((r) => r.kind === k)?.revenue ?? '0');

  // 2. Inventory movements grouped by store kind (kitchen = food, bar = beverage)
  const { rows: movRows } = await d.query<{
    store_kind: 'kitchen' | 'bar';
    movement_type: string;
    total_value: string;
  }>(
    `select case s.kind when 'bar' then 'bar' else 'kitchen' end as store_kind,
            m.movement_type,
            coalesce(sum(abs(m.value_delta)), 0)::text as total_value
       from stock_movements m
       join stores s on s.id = m.store_id
      where m.tenant_id = $1
        and ($2::date is null or m.occurred_on >= $2::date)
        and ($3::date is null or m.occurred_on <= $3::date)
      group by case s.kind when 'bar' then 'bar' else 'kitchen' end, m.movement_type`,
    [t.id, periodStart ?? null, periodEnd ?? null],
  );

  // 3. Current stock on hand by store kind
  const { rows: closingRows } = await d.query<{
    store_kind: 'kitchen' | 'bar';
    closing_value: string;
  }>(
    `select case s.kind when 'bar' then 'bar' else 'kitchen' end as store_kind,
            coalesce(sum(soh.value_on_hand), 0)::text as closing_value
       from v_stock_on_hand soh
       join stores s on s.id = soh.store_id
      where soh.tenant_id = $1
      group by case s.kind when 'bar' then 'bar' else 'kitchen' end`,
    [t.id],
  );

  const categories: ('food' | 'beverage')[] = ['food', 'beverage'];
  const reports: FBCostCategoryReport[] = categories.map((k) => {
    const storeKind = k === 'beverage' ? 'bar' : 'kitchen';
    const rev = getRev(k);

    const getMov = (type: string) =>
      dec(movRows.find((r) => r.store_kind === storeKind && r.movement_type === type)?.total_value ?? '0');

    const purchases = getMov('receipt');
    const transfersIn = getMov('transfer_in').plus(getMov('issue_in'));
    const transfersOut = getMov('transfer_out').plus(getMov('issue_out'));
    const staffMeals = getMov('staff_meal');
    const comps = getMov('comp');
    const waste = getMov('wastage');
    const theoreticalCost = getMov('sale_depletion');

    const closing = dec(closingRows.find((r) => r.store_kind === storeKind)?.closing_value ?? '0');
    // Opening balance derived or from opening movements
    const opening = getMov('opening');

    // Classical MC equation: Opening + Purchases + TransfersIn - TransfersOut - Closing
    let grossConsumption = opening.plus(purchases).plus(transfersIn).minus(transfersOut).minus(closing);
    if (grossConsumption.isNegative()) grossConsumption = theoreticalCost.plus(waste);

    // Net Cost of Sales = Gross - (Staff Meals + Comps) + Waste
    const netCostOfSales = grossConsumption.minus(staffMeals).minus(comps);

    const actualCostPct = rev.greaterThan(0) ? netCostOfSales.dividedBy(rev).times(100).toFixed(2) : null;
    const theoreticalCostPct = rev.greaterThan(0) ? theoreticalCost.dividedBy(rev).times(100).toFixed(2) : null;
    const varianceValue = netCostOfSales.minus(theoreticalCost).toFixed(2);

    return {
      kind: k,
      revenue: rev.toFixed(2),
      openingStock: opening.toFixed(2),
      purchases: purchases.toFixed(2),
      transfersIn: transfersIn.toFixed(2),
      transfersOut: transfersOut.toFixed(2),
      closingStock: closing.toFixed(2),
      grossConsumption: grossConsumption.toFixed(2),
      staffMeals: staffMeals.toFixed(2),
      comps: comps.toFixed(2),
      waste: waste.toFixed(2),
      netCostOfSales: netCostOfSales.toFixed(2),
      actualCostPct,
      theoreticalCost: theoreticalCost.toFixed(2),
      theoreticalCostPct,
      varianceValue,
    };
  });

  return reports;
}

export interface MenuEngineeringItem {
  menuItemId: string;
  itemName: string;
  kind: string;
  recipeCode: string;
  qtySold: number;
  revenue: string;
  avgSellingPrice: string;
  unitCost: string;
  unitMargin: string;
  totalProfit: string;
  foodCostPct: string | null;
  classification: 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';
  recommendation: string;
}

export async function menuEngineeringMatrix() {
  const d = await db();
  const t = await requireTenant();

  const { rows } = await d.query<{
    menu_item_id: string;
    item_name: string;
    kind: string;
    recipe_code: string | null;
    total_qty_sold: string;
    total_revenue: string;
    avg_selling_price: string;
    unit_recipe_cost: string;
  }>(
    `select mi.id as menu_item_id,
            mi.name as item_name,
            coalesce(mi.kind, 'food')::text as kind,
            r.code as recipe_code,
            coalesce(sum(sl.qty), 0)::text as total_qty_sold,
            coalesce(sum(sl.total_amount), 0)::text as total_revenue,
            case when coalesce(sum(sl.qty), 0) > 0
                 then round(sum(sl.total_amount) / sum(sl.qty), 2)::text
                 else '0'
            end as avg_selling_price,
            coalesce(rc.cost_per_portion, 0)::text as unit_recipe_cost
       from sales_lines sl
       join sales_imports si on si.id = sl.sales_import_id
       join menu_items mi on mi.id = sl.menu_item_id
       left join recipes r on r.menu_item_id = mi.id and r.kind = 'menu'
       left join v_recipe_cost_today rc on rc.recipe_id = r.id and rc.tenant_id = si.tenant_id
      where si.tenant_id = $1 and si.status = 'posted'
      group by mi.id, mi.name, mi.kind, r.code, rc.cost_per_portion
      order by sum(sl.total_amount) desc`,
    [t.id],
  );

  if (rows.length === 0) {
    return { items: [], avgPopularity: 0, avgMargin: 0, counts: { star: 0, plowhorse: 0, puzzle: 0, dog: 0 } };
  }

  const parsed = rows.map((r) => {
    const qty = Number(r.total_qty_sold);
    const sp = dec(r.avg_selling_price);
    const cost = dec(r.unit_recipe_cost);
    const margin = sp.minus(cost);
    const profit = margin.times(qty);
    const costPct = sp.greaterThan(0) ? cost.dividedBy(sp).times(100).toFixed(1) : null;
    return {
      menuItemId: r.menu_item_id,
      itemName: r.item_name,
      kind: r.kind,
      recipeCode: r.recipe_code ?? '-',
      qtySold: qty,
      revenue: dec(r.total_revenue).toFixed(2),
      avgSellingPrice: sp.toFixed(2),
      unitCost: cost.toFixed(2),
      unitMargin: margin.toFixed(2),
      totalProfit: profit.toFixed(2),
      foodCostPct: costPct,
      marginDec: margin,
    };
  });

  const totalQty = parsed.reduce((sum, i) => sum + i.qtySold, 0);
  const avgPopularity = totalQty / (parsed.length || 1);

  const totalMargin = parsed.reduce((sum, i) => sum.plus(i.marginDec), dec(0));
  const avgMargin = Number(totalMargin.dividedBy(parsed.length || 1).toFixed(2));

  let stars = 0;
  let plowhorses = 0;
  let puzzles = 0;
  let dogs = 0;

  const items: MenuEngineeringItem[] = parsed.map((item) => {
    const isPopular = item.qtySold >= avgPopularity;
    const isProfitable = Number(item.unitMargin) >= avgMargin;

    let classification: 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';
    let recommendation: string;

    if (isPopular && isProfitable) {
      classification = 'STAR';
      recommendation = 'Maintain high quality, feature prominently on menu.';
      stars += 1;
    } else if (isPopular && !isProfitable) {
      classification = 'PLOWHORSE';
      recommendation = 'High volume seller! Increase price slightly or adjust portion/prep costs.';
      plowhorses += 1;
    } else if (!isPopular && isProfitable) {
      classification = 'PUZZLE';
      recommendation = 'High profit margin! Improve server recommendations and menu visibility.';
      puzzles += 1;
    } else {
      classification = 'DOG';
      recommendation = 'Low demand and low profit. Consider reformulating or removing from menu.';
      dogs += 1;
    }

    const { marginDec: _, ...clean } = item;
    return { ...clean, classification, recommendation };
  });

  return {
    items,
    avgPopularity: Math.round(avgPopularity * 10) / 10,
    avgMargin,
    counts: { star: stars, plowhorse: plowhorses, puzzle: puzzles, dog: dogs },
  };
}

