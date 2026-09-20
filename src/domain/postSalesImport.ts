/**
 * postSalesImport(importId)
 *
 * In one transaction, records the day's sales and depletes stock for every
 * line that has a recipe to explode.
 *
 * WHAT REJECTS THE IMPORT - structural problems only:
 *
 *   the lines do not sum to the subtotal printed in the file's own footer
 *   this branch and period is already posted
 *   the file could not be parsed (caught earlier, at import time)
 *
 * WHAT DOES NOT REJECT THE IMPORT - missing recipes:
 *
 *   Revenue always posts. Every sales line is recorded whether or not a recipe
 *   exists for it. Depletion happens only for lines that have an active recipe
 *   on the business date; the rest are recorded and flagged as uncosted.
 *
 *   This is not a concession, it is the permanent state of the system. There
 *   will be a handful of recipes against 171 articles at go-live and recipes
 *   get written gradually over the following weeks. An import that refused to
 *   post until every article had a recipe would never post at all.
 *
 *   The result therefore carries cost coverage: how much of the day's revenue
 *   could actually be costed, and how much birr could not. That number climbs
 *   as the controller writes recipes.
 *
 * Idempotent: posting the same import twice must not double-deplete. The
 * import row is locked FOR UPDATE and its status re-checked inside the
 * transaction before anything is written, so two concurrent callers cannot
 * both decide it is unposted. A unique index on the ledger backs that up.
 *
 * Free and complimentary articles are the interesting case: FREE WATER,
 * FREE AMBO and the rest consume real stock at no revenue, so they deplete
 * here while being excluded from revenue everywhere else.
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';
import { costRecipe, RecipeCostError } from './costRecipe';

export class PostImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'IMPORT_NOT_FOUND'
      | 'NOT_RECONCILED'
      | 'BLOCKING_ISSUES'
      | 'IMPORT_REVERSED'
      | 'CONCURRENT_POST',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PostImportError';
  }
}

/** Why a recorded sales line could not deplete stock. */
export type UncostedReason =
  | 'not_mapped'
  | 'generic_article'
  | 'test_article'
  | 'no_recipe'
  | 'no_active_recipe_version'
  | 'no_store_mapping'
  | 'recipe_error'
  | 'does_not_deplete';

export interface UncostedLine {
  articleCode: string;
  articleName: string;
  qty: Decimal;
  revenue: Decimal;
  reason: UncostedReason;
  detail?: string;
}

export interface CostCoverage {
  /** revenue on lines that count as sales */
  revenueTotal: Decimal;
  /** of that, revenue the system could explode into ingredients */
  revenueCosted: Decimal;
  /** of that, revenue it could not */
  revenueUncosted: Decimal;
  /** revenueCosted / revenueTotal as a percentage, 2 dp */
  revenueCostedPct: Decimal | null;
  lineCount: number;
  costedLineCount: number;
}

export interface PostResult {
  importId: string;
  /** false when the import was already posted - nothing was written */
  posted: boolean;
  alreadyPosted: boolean;
  businessDate: string;
  linesDepleted: number;
  movementsWritten: number;
  /** value of stock consumed, at moving weighted average */
  totalDepletionValue: Decimal;
  /** articles that moved stock but are not revenue */
  freeCompLinesDepleted: number;
  coverage: CostCoverage;
  uncosted: UncostedLine[];
}

interface ImportRow {
  id: string;
  tenant_id: string;
  branch_id: string;
  business_date: string;
  status: string;
  reconciled: boolean;
}

interface LineRow {
  id: string;
  article_code: string;
  article_name: string | null;
  qty: string;
  total_amount: string;
  menu_item_id: string | null;
  resolved_store_id: string | null;
  article_flag: string;
  depletes: boolean;
  counts_as_sale: boolean;
  recipe_id: string | null;
  has_active_version: boolean;
}

