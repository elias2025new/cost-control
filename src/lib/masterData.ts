import 'server-only';

import { db } from './server-db';
import { requireTenant } from './queries';

/** Read models for the Setup screens. */

export async function listBranches() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string }>(
    `select id, code, name from branches where tenant_id = $1 order by name`,
    [t.id],
  );
  return rows;
}

export async function listSuppliers() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string; contact: string | null; is_active: boolean }>(
    `select id, code, name, contact, is_active from suppliers where tenant_id = $1 order by name`,
    [t.id],
  );
  return rows;
}


export async function getBranch(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string }>(
    `select id, code, name from branches where tenant_id = $1 and id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function listCategories() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string; kind: string }>(
    `select id, code, name, kind from item_categories where tenant_id = $1
      order by case kind when 'food' then 0 when 'beverage' then 1 else 2 end, name`,
    [t.id],
  );
  return rows;
}

export async function getCategory(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string; kind: string }>(
    `select id, code, name, kind from item_categories where tenant_id = $1 and id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function getStore(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    kind: string;
    branch_id: string;
  }>(
    `select id, code, name, kind, branch_id from stores where tenant_id = $1 and id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function listItems() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    uom: string;
    is_active: boolean;
    is_sample: boolean;
    category_name: string;
    category_kind: string;
    current_cost: string | null;
  }>(
    `select i.id, i.code, i.name, i.uom, i.is_active, i.is_sample, c.name as category_name,
            c.kind as category_kind, v.standard_cost as current_cost
       from items i
       join item_categories c on c.id = i.category_id
       left join item_cost_versions v
              on v.item_id = i.id and v.tenant_id = i.tenant_id and v.effective_to is null
      where i.tenant_id = $1
      order by i.name`,
    [t.id],
  );
  return rows;
}

export async function getItem(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    uom: string;
    is_active: boolean;
    is_sample: boolean;
    category_id: string;
    category_name: string;
  }>(
    `select i.id, i.code, i.name, i.uom, i.is_active, i.is_sample,
            i.category_id, c.name as category_name
       from items i
       join item_categories c on c.id = i.category_id
      where i.tenant_id = $1 and i.id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function listParLevelsForItem(itemId: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    store_id: string;
    store_name: string;
    min_qty: string | null;
    max_qty: string | null;
  }>(
    `select s.id as store_id, s.name as store_name, l.min_qty, l.max_qty
       from stores s
       left join store_item_levels l
              on l.store_id = s.id and l.item_id = $2 and l.tenant_id = $1
      where s.tenant_id = $1 and s.is_active
      order by case s.kind when 'main' then 0 when 'kitchen' then 1 else 2 end, s.name`,
    [t.id, itemId],
  );
  return rows;
}

export async function listOpeningBalances() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    store_name: string;
    item_code: string;
    item_name: string;
    uom: string;
    qty_delta: string;
    unit_cost: string;
    occurred_on: string;
    note: string | null;
  }>(
    `select m.id, s.name as store_name, i.code as item_code, i.name as item_name, i.uom,
            m.qty_delta, m.unit_cost, m.occurred_on::text as occurred_on, m.note
       from stock_movements m
       join stores s on s.id = m.store_id
       join items i on i.id = m.item_id
      where m.tenant_id = $1 and m.movement_type = 'opening'
      order by m.occurred_on desc, i.name`,
    [t.id],
  );
  return rows;
}

/** Real categories, seen the moment an import parses them - never typed by hand elsewhere. */
export async function listDistinctPosCategories() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ pos_category: string; pos_sub_category: string | null }>(
    `select distinct pos_category, pos_sub_category
       from pos_item_map
      where tenant_id = $1 and pos_category is not null
      order by pos_category, pos_sub_category nulls first`,
    [t.id],
  );
  return rows;
}

