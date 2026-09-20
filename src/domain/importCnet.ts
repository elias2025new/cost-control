/**
 * Turning a parsed CNET report into a sales import that can be validated and
 * then posted.
 *
 * Nothing here posts anything. It records what the file says, resolves each
 * article against the map, reconciles against the file's own footer, and
 * writes down every problem it found. postSalesImport() decides what to do
 * with the result.
 *
 * Blocking problems are structural only - reconciliation, a period already
 * posted, an unreadable file. Everything about cost coverage is a warning.
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, posParam, qtyParam } from '../lib/money';
import {
  parseCnetBuffer,
  parseCnetFile,
  reconcile,
  suggestArticleFlag,
  type CnetReport,
  type Reconciliation,
} from './parseCnet';

export interface ImportIssue {
  severity: 'block' | 'warn' | 'info';
  kind: string;
  articleCode?: string;
  message: string;
  qty?: Decimal;
  amount?: Decimal;
}

export interface ImportResult {
  importId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  businessDate: string;
  lineCount: number;
  reconciliation: Reconciliation;
  reconciled: boolean;
  issues: ImportIssue[];
  blockingCount: number;
  warningCount: number;
  /** article codes seen for the first time and auto-created in the map */
  newArticleCodes: string[];
  canPost: boolean;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: 'PARSE' | 'UNKNOWN_BRANCH',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export async function importCnetFile(
  db: Database,
  tenantId: string,
  path: string,
): Promise<ImportResult> {
  let report: CnetReport;
  try {
    report = parseCnetFile(path);
  } catch (err) {
    throw new ImportError(
      `Could not read the file: ${(err as Error).message}`,
      'PARSE',
      { path },
    );
  }
  return importCnetReport(db, tenantId, report);
}

export async function importCnetUpload(
  db: Database,
  tenantId: string,
  buf: Buffer,
  filename: string,
): Promise<ImportResult> {
  let report: CnetReport;
  try {
    report = parseCnetBuffer(buf, filename);
  } catch (err) {
    throw new ImportError(`Could not read the file: ${(err as Error).message}`, 'PARSE', {
      filename,
    });
  }
  return importCnetReport(db, tenantId, report);
}

