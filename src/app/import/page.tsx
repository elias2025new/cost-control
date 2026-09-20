import Link from 'next/link';
import { PageHeader, Card, Badge, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant, listImports } from '../../lib/queries';
import { etb, shortDate, pct } from '../../lib/format';
import { UploadForm } from './UploadForm';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'block' | 'neutral'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  validated: { tone: 'warn', label: 'Ready to post' },
  posted: { tone: 'good', label: 'Posted' },
  rejected: { tone: 'block', label: 'Blocked' },
  reversed: { tone: 'neutral', label: 'Reversed' },
};

export default async function ImportPage() {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Sales import" />
        <OnboardingNotice />
      </>
    );
  }

  const imports = await listImports();

  return (
    <>
      <PageHeader
        title="Sales import"
        subtitle="Read a CNET sales export, check it against its own totals, then post it. Posting moves stock automatically through the recipes."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        <Card title="Upload a sales export" hint="CNET · Categorized And Summarized By Article">
          <UploadForm />
        </Card>

        <Card title="Imports" hint={`${imports.length} file${imports.length === 1 ? '' : 's'}`}>
          {imports.length === 0 ? (
            <Empty>
              Nothing imported yet. Upload{' '}
              <code className="text-ink-600 bg-ink-100 px-1 py-0.5 rounded text-[12px]">
                reference/cnet_sales_export.xlsx
              </code>{' '}
              to begin.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                  <tr className="text-left">
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Period
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Lines
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Net sales
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right">
                      Costed
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Checks
                    </th>
                    <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {imports.map((im) => {
                    const st = STATUS[im.status] ?? STATUS.draft;
                    return (
                      <tr key={im.id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                        <td className="px-5 py-3">
                          <Link
                            href={`/import/${im.id}`}
                            className="font-medium text-ink-900 dark:text-zinc-100 hover:text-brand-700"
                          >
                            {shortDate(im.period_start)}
                            {im.period_start !== im.period_end && (
                              <> – {shortDate(im.period_end)}</>
                            )}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-ink-500 truncate max-w-[200px]">
                          {im.filename}
                        </td>
                        <td className="px-3 py-3 text-right tnum text-ink-700">{im.line_count}</td>
                        <td className="px-3 py-3 text-right tnum text-ink-900 dark:text-zinc-100 font-medium">
                          {etb(im.computed_sub_total)}
                        </td>
                        <td className="px-3 py-3 text-right tnum text-ink-700">
                          {im.revenue_costed_pct ? pct(im.revenue_costed_pct) : '-'}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            {im.reconciled ? (
                              <Badge tone="good">Reconciles</Badge>
                            ) : (
                              <Badge tone="block">Does not reconcile</Badge>
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
