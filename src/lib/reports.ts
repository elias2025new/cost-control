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
  }>(
    `select v.stock_count_line_id, v.item_id, v.item_code, v.item_name, v.uom,
            v.theoretical_qty, v.counted_qty, v.unit_cost,
            v.variance_qty, v.variance_value, v.variance_ratio, v.variance_status,
            l.note
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
