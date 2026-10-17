import 'server-only';

import { cookies } from 'next/headers';
import { db } from './server-db';
import { SESSION_COOKIE, verifySessionCookie, type SessionPayload } from './session';

/**
 * Read models for the screens.
 *
 * One tenant at a time, per the brief: no authentication in this demo. The
 * tenant is still resolved and passed through every query, because the
 * discipline is what keeps multi-tenancy possible later.
 */
export type Tenant = { id: string; name: string; code: string };

/** Never throws. Pages use this to decide whether to show onboarding. */
export async function currentTenant(): Promise<Tenant | null> {
  const d = await db();
  const { rows } = await d.query<Tenant>(
    `select id, name, code from tenants order by created_at limit 1`,
  );
  return rows[0] ?? null;
}

/**
 * For library-internal use once a page has already confirmed a tenant
 * exists. Throwing here means a page's own guard was skipped, not that an
 * empty database is a normal state to reach this deep.
 */
export async function requireTenant(): Promise<Tenant> {
  const t = await currentTenant();
  if (!t) {
    throw new Error('No tenant found. Set one up at /setup/tenant.');
  }
  return t;
}

export type CurrentUser = SessionPayload;

/**
 * Never throws, never touches the database - reads and verifies the
 * session cookie only. See session.ts for why: proxy.ts must not open a
 * second connection to the same PGlite data directory, and this is the
 * same verification logic proxy.ts itself runs.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return verifySessionCookie(store.get(SESSION_COOKIE)?.value);
}

/**
 * For library-internal use once a page has already confirmed a session
 * exists. Throwing here means a page's own guard (or proxy.ts) was
 * skipped - this is the actual enforcement point, not just a UX nicety,
 * per Next's own guidance that Server Functions must verify auth
 * themselves rather than relying on Proxy alone.
 */
export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) {
    throw new Error('Not signed in.');
  }
  return u;
}

