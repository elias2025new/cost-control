import Link from 'next/link';
import { PageHeader, Card, Stat, Badge, Empty, OnboardingNotice } from '../../components/ui';
import {
  currentTenant,
  currentUser,
  listStores,
  listItemsInStore,
  getLedger,
  getStockSummary,
} from '../../lib/queries';
import { etb, qty, shortDate, MOVEMENT_LABELS } from '../../lib/format';
import { dec } from '../../lib/money';

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  receipt: 'text-brand-700',
  issue_in: 'text-brand-700',
  transfer_in: 'text-brand-700',
  opening: 'text-ink-600',
  sale_depletion: 'text-rose-700',
  issue_out: 'text-rose-700',
  transfer_out: 'text-rose-700',
  wastage: 'text-rose-700',
  comp: 'text-rose-700',
  staff_meal: 'text-rose-700',
  reversal: 'text-violet-700',
  count_adjustment: 'text-amber-700',
};

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; item?: string }>;
}) {
  const tenant = await currentTenant();
  if (!tenant) {
    return (
      <>
        <PageHeader title="Stock ledger" />
        <OnboardingNotice />
      </>
    );
  }

  const me = await currentUser();
  const sp = await searchParams;
  const allStores = await listStores();
  // A store user sees only their own store - filtered here at the call
  // site so listStores() stays reusable for the admin views.
  const stores =
    me && me.role !== 'admin' ? allStores.filter((s) => s.id === me.storeId) : allStores;

  if (stores.length === 0) {
    return (
      <>
        <PageHeader title="Stock ledger" />
        <div className="p-8">
          <Card>
            <Empty>
              No stores yet.{' '}
              <Link href="/setup/stores" className="text-brand-700 hover:underline">
                Set one up
              </Link>
              .
            </Empty>
          </Card>
        </div>
      </>
    );
  }

  const storeId = sp.store && stores.some((s) => s.id === sp.store) ? sp.store : stores[0].id;
  const items = await listItemsInStore(storeId);
  const itemId = sp.item && items.some((i) => i.id === sp.item) ? sp.item : items[0]?.id;

  const [rows, summary] = itemId
    ? await Promise.all([getLedger(storeId, itemId), getStockSummary(storeId, itemId)])
    : [[], null];

  const store = stores.find((s) => s.id === storeId)!;
  const item = items.find((i) => i.id === itemId);

  return (
    <>
      <PageHeader
        title="Stock ledger"
        subtitle="Every movement, in order, with the running balance. Nothing here is ever edited or deleted - a correction is a reversing entry."
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {/* pickers */}
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
              Store
            </div>
            <div className="flex gap-1.5">
              {stores.map((s) => (
                <Link
                  key={s.id}
                  href={`/ledger?store=${s.id}`}
                  className={[
                    'rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                    s.id === storeId
                      ? 'border-ink-900 bg-ink-900 text-white font-medium'
                      : 'border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] text-ink-600 hover:border-ink-300',
                  ].join(' ')}
                >
                  {s.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-[280px]">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5">
              Item · {items.length} with movements in {store.name}
            </div>
            <ItemPicker storeId={storeId} items={items} selected={itemId} />
          </div>
        </div>

        {!item ? (
          <Card>
            <Empty>Nothing has moved in {store.name} yet.</Empty>
          </Card>
        ) : (
          <>
            <Card
              title={`${item.name} · ${store.name}`}
              hint={`${item.code} · measured in ${item.uom}`}
              right={
                summary?.reorder_status && (
                  <Badge
                    tone={
                      summary.reorder_status === 'REORDER NOW'
                        ? 'block'
                        : summary.reorder_status === 'OVERSTOCK'
                          ? 'warn'
                          : 'good'
                    }
                  >
                    {summary.reorder_status}
                  </Badge>
                )
              }
            >
              <div className="grid grid-cols-4 divide-x divide-ink-100">
                <Stat
                  label="On hand"
                  value={qty(summary?.qty_on_hand)}
                  unit={item.uom}
                  note="sum of every movement - never a stored figure"
                />
                <Stat
                  label="Weighted average cost"
                  value={etb(summary?.avg_unit_cost)}
                  unit={`ETB / ${item.uom}`}
                  note="moves only when stock is received"
                />
                <Stat label="Stock value" value={etb(summary?.value_on_hand)} unit="ETB" />
                <Stat
                  label="Par levels"
                  value={
                    summary?.min_qty
                      ? `${qty(summary.min_qty)} – ${qty(summary.max_qty)}`
                      : '-'
                  }
                  note={summary?.min_qty ? 'minimum – maximum' : 'not set for this item'}
                />
              </div>
            </Card>

            <Card title="Movements" hint={`${rows.length} entries, oldest first`}>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto sticky-head">
                <table className="w-full text-[13px]">
                  <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500">
                    <tr className="text-left">
                      <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                        Date
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                        Movement
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider bg-ink-50 dark:bg-[#111111]">
                        Source
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                        In / out
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                        Unit cost
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                        Value
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                        Balance
                      </th>
                      <th className="px-5 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right bg-ink-50 dark:bg-[#111111]">
                        Balance value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {rows.map((r) => {
                      const inbound = dec(r.qty_delta).greaterThan(0);
                      return (
                        <tr key={r.movement_id} className="hover:bg-ink-50 dark:bg-[#111111]/60">
                          <td className="px-5 py-2.5 text-ink-600 whitespace-nowrap">
                            {shortDate(r.occurred_on)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`font-medium ${TONE[r.movement_type] ?? 'text-ink-700'}`}
                            >
                              {MOVEMENT_LABELS[r.movement_type] ?? r.movement_type}
                            </span>
                            {r.reversal_of_id && (
                              <span className="ml-1.5">
                                <Badge tone="neutral">reverses an entry</Badge>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-ink-500 max-w-[280px] truncate">
                            {r.note ?? r.source_doc_type}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right tnum font-medium ${
                              inbound ? 'text-brand-700' : 'text-rose-700'
                            }`}
                          >
                            {inbound ? '+' : ''}
                            {qty(r.qty_delta)}
                          </td>
                          <td className="px-3 py-2.5 text-right tnum text-ink-600">
                            {etb(r.unit_cost)}
                          </td>
                          <td className="px-3 py-2.5 text-right tnum text-ink-600">
                            {etb(r.value_delta)}
                          </td>
                          <td className="px-3 py-2.5 text-right tnum font-semibold text-ink-900 dark:text-zinc-100">
                            {qty(r.running_qty)}
                          </td>
                          <td className="px-5 py-2.5 text-right tnum text-ink-700">
                            {etb(r.running_value)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function ItemPicker({
  storeId,
  items,
  selected,
}: {
  storeId: string;
  items: { id: string; code: string; name: string; uom: string; qty_on_hand: string | null }[];
  selected?: string;
}) {
  return (
    <form action="/ledger" method="get" className="flex gap-2">
      <input type="hidden" name="store" value={storeId} />
      <select
        name="item"
        defaultValue={selected}
        className="flex-1 rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3 py-1.5 text-[13px] text-ink-800 dark:text-zinc-200"
      >
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} ({i.code}) - {qty(i.qty_on_hand)} {i.uom} on hand
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-[#1c1c1c] px-3.5 py-1.5 text-[13px] font-medium text-ink-700 hover:border-ink-300"
      >
        Show
      </button>
    </form>
  );
}