export async function postSalesImport(db: Database, importId: string): Promise<PostResult> {
  return db.transaction(async (tx) => {
    // ------------------------------------------------------------------
    // Lock the import row and re-check its status inside the transaction.
    // The unique index stops a duplicate business day being created; it does
    // not stop the same import being posted twice concurrently. This does.
    // ------------------------------------------------------------------
    const { rows: found } = await tx.query<ImportRow>(
      `select id, tenant_id, branch_id, business_date::text as business_date, status, reconciled
         from sales_imports
        where id = $1
        for update`,
      [importId],
    );
    if (!found.length) {
      throw new PostImportError(`Sales import ${importId} not found.`, 'IMPORT_NOT_FOUND', {
        importId,
      });
    }
    const imp = found[0];

    // Posting twice changes nothing and is not an error. Someone will click
    // the button twice and must not be punished for it.
    if (imp.status === 'posted') return alreadyPostedResult(tx, imp);

    if (imp.status === 'reversed') {
      throw new PostImportError(
        `Sales import ${importId} has been reversed and cannot be posted again. ` +
          `Re-upload the file to create a new import.`,
        'IMPORT_REVERSED',
        { importId },
      );
    }

    // -------- structural gate 1: it must reconcile -----------------------
    if (!imp.reconciled) {
      throw new PostImportError(
        `Sales import ${importId} does not reconcile against the subtotal printed in its own ` +
          `footer and cannot be posted.`,
        'NOT_RECONCILED',
        { importId },
      );
    }

    // -------- structural gate 2: no blocking issues ----------------------
    // Only structural kinds ever carry severity 'block'. Coverage problems -
    // unmapped articles, generic articles, articles with no recipe yet - are
    // warnings and deliberately do not stop a posting.
    const { rows: blockers } = await tx.query<{ kind: string; count: string }>(
      `select kind, count(*)::text as count
         from sales_import_issues
        where sales_import_id = $1 and severity = 'block'
        group by kind`,
      [importId],
    );
    if (blockers.length) {
      throw new PostImportError(
        `Sales import ${importId} has unresolved structural problems: ` +
          blockers.map((b) => `${b.kind} (${b.count})`).join(', '),
        'BLOCKING_ISSUES',
        { importId, blockers },
      );
    }

    // ------------------------------------------------------------------
    // Every line, with whatever the system knows about it.
    // ------------------------------------------------------------------
    const { rows: lines } = await tx.query<LineRow>(
      `select sl.id,
              sl.article_code,
              sl.article_name,
              sl.qty,
              sl.total_amount,
              sl.menu_item_id,
              sl.resolved_store_id,
              coalesce(pim.article_flag, 'normal')   as article_flag,
              coalesce(pim.depletes, false)          as depletes,
              coalesce(pim.counts_as_sale, true)     as counts_as_sale,
              r.id as recipe_id,
              (recipe_version_on(sl.tenant_id, r.id, $2::date) is not null)
                                                     as has_active_version
         from sales_lines sl
         left join pos_item_map pim on pim.id = sl.pos_item_map_id
         left join recipes r
                on r.tenant_id = sl.tenant_id
               and r.menu_item_id = sl.menu_item_id
        where sl.sales_import_id = $1
        order by sl.line_no`,
      [importId, imp.business_date],
    );

    const depletable: LineRow[] = [];
    const uncosted: UncostedLine[] = [];

    for (const l of lines) {
      const reason = uncostedReason(l);
      if (reason === null) {
        depletable.push(l);
      } else {
        uncosted.push({
          articleCode: l.article_code,
          articleName: l.article_name ?? '',
          qty: dec(l.qty),
          revenue: l.counts_as_sale ? dec(l.total_amount) : new Decimal(0),
          reason,
        });
      }
    }

    // ------------------------------------------------------------------
    // Explode the recipes. A recipe that cannot be exploded takes its own
    // line out of depletion and nothing else with it.
    // ------------------------------------------------------------------
    const explosions: { line: LineRow; storeId: string; items: { itemId: string; qty: Decimal }[] }[] =
      [];

    for (const line of depletable) {
      try {
        const cost = await costRecipe(tx, imp.tenant_id, line.recipe_id!, imp.business_date);
        const portions = dec(line.qty);
        explosions.push({
          line,
          storeId: line.resolved_store_id!,
          // costRecipe has already summed an ingredient reached by two
          // branches of the tree, so each item lands as exactly one movement.
          items: cost.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.times(portions) })),
        });
      } catch (err) {
        if (!(err instanceof RecipeCostError)) throw err;
        uncosted.push({
          articleCode: line.article_code,
          articleName: line.article_name ?? '',
          qty: dec(line.qty),
          revenue: line.counts_as_sale ? dec(line.total_amount) : new Decimal(0),
          reason: err.code === 'NO_ACTIVE_VERSION' ? 'no_active_recipe_version' : 'recipe_error',
          detail: err.message,
        });
      }
    }

    // ------------------------------------------------------------------
    // Cost the outbound movements.
    //
    // Issuing at weighted average does not move the average - only a receipt
    // does. So the average per store and item is read once for this posting
    // and reused for every line, instead of being re-queried per movement.
    // Receipts landing on the same business day are ordered ahead of
    // depletions by the ledger itself (movement_sort_rank), so the average
    // read here already includes them.
    // ------------------------------------------------------------------
    const avgCache = new Map<string, Decimal>();
    const avgCostFor = async (storeId: string, itemId: string): Promise<Decimal> => {
      const key = `${storeId}:${itemId}`;
      const hit = avgCache.get(key);
      if (hit) return hit;
      const { rows } = await tx.query<{ avg: string }>(
        `select current_avg_cost($1, $2, $3) as avg`,
        [imp.tenant_id, storeId, itemId],
      );
      const v = dec(rows[0]?.avg ?? 0);
      avgCache.set(key, v);
      return v;
    };

    let movementsWritten = 0;
    let totalValue = new Decimal(0);

    for (const ex of explosions) {
      for (const item of ex.items) {
        if (item.qty.isZero()) continue;

        const unitCost = await avgCostFor(ex.storeId, item.itemId);
        const qtyDelta = item.qty.negated();
        const valueDelta = qtyDelta.times(unitCost);

        await tx.query(
          `insert into stock_movements
             (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
              occurred_on, source_doc_type, source_doc_id, source_doc_line, note)
           values ($1, $2, $3, 'sale_depletion', $4, $5, $6, $7::date,
                   'sales_import', $8, $9, $10)`,
          [
            imp.tenant_id,
            ex.storeId,
            item.itemId,
            qtyParam(qtyDelta),
            moneyParam(unitCost),
            moneyParam(valueDelta),
            imp.business_date,
            imp.id,
            ex.line.id,
            `${ex.line.article_code} ${ex.line.article_name ?? ''} x${ex.line.qty}`.trim(),
          ],
        );
        movementsWritten += 1;
        totalValue = totalValue.plus(valueDelta.negated());
      }
    }

    // ------------------------------------------------------------------
    // Mark up the lines, so the ledger and the UI agree about what happened.
    // ------------------------------------------------------------------
    const depletedIds = explosions.map((e) => e.line.id);
    if (depletedIds.length) {
      await tx.query(
        `update sales_lines set depleted = true, uncosted_reason = null
          where id = any($1::uuid[])`,
        [depletedIds],
      );
    }
    for (const u of uncosted) {
      await tx.query(
        `update sales_lines
            set depleted = false, uncosted_reason = $2
          where sales_import_id = $1 and article_code = $3`,
        [importId, u.reason, u.articleCode],
      );
    }

    // Record the coverage gaps as warnings so the validation panel and the
    // posted record tell the same story.
    if (uncosted.length) {
      await tx.query(
        `delete from sales_import_issues
          where sales_import_id = $1 and kind = 'no_active_recipe'`,
        [importId],
      );
      for (const u of uncosted.filter(
        (x) => x.reason === 'no_recipe' || x.reason === 'no_active_recipe_version' || x.reason === 'recipe_error',
      )) {
        await tx.query(
          `insert into sales_import_issues
             (tenant_id, sales_import_id, severity, kind, article_code, message, qty, amount)
           values ($1, $2, 'warn', 'no_active_recipe', $3, $4, $5, $6)`,
          [
            imp.tenant_id,
            importId,
            u.articleCode,
            u.detail ??
              `No recipe active on ${imp.business_date}; revenue recorded, stock not depleted.`,
            qtyParam(u.qty),
            u.revenue.toFixed(4),
          ],
        );
      }
    }

    // ------------------------------------------------------------------
    // The status change is part of the same transaction as the movements.
    // ------------------------------------------------------------------
    const { rowCount } = await tx.query(
      `update sales_imports
          set status = 'posted', posted_at = now()
        where id = $1 and status <> 'posted'`,
      [importId],
    );
    if (rowCount === 0) {
      throw new PostImportError(
        `Sales import ${importId} was posted concurrently; this attempt was rolled back.`,
        'CONCURRENT_POST',
        { importId },
      );
    }

    const coverage = computeCoverage(lines, new Set(depletedIds));

    return {
      importId,
      posted: true,
      alreadyPosted: false,
      businessDate: imp.business_date,
      linesDepleted: explosions.length,
      movementsWritten,
      totalDepletionValue: totalValue,
      freeCompLinesDepleted: explosions.filter((e) => e.line.article_flag === 'free_comp').length,
      coverage,
      uncosted,
    };
  });
}