/**
 * Master data, imports and costing are the controller's job, not an
 * outlet's. Called at the top of those Server Actions rather than left to
 * proxy.ts's path matcher - Next's docs are explicit that a Server
 * Function stays reachable independently of the route protection in front
 * of the page that renders its form.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== 'admin') {
    throw new Error('Only an administrator can do that.');
  }
  return u;
}

export async function requirePermission(permission: string): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role === 'admin' || u.permissions?.includes('all') || u.permissions?.includes(permission)) {
    return u;
  }
  throw new Error(`You do not have the required permission: ${permission}.`);
}

export async function requireStoreAccess(storeId: string): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role === 'admin' || u.allStoresAccess) {
    return u;
  }
  if (u.storeId === storeId || u.assignedStoreIds?.includes(storeId)) {
    return u;
  }
  throw new Error('You do not have access to this store.');
}

export async function listImports() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    filename: string | null;
    period_start: string;
    period_end: string;
    business_date: string;
    status: string;
    reconciled: boolean;
    computed_sub_total: string;
    declared_sub_total: string | null;
    line_count: string;
    blocking: string;
    warnings: string;
    revenue_costed_pct: string | null;
    uploaded_at: string;
  }>(
    `select si.id,
            si.filename,
            si.period_start::text,
            si.period_end::text,
            si.business_date::text,
            si.status,
            si.reconciled,
            si.computed_sub_total,
            si.declared_sub_total,
            (select count(*)::text from sales_lines l where l.sales_import_id = si.id) as line_count,
            (select count(*)::text from sales_import_issues i
              where i.sales_import_id = si.id and i.severity = 'block') as blocking,
            (select count(*)::text from sales_import_issues i
              where i.sales_import_id = si.id and i.severity = 'warn') as warnings,
            cov.revenue_costed_pct,
            si.uploaded_at::text
       from sales_imports si
       left join v_import_cost_coverage cov on cov.sales_import_id = si.id
      where si.tenant_id = $1
      order by si.uploaded_at desc`,
    [t.id],
  );
  return rows;
}

export async function getImport(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    filename: string | null;
    file_sha256: string | null;
    period_start: string;
    period_end: string;
    business_date: string;
    status: string;
    reconciled: boolean;
    declared_sub_total: string | null;
    declared_add_charge: string | null;
    declared_discount: string | null;
    declared_tax: string | null;
    declared_grand_total: string | null;
    computed_sub_total: string;
    computed_qty: string;
    note: string | null;
    uploaded_at: string;
    posted_at: string | null;
    branch_name: string;
  }>(
    // Every date and timestamp is cast to text here on purpose. The drivers
    // disagree about what a `date` column deserialises to - one hands back a
    // JS Date, the other a string - and the formatting helpers take strings.
    // Casting in SQL removes the difference at the source.
    `select si.id,
            si.filename,
            si.file_sha256,
            si.period_start::text   as period_start,
            si.period_end::text     as period_end,
            si.business_date::text  as business_date,
            si.status,
            si.reconciled,
            si.declared_sub_total,
            si.declared_add_charge,
            si.declared_discount,
            si.declared_tax,
            si.declared_grand_total,
            si.computed_sub_total,
            si.computed_qty,
            si.note,
            si.uploaded_at::text    as uploaded_at,
            si.posted_at::text      as posted_at,
            b.name                  as branch_name
       from sales_imports si join branches b on b.id = si.branch_id
      where si.tenant_id = $1 and si.id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function getImportIssues(id: string) {
  const d = await db();
  const { rows } = await d.query<{
    severity: 'block' | 'warn' | 'info';
    kind: string;
    article_code: string | null;
    message: string;
    qty: string | null;
    amount: string | null;
  }>(
    `select severity, kind, article_code, message, qty, amount
       from sales_import_issues
      where sales_import_id = $1
      order by case severity when 'block' then 0 when 'warn' then 1 else 2 end,
               kind, amount desc nulls last`,
    [id],
  );
  return rows;
}

export async function getImportCoverage(id: string) {
  const d = await db();
  const { rows } = await d.query<{
    line_count: string;
    costed_line_count: string;
    revenue_total: string | null;
    revenue_costed: string | null;
    revenue_uncosted: string | null;
    revenue_costed_pct: string | null;
  }>(`select * from v_import_cost_coverage where sales_import_id = $1`, [id]);
  return rows[0] ?? null;
}

/** The biggest uncosted articles - what writing the next recipe would buy. */
export async function getTopUncosted(id: string, limit = 12) {
  const d = await db();
  const { rows } = await d.query<{
    article_code: string;
    article_name: string;
    pos_category: string;
    qty: string;
    total_amount: string;
    uncosted_reason: string | null;
    article_flag: string;
  }>(
    `select sl.article_code, sl.article_name, sl.pos_category, sl.qty, sl.total_amount,
            coalesce(sl.uncosted_reason, sii.kind) as uncosted_reason,
            coalesce(p.article_flag, 'normal') as article_flag
       from sales_lines sl
       join sales_imports si on si.id = sl.sales_import_id
       left join pos_item_map p on p.id = sl.pos_item_map_id
       left join sales_import_issues sii 
         on sii.sales_import_id = sl.sales_import_id 
        and sii.article_code = sl.article_code
        and sii.severity = 'warn'
      where sl.sales_import_id = $1
        and sl.depleted = false
        and coalesce(p.counts_as_sale, true) = true
        and (si.status = 'posted' or sii.kind is not null)
      order by sl.total_amount desc
      limit $2`,
    [id, limit],
  );
  return rows;
}

export async function getDepletedLines(id: string) {
  const d = await db();
  const { rows } = await d.query<{
    article_code: string;
    article_name: string;
    qty: string;
    total_amount: string;
    menu_item_name: string | null;
    store_name: string | null;
    movement_count: string;
    depletion_value: string | null;
  }>(
    `select sl.article_code, sl.article_name, sl.qty, sl.total_amount,
            mi.name as menu_item_name, s.name as store_name,
            (select count(*)::text from stock_movements m where m.source_doc_line = sl.id)
              as movement_count,
            (select coalesce(-sum(m.value_delta), 0)::text from stock_movements m
              where m.source_doc_line = sl.id) as depletion_value
       from sales_lines sl
       left join menu_items mi on mi.id = sl.menu_item_id
       left join stores s on s.id = sl.resolved_store_id
      where sl.sales_import_id = $1 and sl.depleted = true
      order by sl.total_amount desc`,
    [id],
  );
  return rows;
}

/* ------------------------------------------------------------------ ledger */

