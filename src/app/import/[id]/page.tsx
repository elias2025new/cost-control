import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  PageHeader,
  Card,
  Stat,
  Badge,
  Empty,
  ApprovalChain,
  OnboardingNotice,
} from '../../../components/ui';
import {
  currentTenant,
  getImport,
  getImportIssues,
  getImportCoverage,
  getTopUncosted,
  getDepletedLines,
  listStores,
} from '../../../lib/queries';
import { etb, pct, qty, longDate, UNCOSTED_LABELS } from '../../../lib/format';
import { dec } from '../../../lib/money';
import { db } from '../../../lib/server-db';
import {
  getTheoreticalVsActualMatrix,
  detectCostLeakage,
  type LeakageAnalysis,
} from '../../../domain/theoreticalReconciliation';
import { PostButton } from './PostButton';

export const dynamic = 'force-dynamic';

const KIND_TITLES: Record<string, { title: string; blurb: string }> = {
  reconciliation: {
    title: 'Reconciliation failure',
    blurb: 'The lines do not agree with the totals printed in the file. Nothing may post.',
  },
  duplicate_period: {
    title: 'Period already posted',
    blurb: 'Posting again would deplete the same stock twice.',
  },
  parse: { title: 'File could not be read', blurb: '' },
  unmapped: {
    title: 'Not mapped to a menu item',
    blurb:
      'Revenue is recorded in full. Stock will not move for these until each is mapped and given a recipe.',
  },
  generic: {
    title: 'Generic articles - can never be costed',
    blurb:
      'These name a class of product rather than a product, so no recipe can exist for them. Splitting them in the POS is the only fix.',
  },
  test: {
    title: 'Test articles, live in production',
    blurb: 'Priced around 0.1 birr and ringing up against real bills.',
  },
  free_comp: {
    title: 'Free and complimentary',
    blurb:
      'These consume real stock at no revenue. They deplete inventory and are excluded from sales.',
  },
  no_active_recipe: {
    title: 'Mapped, but no recipe yet',
    blurb: 'Revenue is recorded. Stock moves as soon as a recipe exists.',
  },
  no_store_mapping: {
    title: 'No store to deplete from',
    blurb: 'The POS export carries no outlet dimension, so each category needs a store mapping.',
  },
  duplicate_file: { title: 'Duplicate file', blurb: '' },
  voids_excluded: { title: 'Voids are not in this report', blurb: '' },
  service_charge: { title: 'Service charge', blurb: '' },
  tax_rounding: { title: 'Tax rounding', blurb: '' },
  multi_day_period: { title: 'Covers a date range', blurb: '' },
};

