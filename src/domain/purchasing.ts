/**
 * Purchasing, Auto-PO from Par, and 3-Way Matching Engine
 *
 * Re-engineers Oracle Hospitality Materials Control (HMC):
 * - Supplier Price Catalogs (LIEFERART)
 * - Purchase Orders (BESTELLUNG & BESTPOS)
 * - Auto-Ordering from Par Levels (OrderCalculation.cs - PAR method with RoundUp)
 * - 3-Way Matching: Purchase Order vs. Goods Receiving Note (GRN) vs. Supplier Invoice (LIEFSCH)
 */

import type { Database, Tx } from '../lib/db';
import { Decimal, dec, moneyParam, qtyParam } from '../lib/money';

export class PurchasingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PO_NOT_FOUND'
      | 'PO_LINE_NOT_FOUND'
      | 'INVALID_STATUS'
      | 'ALREADY_APPROVED'
      | 'ALREADY_COMPLETED'
      | 'VARIANCE_FLAGGED'
      | 'TOLERANCE_EXCEEDED'
      | 'NOT_AUTHORISED',
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PurchasingError';
  }
}

export type POStatus = 'draft' | 'approved' | 'sent' | 'partially_received' | 'completed' | 'cancelled';
export type POLineStatus = 'open' | 'partial' | 'received' | 'cancelled';
export type MatchStatus = 'unmatched' | 'matched' | 'variance_flagged' | 'variance_approved';
export type LineVarianceStatus = 'ok' | 'price_mismatch' | 'over_delivery' | 'under_delivery' | 'approved';

export interface ParOrderSuggestion {
  itemId: string;
  itemCode: string;
  itemName: string;
  inventoryUom: string;
  purchaseUom: string;
  packFactor: Decimal;
  supplierId: string | null;
  supplierName: string | null;
  contractPrice: Decimal;
  minQty: Decimal;
  maxQty: Decimal;
  qtyOnHand: Decimal;
  pendingOrderedQty: Decimal;
  suggestedPackQty: Decimal;
  suggestedInvQty: Decimal;
  estimatedCost: Decimal;
}

export interface POLineInput {
  itemId: string;
  orderUom: string;
  orderedPackQty: number | string | Decimal;
  packFactor: number | string | Decimal;
  unitPrice: number | string | Decimal; // Price per pack
}

export interface ReceivingLineInput {
  poLineId?: string;
  itemId: string;
  receivedQty: number | string | Decimal; // in inventory UOM
  unitCost: number | string | Decimal;    // per inventory unit
  invoicedQty?: number | string | Decimal;
  invoicedUnitCost?: number | string | Decimal;
}

export interface ThreeWayMatchResult {
  purchaseId: string;
  matchStatus: MatchStatus;
  totalOrderedCost: Decimal;
  totalActualCost: Decimal;
  totalVariance: Decimal;
  flaggedLines: number;
  lines: Array<{
    lineId: string;
    itemId: string;
    orderedQty: Decimal;
    orderedUnitCost: Decimal;
    receivedQty: Decimal;
    actualUnitCost: Decimal;
    priceVariance: Decimal;
    qtyVariance: Decimal;
    varianceStatus: LineVarianceStatus;
  }>;
}

/**
 * 1. Calculate Par Order Suggestions (HMC OrderCalculation.cs - PAR method)
 * Returns items whose (Stock On Hand + Pending On Order) <= Min Qty
 * Rounds order quantity UP to nearest whole purchase pack size.
 */
export async function getParOrderSuggestions(
  db: Database,
  tenantId: string,
  storeId: string,
): Promise<ParOrderSuggestion[]> {
  const { rows } = await db.query<{
    item_id: string;
    item_code: string;
    item_name: string;
    inventory_uom: string;
    purchase_uom: string;
    pack_factor: string;
    supplier_id: string | null;
    supplier_name: string | null;
    contract_price: string;
    min_qty: string;
    max_qty: string;
    qty_on_hand: string;
    pending_ordered_qty: string;
    suggested_pack_qty: string;
    suggested_inv_qty: string;
    estimated_cost: string;
  }>(`select * from calculate_par_order_suggestions($1, $2)`, [tenantId, storeId]);

  return rows.map((r) => ({
    itemId: r.item_id,
    itemCode: r.item_code,
    itemName: r.item_name,
    inventoryUom: r.inventory_uom,
    purchaseUom: r.purchase_uom,
    packFactor: dec(r.pack_factor),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    contractPrice: dec(r.contract_price),
    minQty: dec(r.min_qty),
    maxQty: dec(r.max_qty),
    qtyOnHand: dec(r.qty_on_hand),
    pendingOrderedQty: dec(r.pending_ordered_qty),
    suggestedPackQty: dec(r.suggested_pack_qty),
    suggestedInvQty: dec(r.suggested_inv_qty),
    estimatedCost: dec(r.estimated_cost),
  }));
}