export async function listStores() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    kind: string;
    description: string | null;
    default_fulfilling_store_id: string | null;
    fulfilling_store_name: string | null;
    par_items_count: string;
  }>(
    `select s.id, s.code, s.name, s.kind, s.description,
            s.default_fulfilling_store_id,
            fs.name as fulfilling_store_name,
            count(l.id)::text as par_items_count
       from stores s
       left join stores fs on fs.id = s.default_fulfilling_store_id
       left join store_item_levels l on l.store_id = s.id and l.tenant_id = s.tenant_id
      where s.tenant_id = $1 and s.is_active
      group by s.id, s.code, s.name, s.kind, s.description, s.default_fulfilling_store_id, fs.name
      order by case s.kind
                 when 'main' then 0
                 when 'cellar' then 1
                 when 'prep' then 2
                 when 'kitchen' then 3
                 when 'bar' then 4
                 else 5
               end, s.name`,
    [t.id],
  );
  return rows;
}

/** Items that have ever moved in this store, so the picker is never a dead end. */
export async function listItemsInStore(storeId: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    uom: string;
    qty_on_hand: string | null;
    category_name: string;
  }>(
    `select i.id, i.code, i.name, i.uom, soh.qty_on_hand, c.name as category_name
       from items i
       join item_categories c on c.id = i.category_id
       left join v_stock_on_hand soh
              on soh.item_id = i.id and soh.store_id = $2 and soh.tenant_id = $1
      where i.tenant_id = $1
        and exists (select 1 from stock_movements m
                     where m.item_id = i.id and m.store_id = $2)
      order by i.name`,
    [t.id, storeId],
  );
  return rows;
}

export async function getLedger(storeId: string, itemId: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    movement_id: string;
    occurred_on: string;
    movement_type: string;
    qty_delta: string;
    unit_cost: string;
    value_delta: string;
    running_qty: string;
    running_value: string;
    note: string | null;
    source_doc_type: string;
    reversal_of_id: string | null;
  }>(
    `select movement_id, occurred_on::text, movement_type, qty_delta, unit_cost,
            value_delta, running_qty, running_value, note, source_doc_type, reversal_of_id
       from v_stock_ledger
      where tenant_id = $1 and store_id = $2 and item_id = $3
      order by occurred_on, movement_sort_rank(movement_type), seq`,
    [t.id, storeId, itemId],
  );
  return rows;
}

export async function getStockSummary(storeId: string, itemId: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    qty_on_hand: string;
    value_on_hand: string;
    avg_unit_cost: string;
    movement_count: string;
    min_qty: string | null;
    max_qty: string | null;
    reorder_status: string | null;
  }>(
    `select soh.qty_on_hand, soh.value_on_hand, soh.avg_unit_cost,
            soh.movement_count::text, l.min_qty, l.max_qty, r.reorder_status
       from v_stock_on_hand soh
       left join store_item_levels l
              on l.tenant_id = soh.tenant_id and l.store_id = soh.store_id and l.item_id = soh.item_id
       left join v_reorder_status r
              on r.tenant_id = soh.tenant_id and r.store_id = soh.store_id and r.item_id = soh.item_id
      where soh.tenant_id = $1 and soh.store_id = $2 and soh.item_id = $3`,
    [t.id, storeId, itemId],
  );
  return rows[0] ?? null;
}

/* ---------------------------------------------------------------- overview */

export async function overviewStats() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    articles: string;
    mapped: string;
    recipes: string;
    sub_recipes: string;
    movements: string;
    imports_posted: string;
  }>(
    `select (select count(*)::text from pos_item_map where tenant_id = $1) as articles,
            (select count(*)::text from pos_item_map
              where tenant_id = $1 and menu_item_id is not null) as mapped,
            (select count(*)::text from recipes where tenant_id = $1 and kind = 'menu') as recipes,
            (select count(*)::text from recipes where tenant_id = $1 and kind = 'sub') as sub_recipes,
            (select count(*)::text from stock_movements where tenant_id = $1) as movements,
            (select count(*)::text from sales_imports
              where tenant_id = $1 and status = 'posted') as imports_posted`,
    [t.id],
  );
  return rows[0];
}

export async function recipeCostsToday() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    recipe_code: string;
    recipe_name: string;
    kind: string;
    menu_kind: string | null;
    is_sample: boolean;
    cost_per_portion: string | null;
  }>(
    `select recipe_code, recipe_name, kind, menu_kind, is_sample, cost_per_portion
       from v_recipe_cost_today
      where tenant_id = $1
      order by kind desc, recipe_name`,
    [t.id],
  );
  return rows;
}
