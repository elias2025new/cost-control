import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  PageHeader,
  Card,
  Badge,
  ApprovalChain,
  OnboardingNotice,
} from '../../../components/ui';
import { currentTenant, currentUser } from '../../../lib/queries';
import { getIssueRequest, getIssueRequestLines } from '../../../lib/masterData';
import { longDate } from '../../../lib/format';
import { FulfillForm, CancelForm } from './FulfillForm';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  requested: { tone: 'warn', label: 'Waiting to be released' },
  fulfilled: { tone: 'good', label: 'Released' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Stock request" />
        <OnboardingNotice />
      </>
    );
  }

  const me = await currentUser();
  if (!me) redirect('/login');

  const { id } = await params;
  const [request, lines] = await Promise.all([getIssueRequest(id), getIssueRequestLines(id)]);
  if (!request) notFound();

  // A store user may only see a request their own store is party to.
  const isParty =
    me.role === 'admin' ||
    me.storeId === request.requesting_store_id ||
    me.storeId === request.fulfilling_store_id;
  if (!isParty) redirect('/requests');

  const st = STATUS[request.status] ?? STATUS.requested;
  const isWaiting = request.status === 'requested';
  const canRelease =
    isWaiting && (me.role === 'admin' || me.storeId === request.fulfilling_store_id);
  const canCancel =
    isWaiting && (me.role === 'admin' || me.storeId === request.requesting_store_id);

  return (
    <>
      <PageHeader
        title={`${request.requesting_store} → ${request.fulfilling_store}`}
        subtitle={
          <>
            Asked {longDate(request.requested_at.slice(0, 10))}
            {request.requested_by ? ` by ${request.requested_by}` : ''}
            {request.fulfilled_at
              ? ` · released ${longDate(request.fulfilled_at.slice(0, 10))}${
                  request.fulfilled_by ? ` by ${request.fulfilled_by}` : ''
                }`
              : ''}
          </>
        }
        right={
          <div className="flex items-center gap-3">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Link href="/requests" className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200">
              ← All requests
            </Link>
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-5xl">
        {request.note && (
          <div className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-4 py-3 text-[13px] text-ink-700">
            {request.note}
          </div>
        )}

        <Card
          title="Items"
          hint={
            canRelease
              ? 'Enter what you are actually releasing, then release'
              : `${lines.length} line${lines.length === 1 ? '' : 's'}`
          }
        >
          <FulfillForm requestId={request.id} lines={lines} canRelease={canRelease} />
        </Card>

        {canCancel && (
          <Card title="Cancel">
            <CancelForm requestId={request.id} />
          </Card>
        )}

        <Card
          title="Approval routing"
          hint="From your written specification - shown, not built"
          right={<Badge tone="neutral">Not in this demo</Badge>}
        >
          <ApprovalChain
            steps={[
              'Outlet requests',
              'Restaurant Manager approves',
              'F&B Controller reviews',
              'Storekeeper releases',
              'Outlet receives',
            ]}
            caption="Your specification asks for three authorisation levels, and for the requester to separately approve and receive the transfer. How many levels are really wanted is still an open question, so this build keeps the two ends that are certain - a request is made, and the storekeeper releases the stock - and shows the rest here, inactive."
          />
        </Card>
      </div>
    </>
  );
}