export async function importCnetReport(
  db: Database,
  tenantId: string,
  report: CnetReport,
): Promise<ImportResult> {
  const rec = reconcile(report);

  return db.transaction(async (tx) => {
    const branchId = await resolveBranch(tx, tenantId, report.branch);

    const periodStart = report.periodStart ?? report.generatedOn;
    const periodEnd = report.periodEnd ?? report.generatedOn;
    if (!periodStart || !periodEnd) {
      throw new ImportError(
        'The report header carries no date criteria, so there is no period to post against.',
        'PARSE',
      );
    }
    // Depletion is posted on the last day of the period. A single business day
    // is simply the case where the two dates are equal.
    const businessDate = periodEnd;

    const issues: ImportIssue[] = [];

    // ---- structural: does it reconcile against its own footer? -------------
    if (!rec.subTotalMatches) {
      issues.push({
        severity: 'block',
        kind: 'reconciliation',
        message:
          `The article rows sum to ${rec.computedSubTotal.toString()} but the file's own ` +
          `Sub Total is ${rec.declaredSubTotal?.toString() ?? 'missing'} ` +
          `(difference ${rec.subTotalDifference?.toString() ?? 'n/a'}). ` +
          `An import that does not reconcile does not post.`,
        amount: rec.subTotalDifference ?? undefined,
      });
    }
    if (!rec.categorySubtotalsMatch) {
      for (const m of rec.categoryMismatches) {
        issues.push({
          severity: 'block',
          kind: 'reconciliation',
          message: `Category "${m.category}" subtotal is ${m.declared} but its article rows sum to ${m.computed}.`,
        });
      }
    }
    if (!rec.qtyMatches && rec.declaredQty !== null) {
      issues.push({
        severity: 'block',
        kind: 'reconciliation',
        message: `Quantities sum to ${rec.computedQty.toString()} but the category subtotals declare ${rec.declaredQty.toString()}.`,
      });
    }

    // ---- structural: has this period already posted? -----------------------
    const { rows: dupPeriod } = await tx.query<{ id: string }>(
      `select id from sales_imports
        where tenant_id = $1 and branch_id = $2 and source = 'CNET'
          and period_start = $3::date and period_end = $4::date
          and status = 'posted'`,
      [tenantId, branchId, periodStart, periodEnd],
    );
    if (dupPeriod.length) {
      issues.push({
        severity: 'block',
        kind: 'duplicate_period',
        message:
          `${periodStart} to ${periodEnd} has already been posted for this branch. ` +
          `Posting it again would deplete the same stock twice.`,
      });
    }

    // ---- informational: the identical file again ---------------------------
    const { rows: dupFile } = await tx.query<{ id: string; uploaded_at: string }>(
      `select id, uploaded_at::text from sales_imports
        where tenant_id = $1 and file_sha256 = $2 order by uploaded_at limit 1`,
      [tenantId, report.sha256],
    );
    if (dupFile.length) {
      issues.push({
        severity: 'warn',
        kind: 'duplicate_file',
        message: `This exact file was already uploaded on ${dupFile[0].uploaded_at}.`,
      });
    }

    // ---- the import row ----------------------------------------------------
    const reconciled = rec.subTotalMatches && rec.categorySubtotalsMatch;

    const { rows: created } = await tx.query<{ id: string }>(
      `insert into sales_imports
         (tenant_id, branch_id, source, period_start, period_end, business_date,
          filename, file_sha256, status,
          declared_sub_total, declared_add_charge, declared_discount,
          declared_tax, declared_grand_total,
          computed_sub_total, computed_qty, reconciled, note)
       values ($1, $2, 'CNET', $3::date, $4::date, $5::date, $6, $7, 'draft',
               $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning id`,
      [
        tenantId,
        branchId,
        periodStart,
        periodEnd,
        businessDate,
        report.filename,
        report.sha256,
        nullablePos(report.footer.subTotal),
        nullablePos(report.footer.addCharge),
        nullablePos(report.footer.discount),
        nullablePos(report.footer.totalTax),
        nullablePos(report.footer.grandTotal),
        posParam(rec.computedSubTotal),
        qtyParam(rec.computedQty),
        reconciled,
        report.filterLine,
      ],
    );
    const importId = created[0].id;

    // ---- articles ----------------------------------------------------------
    const newArticleCodes: string[] = [];

    for (const a of report.articles) {
      // Resolve, or create, the map row. Keyed on the article CODE, never the
      // name: ' MOJITO' and 'MOJITO' are different articles.
      let { rows: mapRows } = await tx.query<{
        id: string;
        menu_item_id: string | null;
        article_flag: string;
        depletes: boolean;
        counts_as_sale: boolean;
      }>(
        `select id, menu_item_id, article_flag, depletes, counts_as_sale
           from pos_item_map
          where tenant_id = $1 and source = 'CNET' and article_code = $2`,
        [tenantId, a.articleCode],
      );

      if (!mapRows.length) {
        // First sighting. Suggest a flag from the name so the controller has
        // somewhere to start, and record it against the code. It is a
        // suggestion, reviewed once, and never re-derived from the name later.
        const flag = suggestArticleFlag(a.articleName);
        const inserted = await tx.query<{
          id: string;
          menu_item_id: string | null;
          article_flag: string;
          depletes: boolean;
          counts_as_sale: boolean;
        }>(
          `insert into pos_item_map
             (tenant_id, source, article_code, article_name_seen, pos_category,
              pos_sub_category, article_flag, depletes, counts_as_sale, note, revenue_kind)
           values ($1, 'CNET', $2, $3, $4, $5, $6, $7, $8, $9,
                   classify_revenue_kind($4, $5))
           returning id, menu_item_id, article_flag, depletes, counts_as_sale`,
          [
            tenantId,
            a.articleCode,
            a.articleName,
            a.category,
            a.subCategory,
            flag,
            // a free article consumes stock; a generic or test one has nothing
            // to consume because it can never carry a recipe
            flag === 'free_comp' ? true : flag === 'normal',
            flag !== 'free_comp',
            'auto-created on first sighting - flag is a suggestion, please confirm',
          ],
        );
        mapRows = inserted.rows;
        newArticleCodes.push(a.articleCode);
      } else {
        // Keep the last-seen name and category fresh for display.
        await tx.query(
          `update pos_item_map
              set article_name_seen = $2, pos_category = $3, pos_sub_category = $4,
                  updated_at = now()
            where id = $1`,
          [mapRows[0].id, a.articleName, a.category, a.subCategory],
        );
      }

      const map = mapRows[0];

      const storeId = await resolveStore(tx, tenantId, branchId, a.category, a.subCategory);

      await tx.query(
        `insert into sales_lines
           (tenant_id, sales_import_id, line_no, pos_category, pos_sub_category,
            article_code, article_name, qty, avg_amount, total_amount,
            pos_item_map_id, menu_item_id, resolved_store_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          tenantId,
          importId,
          a.lineNo,
          a.category,
          a.subCategory,
          a.articleCode, // TEXT - '00081' keeps its leading zeros
          a.articleName, // verbatim, stray whitespace and all
          qtyParam(a.qty),
          nullablePos(a.avgAmount),
          posParam(a.totalAmount),
          map.id,
          map.menu_item_id,
          storeId,
        ],
      );

      // ---- coverage warnings, none of which block ------------------------
      if (map.article_flag === 'generic') {
        issues.push({
          severity: 'warn',
          kind: 'generic',
          articleCode: a.articleCode,
          message:
            `"${a.articleName.trim()}" names a class of product, not a product. ` +
            `No recipe can exist for it, so ${a.qty.toString()} units cannot be costed.`,
          qty: a.qty,
          amount: a.totalAmount,
        });
      } else if (map.article_flag === 'test') {
        issues.push({
          severity: 'warn',
          kind: 'test',
          articleCode: a.articleCode,
          message: `"${a.articleName.trim()}" is a test article and is live in production.`,
          qty: a.qty,
          amount: a.totalAmount,
        });
      } else if (map.article_flag === 'free_comp') {
        issues.push({
          severity: 'warn',
          kind: 'free_comp',
          articleCode: a.articleCode,
          message:
            `"${a.articleName.trim()}" consumes real stock at no revenue. ` +
            `${a.qty.toString()} units will deplete inventory but not count as sales.`,
          qty: a.qty,
          amount: a.totalAmount,
        });
      } else if (!map.menu_item_id) {
        issues.push({
          severity: 'warn',
          kind: 'unmapped',
          articleCode: a.articleCode,
          message:
            `"${a.articleName.trim()}" is not mapped to a menu item. ` +
            `Revenue is recorded; stock will not move until it is mapped and given a recipe.`,
          qty: a.qty,
          amount: a.totalAmount,
        });
      } else if (!storeId) {
        issues.push({
          severity: 'warn',
          kind: 'no_store_mapping',
          articleCode: a.articleCode,
          message:
            `Category "${a.category}" has no store mapping, so there is nowhere to deplete ` +
            `"${a.articleName.trim()}" from.`,
          qty: a.qty,
          amount: a.totalAmount,
        });
      } else {
        // mapped and has somewhere to deplete from - is there a recipe?
        const { rows: r } = await tx.query<{ has_version: boolean }>(
          `select recipe_version_on($1, r.id, $3::date) is not null as has_version
             from recipes r
            where r.tenant_id = $1 and r.menu_item_id = $2`,
          [tenantId, map.menu_item_id, businessDate],
        );
        if (!r.length || !r[0].has_version) {
          issues.push({
            severity: 'warn',
            kind: 'no_active_recipe',
            articleCode: a.articleCode,
            message:
              `"${a.articleName.trim()}" has no recipe active on ${businessDate}. ` +
              `Revenue is recorded; stock will not move.`,
            qty: a.qty,
            amount: a.totalAmount,
          });
        }
      }
    }

    // ---- informational notes about the file itself -------------------------
    if (report.voidStateFiltered) {
      issues.push({
        severity: 'info',
        kind: 'voids_excluded',
        message:
          'This report is pre-filtered to Void State = Not void, so voided sales are not in it. ' +
          'Voids need a separate report.',
      });
    }
    if (rec.addChargeRateOfNet) {
      issues.push({
        severity: 'info',
        kind: 'service_charge',
        message:
          `The add-on charge is ${rec.addChargeRateOfNet.times(100).toDecimalPlaces(4).toString()}% ` +
          `of net sales, not a flat 10%, so only some sales carry the service charge. ` +
          `Which ones is an open question - no flat rate is applied anywhere in this system.`,
        amount: report.footer.addCharge ?? undefined,
      });
    }
    if (rec.taxDifferenceFromFlatRate && !rec.taxDifferenceFromFlatRate.isZero()) {
      issues.push({
        severity: 'info',
        kind: 'tax_rounding',
        message:
          `Total Tax is ${rec.taxDifferenceFromFlatRate.toString()} birr away from a flat 15% of ` +
          `(net + add charge). That is per-bill rounding at the POS across ${rec.computedQty.toString()} ` +
          `items, not an error, and it does not block posting.`,
        amount: rec.taxDifferenceFromFlatRate,
      });
    }
    if (report.periodStart !== report.periodEnd) {
      issues.push({
        severity: 'info',
        kind: 'multi_day_period',
        message:
          `This report covers ${periodStart} to ${periodEnd}, not a single business day. ` +
          `Depletion will be posted against ${businessDate}. Daily depletion needs the report ` +
          `run per business day.`,
      });
    }

    // ---- persist the issues ------------------------------------------------
    for (const i of issues) {
      await tx.query(
        `insert into sales_import_issues
           (tenant_id, sales_import_id, severity, kind, article_code, message, qty, amount)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          importId,
          i.severity,
          i.kind,
          i.articleCode ?? null,
          i.message,
          i.qty ? qtyParam(i.qty) : null,
          i.amount ? posParam(i.amount) : null,
        ],
      );
    }

    const blockingCount = issues.filter((i) => i.severity === 'block').length;

    if (blockingCount === 0) {
      await tx.query(`update sales_imports set status = 'validated' where id = $1`, [importId]);
    } else {
      await tx.query(`update sales_imports set status = 'rejected' where id = $1`, [importId]);
    }

    return {
      importId,
      branchId,
      periodStart,
      periodEnd,
      businessDate,
      lineCount: report.articles.length,
      reconciliation: rec,
      reconciled,
      issues,
      blockingCount,
      warningCount: issues.filter((i) => i.severity === 'warn').length,
      newArticleCodes,
      canPost: blockingCount === 0 && reconciled,
    };
  });
}

/* ----------------------------------------------------------------- helpers */

async function resolveBranch(tx: Tx, tenantId: string, branchName: string | null) {
  if (branchName) {
    const { rows } = await tx.query<{ id: string }>(
      `select id from branches where tenant_id = $1 and lower(name) = lower($2)`,
      [tenantId, branchName],
    );
    if (rows.length) return rows[0].id;
  }
  const { rows } = await tx.query<{ id: string }>(
    `select id from branches where tenant_id = $1 order by created_at limit 1`,
    [tenantId],
  );
  if (!rows.length) {
    throw new ImportError(
      `No branch is configured for this tenant, and the report names "${branchName ?? 'none'}".`,
      'UNKNOWN_BRANCH',
      { branchName },
    );
  }
  return rows[0].id;
}

async function resolveStore(
  tx: Tx,
  tenantId: string,
  branchId: string,
  category: string,
  sub: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ store_id: string | null }>(
    `select resolve_pos_store($1, $2, 'CNET', $3, $4) as store_id`,
    [tenantId, branchId, category, sub],
  );
  return rows[0]?.store_id ?? null;
}

const nullablePos = (v: Decimal | null) => (v === null ? null : posParam(v));

export { dec };
