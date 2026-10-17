import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, Badge, Empty, Stat } from '../../../../components/ui';
import { db } from '../../../../lib/server-db';
import { requireTenant, requireUser } from '../../../../lib/queries';
import { etb, qty } from '../../../../lib/format';
import { dec } from '../../../../lib/money';
import { addSupplierPriceAction, deleteSupplierPriceAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SupplierPriceBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== 'admin' && !user.permissions?.includes('po_create')) {
    redirect('/ledger');
  }

  const tenant = await requireTenant();
  const { id: supplierId } = await params;
  const database = await db();

  const [supplierRes, pricesRes, itemsRes] = await Promise.all([
    database.query<{
      id: string;
      code: string;
      name: string;
      contact: string | null;
      is_active: boolean;
    }>(
      `select id, code, name, contact, is_active
         from suppliers
        where id = $1 and tenant_id = $2`,
      [supplierId, tenant.id],
    ),
    database.query<{
      id: string;
      item_id: string;
      supplier_item_code: string | null;
      purchase_uom: string;
      pack_factor: string;
      contract_price: string;
      tax_rate: string;
      min_order_qty: string;
      lead_time_days: number;
      is_preferred: boolean;
      item_code: string;
      item_name: string;
      inventory_uom: string;
    }>(
      `select sip.id, sip.item_id, sip.supplier_item_code, sip.purchase_uom,
              sip.pack_factor::text, sip.contract_price::text, sip.tax_rate::text,
              sip.min_order_qty::text, sip.lead_time_days, sip.is_preferred,
              i.code as item_code, i.name as item_name, i.uom as inventory_uom
         from supplier_item_prices sip
         join items i on i.id = sip.item_id
        where sip.tenant_id = $1 and sip.supplier_id = $2
        order by i.name`,
      [tenant.id, supplierId],
    ),
    database.query<{ id: string; code: string; name: string; uom: string }>(
      `select id, code, name, uom from items where tenant_id = $1 and is_active order by name`,
      [tenant.id],
    ),
  ]);

  if (!supplierRes.rows.length) notFound();
  const supplier = supplierRes.rows[0];
  const prices = pricesRes.rows;
  const availableItems = itemsRes.rows;

  return (
    <>
      <PageHeader
        title={`${supplier.name} · Contract Price Book`}
        subtitle={`Supplier Code: ${supplier.code} · Contact: ${supplier.contact || 'No phone/email specified'} · ${prices.length} contracted article(s)`}
        right={
          <div className="flex items-center gap-3">
            <Link
              href="/setup/suppliers"
              className="text-[13px] text-ink-500 hover:text-ink-800 dark:text-zinc-200"
            >
              ← Back to Suppliers
            </Link>
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-6xl">
        {/* Add New Contracted Item Card */}
        <Card
          title="Add or Update Contracted Article"
          hint="Specify Addis Ababa supplier pricing, packaging pack factor, and replenishment parameters"
        >
          <form action={addSupplierPriceAction} className="p-5 space-y-4 text-[13px]">
            <input type="hidden" name="supplierId" value={supplier.id} />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Inventory Article
                </label>
                <select
                  name="itemId"
                  required
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-ink-900 dark:text-zinc-100 focus:outline-none"
                >
                  {availableItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.code}) · Inv Unit: {it.uom}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Packaging Unit (e.g. Bag, Crate)
                </label>
                <input
                  name="purchaseUom"
                  type="text"
                  placeholder="e.g., Crate, Bag, Carton"
                  required
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 font-medium text-ink-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Pack Conversion Factor
                </label>
                <input
                  name="packFactor"
                  type="number"
                  step="0.001"
                  min="0.001"
                  defaultValue="1"
                  required
                  placeholder="e.g., 24 for 24-btl crate, 50 for 50kg bag"
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Contract Price per Pack (ETB)
                </label>
                <input
                  name="contractPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Min Order Qty (MOQ in Packs)
                </label>
                <input
                  name="minOrderQty"
                  type="number"
                  step="0.1"
                  min="0.1"
                  defaultValue="1.0"
                  required
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ink-600 dark:text-zinc-400 uppercase tracking-wider mb-1">
                  Delivery Lead Time (Days)
                </label>
                <input
                  name="leadTimeDays"
                  type="number"
                  min="0"
                  defaultValue="1"
                  required
                  className="w-full rounded-lg border border-ink-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 font-mono text-ink-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="isPreferred"
                    defaultChecked={true}
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                  />
                  <span className="font-semibold text-ink-800 dark:text-zinc-200 text-[12.5px]">
                    ★ Preferred Supplier for this item
                  </span>
                </label>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-ink-900 dark:bg-zinc-100 text-white dark:text-ink-900 px-4 py-2 font-medium text-[13px] hover:bg-ink-800 cursor-pointer"
              >
                + Add / Update in Price Catalog
              </button>
            </div>
          </form>
        </Card>

        {/* Existing Price Catalog Table */}
        <Card title="Contracted Articles & Packaging Catalog" hint={`${prices.length} contracted price rows`}>
          {prices.length === 0 ? (
            <Empty>
              No items contracted with this supplier yet. Use the form above to add pricing and packaging units.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-ink-50 dark:bg-[#111111] text-ink-500 border-b border-ink-200 dark:border-zinc-800">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Item</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider">Packaging Unit</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Pack Factor</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Contract Price</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Effective Unit Cost</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">MOQ</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-right">Lead Time</th>
                    <th className="px-3 py-3 font-semibold text-[11px] uppercase tracking-wider text-center">Preferred</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-zinc-800">
                  {prices.map((p) => {
                    const packFactor = dec(p.pack_factor);
                    const contractPrice = dec(p.contract_price);
                    const unitCost = packFactor.greaterThan(0) ? contractPrice.div(packFactor) : contractPrice;

                    return (
                      <tr key={p.id} className="hover:bg-ink-50 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-900 dark:text-zinc-100">{p.item_name}</div>
                          <div className="font-mono text-[11px] text-ink-400">
                            {p.item_code} · Base: {p.inventory_uom}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-medium text-ink-800 dark:text-zinc-200">
                          {p.purchase_uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-700 dark:text-zinc-300">
                          {qty(p.pack_factor)} {p.inventory_uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-ink-900 dark:text-zinc-100">
                          {etb(p.contract_price)} ETB
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-brand-700 dark:text-brand-300 font-semibold">
                          {etb(unitCost)} /{p.inventory_uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                          {qty(p.min_order_qty)} {p.purchase_uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-ink-600 dark:text-zinc-400">
                          {p.lead_time_days} day{p.lead_time_days === 1 ? '' : 's'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {p.is_preferred ? (
                            <Badge tone="good">★ Preferred</Badge>
                          ) : (
                            <span className="text-ink-400 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <form action={deleteSupplierPriceAction}>
                            <input type="hidden" name="priceId" value={p.id} />
                            <input type="hidden" name="supplierId" value={supplier.id} />
                            <button
                              type="submit"
                              className="text-[12px] text-ink-400 hover:text-rose-600 font-medium cursor-pointer"
                            >
                              Remove
                            </button>
                          </form>
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
