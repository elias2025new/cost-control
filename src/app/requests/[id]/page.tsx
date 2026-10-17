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
import { FulfillForm, CancelForm, ApproveForm } from './FulfillForm';
import { approveRequestAction } from '../actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'neutral' | 'info'; label: string }> = {
  requested: { tone: 'warn', label: 'Pending Dept Head Approval' },
  approved: { tone: 'info', label: 'Approved — Ready for Store Release' },
  fulfilled: { tone: 'good', label: 'Released / Fulfilled' },
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
  const canApprove =
    request.status === 'requested' &&
    (me.role === 'admin' || me.storeId === request.requesting_store_id);
  const canRelease =
    (request.status === 'approved' || (request.status === 'requested' && me.role === 'admin')) &&
    (me.role === 'admin' || me.storeId === request.fulfilling_store_id);
  const canCancel =
    (request.status === 'requested' || request.status === 'approved') &&
    (me.role === 'admin' || me.storeId === request.requesting_store_id);

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
          <div className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-4 py-3 text-[13px] text-ink-700 dark:text-zinc-300">
            {request.note}
          </div>
        )}

        {canApprove && (
          <Card title="Pre-Approval">
            <ApproveForm requestId={request.id} onApprove={approveRequestAction} />
          </Card>
        )}

        {request.status === 'requested' && !canApprove && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 text-[13px] text-amber-800 dark:text-amber-200">
            Waiting for the requesting store&rsquo;s Department Head (Chef or Bar Manager) to pre-approve before warehouse fulfillment.
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
          hint="Materials Control (MC) authorization lifecycle"
          right={<Badge tone={request.status === 'fulfilled' ? 'good' : request.status === 'approved' ? 'info' : 'warn'}>{st.label}</Badge>}
        >
          <ApprovalChain
            steps={[
              '1. Outlet requests (via Par or manual)',
              '2. Chef / Bar Manager pre-approves',
              '3. Storekeeper fulfills from warehouse',
            ]}
            caption={
              request.status === 'fulfilled'
                ? 'Request has been fully approved and released to the outlet store.'
                : request.status === 'approved'
                  ? 'Request pre-approved by Department Head. Awaiting Storekeeper release.'
                  : 'Awaiting Department Head pre-approval before stock can be released.'
            }
          />
        </Card>
      </div>
    </>
  );
}