/**
 * Reverse a posted import. Nothing is deleted: every movement gets an equal
 * and opposite row pointing back at the one it reverses.
 */
export async function reverseSalesImport(
  db: Database,
  importId: string,
  note = 'import reversed',
): Promise<{ movementsReversed: number }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<ImportRow>(
      `select id, tenant_id, branch_id, business_date::text as business_date, status, reconciled
         from sales_imports where id = $1 for update`,
      [importId],
    );
    if (!rows.length) {
      throw new PostImportError(`Sales import ${importId} not found.`, 'IMPORT_NOT_FOUND', {
        importId,
      });
    }
    if (rows[0].status !== 'posted') return { movementsReversed: 0 };

    const { rows: originals } = await tx.query<{
      id: string;
      store_id: string;
      item_id: string;
      qty_delta: string;
      unit_cost: string;
      value_delta: string;
    }>(
      `select id, store_id, item_id, qty_delta, unit_cost, value_delta
         from stock_movements
        where source_doc_type = 'sales_import'
          and source_doc_id = $1
          and reversal_of_id is null`,
      [importId],
    );

    for (const m of originals) {
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, reversal_of_id, note)
         values ($1, $2, $3, 'reversal', $4, $5, $6, current_date, 'sales_import', $7, $8, $9)`,
        [
          rows[0].tenant_id,
          m.store_id,
          m.item_id,
          qtyParam(dec(m.qty_delta).negated()),
          m.unit_cost,
          moneyParam(dec(m.value_delta).negated()),
          importId,
          m.id,
          note,
        ],
      );
    }

    await tx.query(
      `update sales_imports set status = 'reversed', reversed_at = now() where id = $1`,
      [importId],
    );
    return { movementsReversed: originals.length };
  });
}

/* ----------------------------------------------------------------- helpers */

/** null means the line can deplete. */
function uncostedReason(l: LineRow): UncostedReason | null {
  if (!l.menu_item_id) {
    if (l.article_flag === 'generic') return 'generic_article';
    if (l.article_flag === 'test') return 'test_article';
    return 'not_mapped';
  }
  if (!l.depletes) return 'does_not_deplete';
  if (!l.recipe_id) return 'no_recipe';
  if (!l.has_active_version) return 'no_active_recipe_version';
  if (!l.resolved_store_id) return 'no_store_mapping';
  return null;
}

function computeCoverage(lines: LineRow[], depletedIds: Set<string>): CostCoverage {
  let revenueTotal = new Decimal(0);
  let revenueCosted = new Decimal(0);

  for (const l of lines) {
    // Free and comp articles are not revenue and must not move the percentage.
    if (!l.counts_as_sale) continue;
    const amount = dec(l.total_amount);
    revenueTotal = revenueTotal.plus(amount);
    if (depletedIds.has(l.id)) revenueCosted = revenueCosted.plus(amount);
  }

  const revenueUncosted = revenueTotal.minus(revenueCosted);
  return {
    revenueTotal,
    revenueCosted,
    revenueUncosted,
    revenueCostedPct: revenueTotal.isZero()
      ? null
      : revenueCosted.dividedBy(revenueTotal).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    lineCount: lines.length,
    costedLineCount: depletedIds.size,
  };
}

async function alreadyPostedResult(tx: Tx, imp: ImportRow): Promise<PostResult> {
  const { rows } = await tx.query<{ movements: string; value: string; lines: string }>(
    `select count(*)::text                        as movements,
            coalesce(-sum(value_delta), 0)::text  as value,
            count(distinct source_doc_line)::text as lines
       from stock_movements
      where source_doc_type = 'sales_import'
        and source_doc_id = $1
        and movement_type = 'sale_depletion'`,
    [imp.id],
  );

  const { rows: cov } = await tx.query<{
    revenue_total: string | null;
    revenue_costed: string | null;
    revenue_uncosted: string | null;
    revenue_costed_pct: string | null;
    line_count: string;
    costed_line_count: string;
  }>(
    `select revenue_total, revenue_costed, revenue_uncosted, revenue_costed_pct,
            line_count::text, costed_line_count::text
       from v_import_cost_coverage where sales_import_id = $1`,
    [imp.id],
  );
  const c = cov[0];

  return {
    importId: imp.id,
    posted: false,
    alreadyPosted: true,
    businessDate: imp.business_date,
    linesDepleted: Number(rows[0]?.lines ?? 0),
    movementsWritten: 0,
    totalDepletionValue: dec(rows[0]?.value ?? 0),
    freeCompLinesDepleted: 0,
    coverage: {
      revenueTotal: dec(c?.revenue_total ?? 0),
      revenueCosted: dec(c?.revenue_costed ?? 0),
      revenueUncosted: dec(c?.revenue_uncosted ?? 0),
      revenueCostedPct: c?.revenue_costed_pct == null ? null : dec(c.revenue_costed_pct),
      lineCount: Number(c?.line_count ?? 0),
      costedLineCount: Number(c?.costed_line_count ?? 0),
    },
    uncosted: [],
  };
}
