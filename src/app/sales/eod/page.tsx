import Link from 'next/link';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../../components/ui';
import { currentTenant, listImports } from '../../../lib/queries';
import { etb, shortDate, pct } from '../../../lib/format';
import { UploadForm } from '../../import/UploadForm';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'block' | 'neutral'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  validated: { tone: 'warn', label: 'Ready to post' },
  posted: { tone: 'good', label: 'Posted' },
  rejected: { tone: 'block', label: 'Blocked' },
  reversed: { tone: 'neutral', label: 'Reversed' },
};

export default async function SalesEodPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="End-of-Day Sales Depletion (/sales/eod)" />
        <OnboardingNotice />
      </>
    );
  }

  const imports = await listImports();

  return (
    <>
      <PageHeader
        title="End-of-Day CNet Sales Upload & Reconciliation"
        subtitle="Upload daily CNet POS export, verify line sums against footer control totals, and explode recipes for theoretical inventory depletion."
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/reports/cost-control"
              className="px-3.5 py-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 text-[12.5px] font-medium hover:bg-brand-100"
            >
              Executive Cost Dashboard →
            </Link>
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card
          title="Daily CNet POS Upload Gate"
          hint="Drop daily cnet_sales_export.xlsx · Categorized And Summarized By Article"
        >
          <UploadForm />
        </Card>

        <Card title="EOD Trading Periods & Reconciliation Batches" hint={`${imports.length} period${imports.length === 1 ? '' : 's'}`}>
          {imports.length === 0 ? (
            <Empty>
              No sales batches uploaded yet. Drag and drop a daily CNet sales export file above to begin.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                  <tr className="text-left">
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Business Date
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Filename
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Lines
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Net Sales
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Cost Coverage
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Reconciliation Gate
                    </th>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                  {imports.map((im) => {
                    const st = STATUS[im.status] ?? STATUS.draft;
                    return (
                      <tr key={im.id} className="hover:bg-ink-50 dark:hover:bg-zinc-800/50">
                        <td className="px-5 py-3">
                          <Link
                            href={`/import/${im.id}`}
                            className="font-medium text-ink-900 dark:text-zinc-100 hover:text-brand-600 underline-offset-2 hover:underline"
                          >
                            {shortDate(im.period_start)}
                            {im.period_start !== im.period_end && (
                              <> – {shortDate(im.period_end)}</>
                            )}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-ink-500 dark:text-zinc-400 truncate max-w-[200px]">
                          {im.filename}
                        </td>
                        <td className="px-3 py-3 text-right tnum text-ink-700 dark:text-zinc-300">
                          {im.line_count}
                        </td>
                        <td className="px-3 py-3 text-right tnum text-ink-900 dark:text-zinc-100 font-medium">
                          {etb(im.computed_sub_total)}
                        </td>
                        <td className="px-3 py-3 text-right tnum text-ink-700 dark:text-zinc-300">
                          {im.revenue_costed_pct ? pct(im.revenue_costed_pct) : '-'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            {im.reconciled ? (
                              <Badge tone="good">✓ Reconciled</Badge>
                            ) : (
                              <Badge tone="block">✕ Mismatch</Badge>
                            )}
                            {Number(im.blocking) > 0 && (
                              <Badge tone="block">{im.blocking} blocking</Badge>
                            )}
                            {Number(im.warnings) > 0 && (
                              <Badge tone="warn">{im.warnings} warnings</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