/**
 * 2. Generate Consolidated Purchase Orders from Par Suggestions
 * Groups par suggestions by supplier and generates POs with line numbers.
 */
export async function createPurchaseOrdersFromPar(
  db: Database,
  tenantId: string,
  storeId: string,
  createdBy: string = 'system',
): Promise<Array<{ purchaseOrderId: string; poNumber: string; supplierId: string; lineCount: number }>> {
  const suggestions = await getParOrderSuggestions(db, tenantId, storeId);
  const actionable = suggestions.filter((s) => s.suggestedPackQty.gt(0) && s.supplierId !== null);

  if (actionable.length === 0) return [];

  // Group by supplier
  const bySupplier = new Map<string, typeof actionable>();
  for (const item of actionable) {
    const list = bySupplier.get(item.supplierId!) ?? [];
    list.push(item);
    bySupplier.set(item.supplierId!, list);
  }

  const results: Array<{ purchaseOrderId: string; poNumber: string; supplierId: string; lineCount: number }> = [];

  await db.transaction(async (tx) => {
    for (const [supplierId, items] of bySupplier.entries()) {
      const poNumber = `PO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

      const { rows: po } = await tx.query<{ id: string }>(
        `insert into purchase_orders
           (tenant_id, po_number, supplier_id, destination_store_id, order_date, status, created_by, notes)
         values ($1, $2, $3, $4, current_date, 'draft', $5, 'Auto-generated from Par stock levels')
         returning id`,
        [tenantId, poNumber, supplierId, storeId, createdBy],
      );
      const poId = po[0].id;

      let lineNo = 1;
      for (const item of items) {
        const packQty = item.suggestedPackQty;
        const packFactor = item.packFactor;
        const invQty = packQty.mul(packFactor);
        const unitPrice = item.contractPrice;
        const lineTotal = packQty.mul(unitPrice);

        await tx.query(
          `insert into purchase_order_lines
             (tenant_id, purchase_order_id, line_no, item_id, order_uom, ordered_pack_qty,
              pack_factor, ordered_inventory_qty, unit_price, line_total, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')`,
          [
            tenantId,
            poId,
            lineNo++,
            item.itemId,
            item.purchaseUom,
            qtyParam(packQty),
            qtyParam(packFactor),
            qtyParam(invQty),
            moneyParam(unitPrice),
            moneyParam(lineTotal),
          ],
        );
      }

      results.push({ purchaseOrderId: poId, poNumber, supplierId, lineCount: items.length });
    }
  });

  return results;
}

/**
 * 3. Create Manual Purchase Order
 */
export async function createPurchaseOrder(
  db: Database,
  tenantId: string,
  poNumber: string,
  supplierId: string,
  destinationStoreId: string,
  lines: POLineInput[],
  notes?: string,
  createdBy: string = 'system',
): Promise<{ purchaseOrderId: string }> {
  return db.transaction(async (tx) => {
    const { rows: po } = await tx.query<{ id: string }>(
      `insert into purchase_orders
         (tenant_id, po_number, supplier_id, destination_store_id, order_date, status, notes, created_by)
       values ($1, $2, $3, $4, current_date, 'draft', $5, $6)
       returning id`,
      [tenantId, poNumber, supplierId, destinationStoreId, notes ?? null, createdBy],
    );
    const poId = po[0].id;

    let lineNo = 1;
    for (const l of lines) {
      const packQty = new Decimal(l.orderedPackQty);
      const packFactor = new Decimal(l.packFactor);
      const invQty = packQty.mul(packFactor);
      const unitPrice = new Decimal(l.unitPrice);
      const lineTotal = packQty.mul(unitPrice);

      await tx.query(
        `insert into purchase_order_lines
           (tenant_id, purchase_order_id, line_no, item_id, order_uom, ordered_pack_qty,
            pack_factor, ordered_inventory_qty, unit_price, line_total, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')`,
        [
          tenantId,
          poId,
          lineNo++,
          l.itemId,
          l.orderUom,
          qtyParam(packQty),
          qtyParam(packFactor),
          qtyParam(invQty),
          moneyParam(unitPrice),
          moneyParam(lineTotal),
        ],
      );
    }

    return { purchaseOrderId: poId };
  });
}

/**
 * 4. Approve Purchase Order
 */
export async function approvePurchaseOrder(
  db: Database,
  tenantId: string,
  poId: string,
  approvedByUserId?: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `select status from purchase_orders where id = $1 and tenant_id = $2 for update`,
      [poId, tenantId],
    );
    if (!rows.length) throw new PurchasingError('Purchase Order not found.', 'PO_NOT_FOUND');
    if (rows[0].status !== 'draft') {
      throw new PurchasingError(`Cannot approve PO in status ${rows[0].status}`, 'INVALID_STATUS');
    }

    await tx.query(
      `update purchase_orders
          set status = 'approved', approved_by = $2, approved_at = now()
        where id = $1`,
      [poId, approvedByUserId ?? null],
    );
  });
}