export async function listCategoryStoreMap() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    branch_name: string;
    pos_category: string;
    pos_sub_category: string | null;
    store_name: string;
    is_assumed: boolean;
    note: string | null;
  }>(
    `select m.id, b.name as branch_name, m.pos_category, m.pos_sub_category,
            s.name as store_name, m.is_assumed, m.note
       from pos_category_store_map m
       join branches b on b.id = m.branch_id
       join stores s on s.id = m.store_id
      where m.tenant_id = $1
      order by m.pos_category, m.pos_sub_category nulls first`,
    [t.id],
  );
  return rows;
}

/** Requests visible to the caller: admins see all, a store user sees their own. */
export async function listIssueRequests(scopeStoreId: string | null) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    status: string;
    requesting_store_id: string;
    requesting_store: string;
    fulfilling_store_id: string;
    fulfilling_store: string;
    requested_at: string;
    line_count: string;
    requested_by: string | null;
  }>(
    `select r.id, r.status,
            r.requesting_store_id, rs.name as requesting_store,
            r.fulfilling_store_id, fs.name as fulfilling_store,
            r.requested_at::text as requested_at,
            (select count(*)::text from issue_request_lines l
              where l.issue_request_id = r.id) as line_count,
            u.display_name as requested_by
       from issue_requests r
       join stores rs on rs.id = r.requesting_store_id
       join stores fs on fs.id = r.fulfilling_store_id
       left join users u on u.id = r.requested_by_user_id
      where r.tenant_id = $1
        and ($2::uuid is null
             or r.requesting_store_id = $2::uuid
             or r.fulfilling_store_id = $2::uuid)
      order by r.requested_at desc`,
    [t.id, scopeStoreId],
  );
  return rows;
}

