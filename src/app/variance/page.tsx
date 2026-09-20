import Link from 'next/link';
import { PageHeader, Card, Stat, Badge, Empty, OnboardingNotice } from '../../components/ui';
import { currentTenant } from '../../lib/queries';
import { varianceRows, postedCounts } from '../../lib/reports';
import { etb, qty, pct, shortDate } from '../../lib/format';
import { dec } from '../../lib/money';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'block'; label: string }> = {
  OK: { tone: 'good', label: 'OK' },
  REVIEW: { tone: 'warn', label: 'REVIEW' },
  INVESTIGATE: { tone: 'block', label: 'INVESTIGATE' },
};

export default async function VariancePage({
  searchParams,
}: {
  searchParams: Promise<{ count?: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Inventory variance" />
        <OnboardingNotice />
      </>
    );
  }

  const sp = await searchParams;
  const counts = await postedCounts();
  const selected = sp.count && counts.some((c) => c.id === sp.count) ? sp.count : undefined;
  const rows = await varianceRows(selected);

  const investigate = rows.filter((r) => r.variance_status === 'INVESTIGATE');
  const review = rows.filter((r) => r.variance_status === 'REVIEW');
  const ok = rows.filter((r) => r.variance_status === 'OK');

  const netValue = rows.reduce((s, r) => s.plus(dec(r.variance_value)), dec(0));
  const shrinkage = rows
    .filter((r) => dec(r.variance_value).isNegative())
    .reduce((s, r) => s.plus(dec(r.variance_value)), dec(0));
  const overage = rows
    .filter((r) => dec(r.variance_value).greaterThan(0))
    .reduce((s, r) => s.plus(dec(r.variance_value)), dec(0));

  return (
    <>
      <PageHeader
        title="Inventory variance"
        subtitle="What the ledger says should be on the shelf, against what was counted. Worst money difference first."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {counts.length === 0 ? (
          <Card>
            <Empty>
              No posted counts yet. <Link href="/counts" className="text-brand-700 hover:underline">Enter a physical count</Link>{' '}
              first - variance is the difference between the books and a count, so it needs both.
            </Empty>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
                  Count
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Link
                    href="/variance"
                    className={[
                      'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                      !selected
                        ? 'border-ink-900 bg-ink-900 text-white font-medium'
                        : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-600 hover:border-ink-300',
                    ].join(' ')}
                  >
                    All counts
                  </Link>
                  {counts.map((c) => (
                    <Link
                      key={c.id}
                      href={`/variance?count=${c.id}`}
                      className={[
                        'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                        c.id === selected
                          ? 'border-ink-900 bg-ink-900 text-white font-medium'
                          : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-600 hover:border-ink-300',
                      ].join(' ')}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            <Card>
              <div className="grid grid-cols-5 divide-x divide-ink-100">
                <Stat
                  label="Net variance"
                  value={etb(netValue)}
                  unit="ETB"
                  tone={netValue.isNegative() ? 'bad' : 'good'}
                  note={netValue.isNegative() ? 'short against the books' : 'over the books'}
                />
                <Stat label="Shrinkage" value={etb(shrinkage)} unit="ETB" tone="bad" />
                <Stat label="Overage" value={etb(overage)} unit="ETB" tone="neutral" />
                <Stat
                  label="Investigate"
                  value={investigate.length}
                  tone={investigate.length ? 'bad' : 'good'}
                  note="variance beyond 8%"
                />
                <Stat
                  label="Review"
                  value={review.length}
                  tone={review.length ? 'warn' : 'good'}
                  note="between 3% and 8%"
                />
              </div>
              <div className="border-t border-ink-100 px-5 py-3 text-[12px] text-ink-500">
                {ok.length} line{ok.length === 1 ? '' : 's'} within the 3% tolerance and not shown
                as a problem. Thresholds: within 3% is OK, within 8% is REVIEW, beyond that is
                INVESTIGATE.
              </div>
            </Card>

            <Card
              title="By item, worst first"
              hint={`${rows.length} counted line${rows.length === 1 ? '' : 's'}`}
            >
              {rows.length === 0 ? (
                <Empty>Nothing counted on this sheet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                      <tr className="text-left">
                        <Th>Item</Th>
                        {!selected && <Th>Store</Th>}
                        <Th right>Theoretical</Th>
                        <Th right>Counted</Th>
                        <Th right>Variance</Th>
                        <Th right>%</Th>
                        <Th right>Value</Th>
                        <Th>Status</Th>
                        <Th>Reason given</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {rows.map((r) => {
                        const v = dec(r.variance_qty);
                        const value = dec(r.variance_value);
                        const st = STATUS[r.variance_status] ?? STATUS.OK;
                        return (
                          <tr
                            key={`${r.stock_count_id}-${r.item_code}`}
                            className={
                              r.variance_status === 'INVESTIGATE'
                                ? 'bg-rose-50/40 hover:bg-rose-50/70'
                                : 'hover:bg-ink-50 dark:bg-[#111111]/60'
                            }
                          >
                            <td className="px-5 py-2.5">
                              <div className="text-ink-800 dark:text-zinc-200">{r.item_name}</div>
                              <div className="font-mono text-[11px] text-ink-400">
                                {r.item_code} · {r.uom}
                              </div>
                            </td>
                            {!selected && (
                              <td className="px-3 py-2.5 text-ink-500">
                                {r.store_name}
                                <div className="text-[11px] text-ink-400">
                                  {shortDate(r.count_date)}
                                </div>
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-right tnum text-ink-600">
                              {qty(r.theoretical_qty)}
                            </td>
                            <td className="px-3 py-2.5 text-right tnum text-ink-800 dark:text-zinc-200">
                              {qty(r.counted_qty)}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right tnum font-medium ${
                                v.isZero()
                                  ? 'text-ink-500'
                                  : v.isNegative()
                                    ? 'text-rose-700'
                                    : 'text-brand-700'
                              }`}
                            >
                              {v.greaterThan(0) ? '+' : ''}
                              {qty(v)}
                            </td>
                            <td className="px-3 py-2.5 text-right tnum text-ink-500">
                              {r.variance_ratio
                                ? pct(dec(r.variance_ratio).times(100), 1)
                                : '-'}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right tnum font-semibold ${
                                value.isNegative() ? 'text-rose-700' : 'text-ink-900 dark:text-zinc-100'
                              }`}
                            >
                              {etb(value)}
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge tone={st.tone}>{st.label}</Badge>
                            </td>
                            <td className="px-5 py-2.5 text-ink-500 max-w-[220px]">
                              {r.note ?? (
                                <span className="text-ink-300">
                                  {r.variance_status === 'OK' ? '' : 'no reason given'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="The other variance check" hint="Not the same question">
              <div className="px-5 py-4 text-[13px] text-ink-600 leading-relaxed max-w-3xl">
                <p>
                  This page compares <strong className="text-ink-800 dark:text-zinc-200">book stock against a
                  physical count</strong>. It catches theft and miscounting.
                </p>
                <p className="mt-2">
                  There is a second check the system keeps separately -{' '}
                  <strong className="text-ink-800 dark:text-zinc-200">theoretical consumption</strong>, which compares
                  what the recipes say should have been used against what the store actually
                  issued. That one catches recipe drift and over-portioning. They answer different
                  questions and are deliberately never merged.
                </p>
                <p className="mt-2 text-ink-500">
                  The engine computes it today (<code className="bg-ink-100 px-1 rounded text-[12px]">v_theoretical_consumption</code>); it has no screen yet.
                </p>
              </div>
            </Card>
          </>
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