export default async function ImportDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Sales import" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const [im, issues, coverage, topUncosted, depleted] = await Promise.all([
    getImport(id),
    getImportIssues(id),
    getImportCoverage(id),
    getTopUncosted(id),
    getDepletedLines(id),
  ]);
  if (!im) notFound();

  const blocking = issues.filter((i) => i.severity === 'block');
  const warnings = issues.filter((i) => i.severity === 'warn');
  const infos = issues.filter((i) => i.severity === 'info');
  const posted = im.status === 'posted';
  const canPost = blocking.length === 0 && im.reconciled && im.status !== 'reversed';

  const blockedReason = !im.reconciled
    ? 'The file does not reconcile against its own footer subtotal.'
    : blocking.length
      ? blocking[0].message
      : im.status === 'reversed'
        ? 'This import has been reversed. Re-upload the file to post it again.'
        : null;

  const declared = im.declared_sub_total;
  const difference = declared ? dec(im.computed_sub_total).minus(dec(declared)) : null;

  let leakage: LeakageAnalysis | null = null;
  if (posted) {
    try {
      const d = await db();
      const stores = await listStores();
      const targetStore = stores.find((s) => s.kind === 'kitchen') ?? stores[0];
      if (targetStore) {
        const matrix = await getTheoreticalVsActualMatrix(
          d,
          tenant.id,
          targetStore.id,
          im.period_start,
          im.period_end,
        );
        leakage = detectCostLeakage(matrix);
      }
    } catch {
      // In case period has no stock counts yet
    }
  }

  const group = (list: typeof issues) => {
    const m = new Map<string, typeof issues>();
    for (const i of list) {
      if (!m.has(i.kind)) m.set(i.kind, []);
      m.get(i.kind)!.push(i);
    }
    return [...m.entries()];
  };

  return (
    <>
      <PageHeader
        title={`${longDate(im.period_start)} – ${longDate(im.period_end)}`}
        subtitle={
          <>
            {im.branch_name} · {im.filename} · depletion posts against{' '}
            <strong className="text-ink-700">{longDate(im.business_date)}</strong>
          </>
        }
        right={
          <Link
            href="/import"
            className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200 whitespace-nowrap"
          >
            ← All imports
          </Link>
        }
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {/* ---------------------------------------------------- reconciliation */}
        <Card
          title="Reconciliation"
          hint="Do the lines add up to the totals printed in the file?"
          right={
            im.reconciled ? (
              <Badge tone="good">✓ Reconciles exactly</Badge>
            ) : (
              <Badge tone="block">✕ Does not reconcile</Badge>
            )
          }
        >
          <div
            className={`grid grid-cols-4 divide-x divide-ink-100 ${
              im.reconciled ? '' : 'bg-rose-50/40'
            }`}
          >
            <Stat label="Lines read" value={coverage?.line_count ?? '0'} note="articles in the file" />
            <Stat
              label="Sum of lines"
              value={etb(im.computed_sub_total)}
              unit="ETB"
              note="every article row added up"
            />
            <Stat
              label="Footer sub total"
              value={etb(declared)}
              unit="ETB"
              note="as printed by CNET"
            />
            <Stat
              label="Difference"
              value={difference ? etb(difference) : '-'}
              tone={difference && difference.isZero() ? 'good' : 'bad'}
              note={
                difference && difference.isZero()
                  ? 'exact to the last decimal'
                  : 'the import cannot post'
              }
            />
          </div>

          <div className="border-t border-ink-100 px-5 py-3.5 grid grid-cols-4 gap-6 text-[12.5px]">
            <FooterFigure label="Add. charge" value={im.declared_add_charge} />
            <FooterFigure label="Discount" value={im.declared_discount} />
            <FooterFigure label="Total tax" value={im.declared_tax} />
            <FooterFigure label="Grand total" value={im.declared_grand_total} strong />
          </div>
        </Card>

        {/* --------------------------------------------------------- coverage */}
        {coverage && (
          <Card
            title="Cost coverage"
            hint="How much of this revenue the system can actually cost"
          >
            <div className="grid grid-cols-4 divide-x divide-ink-100">
              <Stat
                label="Revenue costed"
                value={pct(coverage.revenue_costed_pct)}
                tone="good"
                note={`${coverage.costed_line_count} of ${coverage.line_count} lines`}
              />
              <Stat label="Costed value" value={etb(coverage.revenue_costed)} unit="ETB" />
              <Stat
                label="Could not cost"
                value={etb(coverage.revenue_uncosted)}
                unit="ETB"
                tone="warn"
                note="revenue with no recipe behind it"
              />
              <Stat
                label="Revenue total"
                value={etb(coverage.revenue_total)}
                unit="ETB"
                note="free and comp articles excluded"
              />
            </div>
            <div className="px-5 pb-4">
              <div className="h-2 w-full rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: `${Math.min(100, Number(coverage.revenue_costed_pct ?? 0))}%` }}
                />
              </div>
              <p className="text-[12px] text-ink-500 mt-2.5 leading-snug">
                This figure is meant to start low and climb as recipes are written. It is the
                honest measure of how much of the business the system can see.
              </p>
            </div>
          </Card>
        )}

        {/* --------------------------------------------------------- blocking */}
        {blocking.length > 0 && (
          <Card title="Blocking problems" hint="These must be cleared before anything can post">
            {group(blocking).map(([kind, list]) => (
              <IssueGroup key={kind} kind={kind} list={list} severity="block" />
            ))}
          </Card>
        )}

        {/* ------------------------------------------------------------- post */}
        <Card title={posted ? 'Posted' : 'Post to stock'}>
          <PostButton
            importId={im.id}
            canPost={canPost}
            alreadyPosted={posted}
            blockedReason={blockedReason}
          />
        </Card>

        {/* ------------------------------------------------- what moved stock */}
        {depleted.length > 0 && (
          <Card
            title={posted ? 'Stock moved by this import' : 'Will move stock when posted'}
            hint={`${depleted.length} lines have a recipe behind them`}
          >
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <Th>Article</Th>
                  <Th>Menu item</Th>
                  <Th>Store</Th>
                  <Th right>Sold</Th>
                  <Th right>Revenue</Th>
                  <Th right>Ingredients</Th>
                  <Th right>Cost of stock</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {depleted.map((d) => (
                  <tr key={d.article_code} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-[12px] text-ink-500">{d.article_code}</span>
                      <div className="text-ink-800 dark:text-zinc-200">{d.article_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-600">{d.menu_item_name}</td>
                    <td className="px-3 py-2.5 text-ink-600">{d.store_name}</td>
                    <td className="px-3 py-2.5 text-right tnum">{qty(d.qty)}</td>
                    <td className="px-3 py-2.5 text-right tnum">{etb(d.total_amount)}</td>
                    <td className="px-3 py-2.5 text-right tnum text-ink-500">
                      {d.movement_count}
                    </td>
                    <td className="px-5 py-2.5 text-right tnum font-medium">
                      {posted ? etb(d.depletion_value) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* --------------------------------------------- biggest uncosted gaps */}
        {topUncosted.length > 0 && (
          <Card
            title="Biggest gaps"
            hint="The articles where writing a recipe would buy the most coverage"
          >
            <table className="w-full text-[13px]">
              <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                <tr className="text-left">
                  <Th>Article</Th>
                  <Th>Category</Th>
                  <Th right>Sold</Th>
                  <Th right>Revenue</Th>
                  <Th>Why it is not costed</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {topUncosted.map((u) => (
                  <tr key={u.article_code} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-[12px] text-ink-500">{u.article_code}</span>
                      <div className="text-ink-800 dark:text-zinc-200">{u.article_name.trim() || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-500">{u.pos_category}</td>
                    <td className="px-3 py-2.5 text-right tnum">{qty(u.qty)}</td>
                    <td className="px-3 py-2.5 text-right tnum font-medium">
                      {etb(u.total_amount)}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={u.article_flag === 'generic' ? 'block' : 'warn'}>
                        {u.uncosted_reason
                          ? (UNCOSTED_LABELS[u.uncosted_reason] ?? u.uncosted_reason)
                          : u.article_flag === 'generic'
                            ? 'Generic - cannot be costed'
                            : 'No recipe yet'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* --------------------------------------------------------- warnings */}
        {warnings.length > 0 && (
          <Card
            title="Warnings"
            hint="Recorded and reported. None of these stops the import posting."
          >
            {group(warnings).map(([kind, list]) => (
              <IssueGroup key={kind} kind={kind} list={list} severity="warn" />
            ))}
          </Card>
        )}

        {/* ------------------------------------------------------------ notes */}
        {infos.length > 0 && (
          <Card title="Notes on this file">
            <ul className="divide-y divide-ink-100">
              {infos.map((i, n) => (
                <li key={n} className="px-5 py-3 flex gap-3">
                  <span className="text-sky-500 text-[13px] leading-5 shrink-0">ℹ</span>
                  <p className="text-[13px] text-ink-600 leading-snug">{i.message}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ----------------- Materials Control Theoretical Reconciliation & Cost Leakage */}
        {posted && leakage && (
          <Card
            title="Materials Control Theoretical Reconciliation & Cost Leakage"
            hint="Soll-Ist-Vergleich · Actual consumption vs. Theoretical recipe sales depletions"
            right={
              leakage.alertCount > 0 ? (
                <Badge tone="block">{leakage.alertCount} High Leakage Alert{leakage.alertCount > 1 ? 's' : ''}</Badge>
              ) : leakage.reviewCount > 0 ? (
                <Badge tone="warn">{leakage.reviewCount} Need Review</Badge>
              ) : (
                <Badge tone="good">✓ Normal Variance</Badge>
              )
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ink-100 dark:divide-zinc-800 border-b border-ink-100 dark:border-zinc-800">
              <Stat
                label="Unexplained Leakage"
                value={etb(leakage.totalLeakageValue.toString())}
                unit="ETB"
                tone={leakage.totalLeakageValue.greaterThan(0) ? 'bad' : 'good'}
                note="capital lost beyond theoretical recipe consumption"
              />
              <Stat
                label="High Leakage Items"
                value={String(leakage.alertCount)}
                note="items with variance > 500 ETB and > 5%"
              />
              <Stat
                label="Review Items"
                value={String(leakage.reviewCount)}
                note="items requiring portion or waste audit"
              />
            </div>

            {leakage.topLeakageItems.length > 0 && (
              <div className="p-4 space-y-3">
                <span className="text-[12px] uppercase tracking-wider text-ink-500 font-semibold">
                  Top Unexplained Variance Articles
                </span>
                <table className="w-full text-[13px]">
                  <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                    <tr className="text-left">
                      <Th>Article</Th>
                      <Th>Category</Th>
                      <Th right>Variance Qty</Th>
                      <Th right>Loss Value</Th>
                      <Th>Probable Cause</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                    {leakage.topLeakageItems.map((item) => (
                      <tr key={item.itemCode} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                        <td className="px-5 py-2.5">
                          <span className="font-mono text-[12px] text-ink-500">{item.itemCode}</span>
                          <div className="font-medium text-ink-900 dark:text-zinc-100">{item.itemName}</div>
                        </td>
                        <td className="px-3 py-2.5 text-ink-500">{item.category}</td>
                        <td className="px-3 py-2.5 text-right tnum text-rose-600 font-medium">
                          +{qty(item.varianceQty.toString())}
                        </td>
                        <td className="px-3 py-2.5 text-right tnum text-rose-600 font-semibold">
                          {etb(item.varianceValue.toString())}
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge tone="warn">{item.probableCause.replace(/_/g, ' ')}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {leakage.recommendations.length > 0 && (
              <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 border-t border-amber-200/60 dark:border-amber-900/40 rounded-b-xl space-y-2">
                <span className="text-[11px] uppercase tracking-wider text-amber-800 dark:text-amber-300 font-semibold">
                  Cost Controller Action Items
                </span>
                <ul className="space-y-1.5 text-[12.5px] text-amber-900 dark:text-amber-200">
                  {leakage.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-600 shrink-0">→</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 first:pl-5 last:pr-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function FooterFigure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
        {label}
      </div>
      <div className={`tnum mt-0.5 ${strong ? 'font-semibold text-ink-900 dark:text-zinc-100' : 'text-ink-700'}`}>
        {etb(value)}
      </div>
    </div>
  );
}

function IssueGroup({
  kind,
  list,
  severity,
}: {
  kind: string;
  list: { article_code: string | null; message: string; qty: string | null; amount: string | null }[];
  severity: 'block' | 'warn';
}) {
  const meta = KIND_TITLES[kind] ?? { title: kind, blurb: '' };
  const total = list.reduce((s, i) => s.plus(dec(i.amount ?? 0)), dec(0));
  const totalQty = list.reduce((s, i) => s.plus(dec(i.qty ?? 0)), dec(0));
  const showTable = list.length > 1 && list.some((i) => i.article_code);

  return (
    <div className="border-b border-ink-100 last:border-b-0">
      <div className="px-5 py-3.5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={severity}>{list.length}</Badge>
            <h3 className="text-[13.5px] font-semibold text-ink-800 dark:text-zinc-200">{meta.title}</h3>
          </div>
          {meta.blurb && (
            <p className="text-[12.5px] text-ink-500 mt-1 leading-snug max-w-2xl">{meta.blurb}</p>
          )}
          {!showTable && (
            <ul className="mt-2 space-y-1">
              {list.map((i, n) => (
                <li key={n} className="text-[12.5px] text-ink-600 leading-snug">
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {showTable && (
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
              Combined
            </div>
            <div className="tnum text-[15px] font-semibold text-ink-800 dark:text-zinc-200">{etb(total)}</div>
            <div className="tnum text-[12px] text-ink-500">{qty(totalQty)} units</div>
          </div>
        )}
      </div>

      {showTable && (
        <div className="px-5 pb-4">
          <table className="w-full text-[12.5px] border border-ink-100 rounded-lg overflow-hidden">
            <tbody className="divide-y divide-ink-100">
              {list.slice(0, 40).map((i, n) => (
                <tr key={n} className="bg-white dark:bg-[#1c1c1c]">
                  <td className="px-3 py-1.5 font-mono text-[11.5px] text-ink-500 w-24">
                    {i.article_code}
                  </td>
                  <td className="px-3 py-1.5 text-ink-700">{i.message}</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-600 w-20">{qty(i.qty)}</td>
                  <td className="px-3 py-1.5 text-right tnum text-ink-800 dark:text-zinc-200 w-28">
                    {etb(i.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 40 && (
            <p className="text-[12px] text-ink-400 mt-2">
              and {list.length - 40} more of the same kind
            </p>
          )}
        </div>
      )}
    </div>
  );
}
