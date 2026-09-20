import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Stat, OnboardingNotice } from '../../../components/ui';
import { currentTenant, currentUser } from '../../../lib/queries';
import { getCount, getCountLines } from '../../../lib/reports';
import { etb, longDate } from '../../../lib/format';
import { dec } from '../../../lib/money';
import { CountSheet } from './CountSheet';

export const dynamic = 'force-dynamic';

export default async function CountDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Physical count" />
        <OnboardingNotice />
      </>
    );
  }

  const { id } = await params;
  const [count, lines, me] = await Promise.all([getCount(id), getCountLines(id), currentUser()]);
  if (!count) notFound();
  // A store user must not open another store's sheet by guessing the URL.
  if (me && me.role !== 'admin' && count.store_id !== me.storeId) redirect('/counts');

  const posted = count.status === 'posted';
  const counted = lines.filter((l) => l.counted_qty !== null);
  const investigate = counted.filter((l) => l.variance_status === 'INVESTIGATE');
  const review = counted.filter((l) => l.variance_status === 'REVIEW');
  const netValue = counted.reduce((s, l) => s.plus(dec(l.variance_value)), dec(0));

  return (
    <>
      <PageHeader
        title={`${count.store_name} · ${longDate(count.count_date)}`}
        subtitle={
          posted
            ? `Posted. The sheet is frozen - a correction would be a new count, not an edit.`
            : `Enter what is physically on the shelf. Nothing moves until you post.`
        }
        right={
          <div className="flex items-center gap-3">
            <Badge tone={posted ? 'good' : 'neutral'}>{posted ? 'Posted' : 'Draft'}</Badge>
            <Link href="/counts" className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200">
              ← All counts
            </Link>
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {posted && (
          <Card>
            <div className="grid grid-cols-4 divide-x divide-ink-100">
              <Stat label="Lines counted" value={`${counted.length} / ${lines.length}`} />
              <Stat
                label="Net variance"
                value={etb(netValue)}
                unit="ETB"
                tone={netValue.isNegative() ? 'bad' : netValue.isZero() ? 'good' : 'warn'}
                note={netValue.isNegative() ? 'stock is short of the books' : undefined}
              />
              <Stat
                label="Investigate"
                value={investigate.length}
                tone={investigate.length ? 'bad' : 'good'}
                note="beyond 8%"
              />
              <Stat
                label="Review"
                value={review.length}
                tone={review.length ? 'warn' : 'good'}
                note="between 3% and 8%"
              />
            </div>
            {counted.length > 0 && (
              <div className="border-t border-ink-100 px-5 py-3">
                <Link
                  href={`/variance?count=${count.id}`}
                  className="text-[13px] text-brand-700 hover:underline"
                >
                  Open the variance report for this count →
                </Link>
              </div>
            )}
          </Card>
        )}

        <Card
          title="Count sheet"
          hint={
            count.counted_by
              ? `${lines.length} items · counted by ${count.counted_by}`
              : `${lines.length} items`
          }
        >
          <CountSheet countId={count.id} lines={lines} readOnly={posted} />
        </Card>
      </div>
    </>
  );
}