/**
 * 5. Send Purchase Order to Supplier
 */
export async function sendPurchaseOrder(db: Database, tenantId: string, poId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `select status from purchase_orders where id = $1 and tenant_id = $2 for update`,
      [poId, tenantId],
    );
    if (!rows.length) throw new PurchasingError('Purchase Order not found.', 'PO_NOT_FOUND');
    if (rows[0].status !== 'approved') {
      throw new PurchasingError('Only approved purchase orders can be sent to supplier.', 'INVALID_STATUS');
    }

    await tx.query(`update purchase_orders set status = 'sent' where id = $1`, [poId]);
  });
}

/**
 * 6. Receive Goods against Purchase Order with 3-Way Match & Stock Ledger Posting
 */
export async function receivePurchaseOrder(
  db: Database,
  opts: {
    tenantId: string;
    purchaseOrderId: string;
    referenceNumber: string;
    occurredOn: string;
    invoiceNumber?: string;
    invoiceAmount?: number | string | Decimal;
    lines: ReceivingLineInput[];
    priceTolerancePct?: number; // default 2%
    actorUserId?: string;
  },
): Promise<{ purchaseId: string; matchResult: ThreeWayMatchResult }> {
  const {
    tenantId,
    purchaseOrderId,
    referenceNumber,
    occurredOn,
    invoiceNumber,
    invoiceAmount,
    lines,
    priceTolerancePct = 2.0,
    actorUserId = 'system',
  } = opts;

  return db.transaction(async (tx) => {
    // 1. Lock and verify PO
    const { rows: poRows } = await tx.query<{
      id: string;
      status: string;
      supplier_id: string;
      destination_store_id: string;
    }>(
      `select id, status, supplier_id, destination_store_id
         from purchase_orders where id = $1 and tenant_id = $2 for update`,
      [purchaseOrderId, tenantId],
    );
    if (!poRows.length) throw new PurchasingError('Purchase order not found.', 'PO_NOT_FOUND');
    const po = poRows[0];

    if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
      throw new PurchasingError(
        `Cannot receive against PO in status ${po.status}. PO must be approved or sent.`,
        'INVALID_STATUS',
      );
    }

    // 2. Create Goods Receiving Note (purchases record)
    const { rows: purRows } = await tx.query<{ id: string }>(
      `insert into purchases
         (tenant_id, store_id, supplier_id, reference_number, purchase_order_id,
          invoice_number, invoice_amount, occurred_on, created_by, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, 'draft')
       returning id`,
      [
        tenantId,
        po.destination_store_id,
        po.supplier_id,
        referenceNumber,
        purchaseOrderId,
        invoiceNumber ?? null,
        invoiceAmount ? moneyParam(invoiceAmount) : null,
        occurredOn,
        actorUserId,
      ],
    );
    const purchaseId = purRows[0].id;

    // 3. Load PO lines to compare against
    const { rows: poLines } = await tx.query<{
      id: string;
      item_id: string;
      ordered_inventory_qty: string;
      unit_price: string;
      pack_factor: string;
      received_inventory_qty: string;
    }>(
      `select id, item_id, ordered_inventory_qty::text, unit_price::text, pack_factor::text,
              received_inventory_qty::text
         from purchase_order_lines where purchase_order_id = $1`,
      [purchaseOrderId],
    );
    const poLineMap = new Map(poLines.map((p) => [p.item_id, p]));

    let flaggedCount = 0;
    let totalOrd = new Decimal(0);
    let totalAct = new Decimal(0);
    let totalVar = new Decimal(0);
    const matchLines: ThreeWayMatchResult['lines'] = [];

    // 4. Insert purchase_lines and evaluate 3-Way match variances
    for (const line of lines) {
      const recQty = new Decimal(line.receivedQty);
      const recCost = new Decimal(line.unitCost);
      const poLine = poLineMap.get(line.itemId);

      let poUnitCost = recCost;
      let poOrderedQty = recQty;
      let lineVarianceStatus: LineVarianceStatus = 'ok';
      let priceVar = new Decimal(0);
      let qtyVar = new Decimal(0);

      if (poLine) {
        // Contract price per inventory unit = pack unit price / pack factor
        poUnitCost = dec(poLine.unit_price).div(dec(poLine.pack_factor));
        poOrderedQty = dec(poLine.ordered_inventory_qty);
        priceVar = recCost.minus(poUnitCost).mul(recQty);
        qtyVar = recQty.minus(poOrderedQty);

        const pctPriceDiff = poUnitCost.gt(0)
          ? recCost.minus(poUnitCost).abs().div(poUnitCost).mul(100)
          : new Decimal(0);

        if (pctPriceDiff.gt(priceTolerancePct)) {
          lineVarianceStatus = 'price_mismatch';
          flaggedCount++;
        }

        totalOrd = totalOrd.plus(poUnitCost.mul(recQty));
      } else {
        totalOrd = totalOrd.plus(recCost.mul(recQty));
      }

      totalAct = totalAct.plus(recCost.mul(recQty));
      totalVar = totalVar.plus(priceVar);

      const { rows: insLine } = await tx.query<{ id: string }>(
        `insert into purchase_lines
           (tenant_id, purchase_id, item_id, qty, unit_cost, po_line_id, ordered_qty,
            ordered_unit_cost, price_variance, qty_variance, variance_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          tenantId,
          purchaseId,
          line.itemId,
          qtyParam(recQty),
          moneyParam(recCost),
          poLine?.id ?? null,
          qtyParam(poOrderedQty),
          moneyParam(poUnitCost),
          moneyParam(priceVar),
          qtyParam(qtyVar),
          lineVarianceStatus,
        ],
      );

      matchLines.push({
        lineId: insLine[0].id,
        itemId: line.itemId,
        orderedQty: poOrderedQty,
        orderedUnitCost: poUnitCost,
        receivedQty: recQty,
        actualUnitCost: recCost,
        priceVariance: priceVar,
        qtyVariance: qtyVar,
        varianceStatus: lineVarianceStatus,
      });

      // Update PO line received qty
      if (poLine) {
        const newReceived = dec(poLine.received_inventory_qty).plus(recQty);
        const newLineStatus: POLineStatus = newReceived.gte(dec(poLine.ordered_inventory_qty))
          ? 'received'
          : 'partial';

        await tx.query(
          `update purchase_order_lines
              set received_inventory_qty = $2, status = $3
            where id = $1`,
          [poLine.id, qtyParam(newReceived), newLineStatus],
        );
      }

      // Post receipt to stock ledger (moving average updated)
      const lineVal = recQty.mul(recCost);
      await tx.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line, note, created_by)
         values ($1, $2, $3, 'receipt', $4, $5, $6, $7::date,
                 'purchase_receipt', $8, $9, 'PO receiving GRN', $10)`,
        [
          tenantId,
          po.destination_store_id,
          line.itemId,
          qtyParam(recQty),
          moneyParam(recCost),
          moneyParam(lineVal),
          occurredOn,
          purchaseId,
          insLine[0].id,
          actorUserId,
        ],
      );
    }

    const matchStatus: MatchStatus = flaggedCount > 0 ? 'variance_flagged' : 'matched';

    // 5. Update purchase header with match status and post
    await tx.query(
      `update purchases
          set status = 'posted', match_status = $2
        where id = $1`,
      [purchaseId, matchStatus],
    );

    // 6. Check if all PO lines are received to complete the PO
    const { rows: remaining } = await tx.query<{ count: string }>(
      `select count(*)::text as count
         from purchase_order_lines
        where purchase_order_id = $1 and status <> 'received'`,
      [purchaseOrderId],
    );

    const isFullyReceived = Number(remaining[0].count) === 0;
    const newPOStatus: POStatus = isFullyReceived ? 'completed' : 'partially_received';

    await tx.query(`update purchase_orders set status = $2 where id = $1`, [purchaseOrderId, newPOStatus]);

    return {
      purchaseId,
      matchResult: {
        purchaseId,
        matchStatus,
        totalOrderedCost: totalOrd,
        totalActualCost: totalAct,
        totalVariance: totalVar,
        flaggedLines: flaggedCount,
        lines: matchLines,
      },
    };
  });
}

/**
 * 7. Approve 3-Way Match Price Variance (Controller Sign-off)
 */
export async function approvePurchaseVariance(
  db: Database,
  tenantId: string,
  purchaseId: string,
  reason: string,
  approverUserId?: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ match_status: string }>(
      `select match_status from purchases where id = $1 and tenant_id = $2 for update`,
      [purchaseId, tenantId],
    );
    if (!rows.length) throw new PurchasingError('Purchase record not found.', 'PO_NOT_FOUND');
    if (rows[0].match_status !== 'variance_flagged') {
      throw new PurchasingError('Only variance_flagged purchases can be approved.', 'INVALID_STATUS');
    }

    await tx.query(
      `update purchases
          set match_status = 'variance_approved',
              variance_reason = $2,
              variance_approved_by = $3,
              variance_approved_at = now()
        where id = $1`,
      [purchaseId, reason, approverUserId ?? null],
    );

    await tx.query(
      `update purchase_lines
          set variance_status = 'approved'
        where purchase_id = $1 and variance_status = 'price_mismatch'`,
      [purchaseId],
    );
  });
}