export async function getIssueRequest(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    status: string;
    requesting_store_id: string;
    requesting_store: string;
    fulfilling_store_id: string;
    fulfilling_store: string;
    requested_at: string;
    fulfilled_at: string | null;
    note: string | null;
    requested_by: string | null;
    fulfilled_by: string | null;
  }>(
    `select r.id, r.status,
            r.requesting_store_id, rs.name as requesting_store,
            r.fulfilling_store_id, fs.name as fulfilling_store,
            r.requested_at::text as requested_at,
            r.fulfilled_at::text as fulfilled_at,
            r.note,
            ru.display_name as requested_by,
            fu.display_name as fulfilled_by
       from issue_requests r
       join stores rs on rs.id = r.requesting_store_id
       join stores fs on fs.id = r.fulfilling_store_id
       left join users ru on ru.id = r.requested_by_user_id
       left join users fu on fu.id = r.fulfilled_by_user_id
      where r.tenant_id = $1 and r.id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

/** Lines with what the fulfilling store actually has on hand right now. */
export async function getIssueRequestLines(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    requested_qty: string;
    fulfilled_qty: string | null;
    note: string | null;
    available_qty: string | null;
  }>(
    `select l.id, l.item_id, i.code as item_code, i.name as item_name, i.uom,
            l.requested_qty, l.fulfilled_qty, l.note,
            soh.qty_on_hand as available_qty
       from issue_request_lines l
       join items i on i.id = l.item_id
       join issue_requests r on r.id = l.issue_request_id
       left join v_stock_on_hand soh
              on soh.tenant_id = l.tenant_id
             and soh.item_id = l.item_id
             and soh.store_id = r.fulfilling_store_id
      where l.tenant_id = $1 and l.issue_request_id = $2
      order by i.name`,
    [t.id, id],
  );
  return rows;
}

export async function listUsers() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    username: string;
    display_name: string;
    role: string;
    store_id: string | null;
    store_name: string | null;
    is_active: boolean;
  }>(
    `select u.id, u.username, u.display_name, u.role, u.store_id,
            s.name as store_name, u.is_active
       from users u
       left join stores s on s.id = u.store_id
      where u.tenant_id = $1
      order by u.role, u.display_name`,
    [t.id],
  );
  return rows;
}

export async function getUser(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    username: string;
    display_name: string;
    role: string;
    store_id: string | null;
    is_active: boolean;
    permissions: string[];
  }>(
    `select id, username, display_name, role, store_id, is_active, permissions
       from users where tenant_id = $1 and id = $2`,
    [t.id, id],
  );
  return rows[0] ?? null;
}

export async function listMenuItems() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{ id: string; code: string; name: string; kind: string }>(
    `select id, code, name, kind from menu_items where tenant_id = $1 order by name`,
    [t.id],
  );
  return rows;
}

export async function listRecipesForAuthoring() {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    kind: string;
    is_sample: boolean;
    menu_item_name: string | null;
    batch_yield_qty: string | null;
    batch_yield_uom: string | null;
    line_count: string;
  }>(
    `select r.id, r.code, r.name, r.kind, r.is_sample, mi.name as menu_item_name,
            r.batch_yield_qty, r.batch_yield_uom,
            (select count(*)::text from recipe_lines l
              join recipe_versions rv on rv.id = l.recipe_version_id
              where rv.recipe_id = r.id and rv.effective_to is null) as line_count
       from recipes r
       left join menu_items mi on mi.id = r.menu_item_id
      where r.tenant_id = $1
      order by case r.kind when 'sub' then 0 else 1 end, r.name`,
    [t.id],
  );
  return rows;
}

export async function getRecipeForAuthoring(id: string) {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    code: string;
    name: string;
    kind: string;
    is_sample: boolean;
    menu_item_id: string | null;
    menu_item_name: string | null;
    batch_yield_qty: string | null;
    batch_yield_uom: string | null;
    version_id: string;
    version_no: number;
    effective_from: string;
  }>(
    `select r.id, r.code, r.name, r.kind, r.is_sample, r.menu_item_id, mi.name as menu_item_name,
            r.batch_yield_qty, r.batch_yield_uom,
            rv.id as version_id, rv.version_no, rv.effective_from::text as effective_from
       from recipes r
       left join menu_items mi on mi.id = r.menu_item_id
       join recipe_versions rv on rv.recipe_id = r.id and rv.effective_to is null
      where r.tenant_id = $1 and r.id = $2`,
    [t.id, id],
  );
  const recipe = rows[0] ?? null;
  if (!recipe) return null;

  const { rows: lines } = await d.query<{
    id: string;
    line_no: number;
    component_type: 'item' | 'sub';
    component_id: string;
    component_name: string;
    qty: string;
    uom: string;
    note: string | null;
  }>(
    `select l.id, l.line_no,
            case when l.component_item_id is not null then 'item' else 'sub' end as component_type,
            coalesce(l.component_item_id, l.component_recipe_id) as component_id,
            coalesce(i.name, cr.name) as component_name,
            l.qty,
            coalesce(i.uom, cr.batch_yield_uom) as uom,
            l.note
       from recipe_lines l
       left join items i on i.id = l.component_item_id
       left join recipes cr on cr.id = l.component_recipe_id
      where l.tenant_id = $1 and l.recipe_version_id = $2
      order by l.line_no`,
    [t.id, recipe.version_id],
  );

  return { ...recipe, lines };
}

/**
 * pos_item_map rows are never created here - importCnetFile/importCnetUpload
 * auto-create one per article code the first time it's seen in a sales file.
 * This screen only edits: assigning a menu item, correcting the flag, or
 * fixing depletes/counts_as_sale.
 */
export async function listPosArticleMap(filter: 'all' | 'unmapped' = 'all') {
  const d = await db();
  const t = await requireTenant();
  const { rows } = await d.query<{
    id: string;
    article_code: string;
    article_name_seen: string | null;
    pos_category: string | null;
    menu_item_id: string | null;
    article_flag: string;
    depletes: boolean;
    counts_as_sale: boolean;
    note: string | null;
  }>(
    `select id, article_code, article_name_seen, pos_category, menu_item_id,
            article_flag, depletes, counts_as_sale, note
       from pos_item_map
      where tenant_id = $1
        and ($2 = 'all' or menu_item_id is null)
      order by article_code`,
    [t.id, filter],
  );
  return rows;
}
