import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  getParOrderSuggestions,
  createPurchaseOrdersFromPar,
  createPurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  approvePurchaseVariance,
  PurchasingError,
} from '../src/domain/purchasing';
import { dec, Decimal } from '../src/lib/money';

describe('Phase 2: Materials Control Purchasing & 3-Way Matching Engine', () => {
  let h: Harness;
  let db: Database;
  let tenantId: string;
  let stores: Record<string, string>;
  let items: Record<string, string>;
  let suppliers: Record<string, string>;
  let testUserId: string | null = null;

  beforeAll(async () => {
    h = await seededDb();
    db = h.db;
    tenantId = h.seeded.tenantId;
    stores = h.seeded.storeIds;
    items = h.seeded.itemIds;
    suppliers = h.seeded.supplierIds;

    const { rows: u } = await db.query<{ id: string }>('select id from users limit 1');
    testUserId = u[0]?.id ?? null;
  });

  afterAll(async () => {
    await h?.close();
  });

  async function getOnHand(storeId: string, itemId: string): Promise<Decimal> {
    const { rows } = await db.query<{ q: string }>(
      `select coalesce(qty_on_hand, 0) as q from v_stock_on_hand
        where tenant_id = $1 and store_id = $2 and item_id = $3`,
      [tenantId, storeId, itemId],
    );
    return dec(rows[0]?.q ?? 0);
  }

  describe('1. Supplier Price Catalogs (HMC LIEFERART)', () => {
    it('verifies seeded supplier price catalog entries with dual units and pack sizes', async () => {
      const { rows } = await db.query<{
        supplier_code: string;
        item_code: string;
        purchase_uom: string;
        pack_factor: string;
        contract_price: string;
        is_preferred: boolean;
      }>(
        `select s.code as supplier_code, i.code as item_code, sip.purchase_uom,
                sip.pack_factor::text, sip.contract_price::text, sip.is_preferred
           from supplier_item_prices sip
           join suppliers s on s.id = sip.supplier_id
           join items i on i.id = sip.item_id
          where sip.tenant_id = $1
          order by s.code, i.code`,
        [tenantId],
      );

      expect(rows.length).toBeGreaterThanOrEqual(10);

      // Verify BGI Ambo Water contract: 1080 ETB per Crate of 24 bottles
      const ambo = rows.find((r) => r.supplier_code === 'SUP-BGI' && r.item_code === 'RM-AMBO');
      expect(ambo).toBeDefined();
      expect(ambo?.purchase_uom).toBe('Crate');
      expect(Number(ambo?.pack_factor)).toBe(24);
      expect(Number(ambo?.contract_price)).toBe(1080);
      expect(ambo?.is_preferred).toBe(true);

      // Verify Merkato Teff: 6500 ETB per Bag of 50kg
      const teff = rows.find((r) => r.supplier_code === 'SUP-GRAIN' && r.item_code === 'RM-TEFF');
      expect(teff).toBeDefined();
      expect(teff?.purchase_uom).toBe('Bag');
      expect(Number(teff?.pack_factor)).toBe(50);
      expect(Number(teff?.contract_price)).toBe(6500);
    });
  });

  describe('2. Purchase Order Lifecycle (HMC BESTELLUNG / BESTPOS)', () => {
    it('creates a draft PO, approves it, and sends it to supplier', async () => {
      const poNumber = `PO-TEST-${Date.now().toString().slice(-4)}`;

      // 1. Create draft PO: 10 crates of Ambo (240 bottles) + 5 crates of Soda (120 bottles)
      const { purchaseOrderId } = await createPurchaseOrder(
        db,
        tenantId,
        poNumber,
        suppliers['SUP-BGI'],
        stores.MAIN,
        [
          {
            itemId: items['RM-AMBO'],
            orderUom: 'Crate',
            orderedPackQty: '10',
            packFactor: '24',
            unitPrice: '1080.00', // 1080 ETB per crate
          },
          {
            itemId: items['RM-SODA'],
            orderUom: 'Crate',
            orderedPackQty: '5',
            packFactor: '24',
            unitPrice: '2880.00', // 2880 ETB per crate
          },
        ],
        'Routine weekly beverage replenishment',
      );

      // Verify lines in database
      const { rows: lines } = await db.query<{
        line_no: number;
        ordered_pack_qty: string;
        ordered_inventory_qty: string;
        line_total: string;
      }>(
        `select line_no, ordered_pack_qty::text, ordered_inventory_qty::text, line_total::text
           from purchase_order_lines
          where purchase_order_id = $1
          order by line_no`,
        [purchaseOrderId],
      );

      expect(lines).toHaveLength(2);
      // Line 1: 10 crates x 24 = 240 bottles, total = 10,800.00 ETB
      expect(Number(lines[0].ordered_pack_qty)).toBe(10);
      expect(Number(lines[0].ordered_inventory_qty)).toBe(240);
      expect(Number(lines[0].line_total)).toBe(10800);

      // Line 2: 5 crates x 24 = 120 bottles, total = 14,400.00 ETB
      expect(Number(lines[1].ordered_pack_qty)).toBe(5);
      expect(Number(lines[1].ordered_inventory_qty)).toBe(120);
      expect(Number(lines[1].line_total)).toBe(14400);

      // 2. Refuse to send while still in draft
      await expect(sendPurchaseOrder(db, tenantId, purchaseOrderId)).rejects.toThrow(
        /Only approved purchase orders can be sent/i,
      );

      // 3. Approve PO
      await approvePurchaseOrder(db, tenantId, purchaseOrderId, testUserId ?? undefined);

      const { rows: poApproved } = await db.query<{ status: string }>(
        `select status from purchase_orders where id = $1`,
        [purchaseOrderId],
      );
      expect(poApproved[0].status).toBe('approved');

      // 4. Send PO
      await sendPurchaseOrder(db, tenantId, purchaseOrderId);

      const { rows: poSent } = await db.query<{ status: string }>(
        `select status from purchase_orders where id = $1`,
        [purchaseOrderId],
      );
      expect(poSent[0].status).toBe('sent');
    });
  });

  describe('3. Auto-Ordering Engine from Par Levels (HMC OrderCalculation.cs)', () => {
    it('calculates par replenishment suggestions rounded up to vendor packaging units', async () => {
      // Set Kitchen store par level for RM-AMBO: min = 100, max = 500
      await db.query(
        `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
         values ($1, $2, $3, 100, 500)
         on conflict (tenant_id, store_id, item_id)
         do update set min_qty = excluded.min_qty, max_qty = excluded.max_qty`,
        [tenantId, stores.KITCHEN, items['RM-AMBO']],
      );

      // Empty kitchen stock for RM-AMBO so it is below min (100)
      const currentStock = await getOnHand(stores.KITCHEN, items['RM-AMBO']);
      if (currentStock.gt(0)) {
        await db.query(
          `insert into stock_movements
             (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta, occurred_on, source_doc_type, note)
           values ($1, $2, $3, 'issue_out', $4, 45.0, $5, '2026-08-01'::date, 'test', 'clear for par test')`,
          [tenantId, stores.KITCHEN, items['RM-AMBO'], -currentStock.toNumber(), -currentStock.toNumber() * 45],
        );
      }

      // Check par suggestions
      const suggestions = await getParOrderSuggestions(db, tenantId, stores.KITCHEN);
      const amboSugg = suggestions.find((s) => s.itemCode === 'RM-AMBO');

      expect(amboSugg).toBeDefined();
      expect(amboSugg?.minQty.toNumber()).toBe(100);
      expect(amboSugg?.maxQty.toNumber()).toBe(500);
      expect(amboSugg?.qtyOnHand.toNumber()).toBe(0);

      // Deficit = 500 bottles. Pack factor = 24 bottles/crate.
      // 500 / 24 = 20.83 crates -> RoundUp to 21 crates.
      // 21 crates * 24 = 504 bottles.
      expect(amboSugg?.suggestedPackQty.toNumber()).toBe(21);
      expect(amboSugg?.suggestedInvQty.toNumber()).toBe(504);
      expect(amboSugg?.supplierId).toBe(suppliers['SUP-BGI']);

      // 21 crates * 1080 ETB = 22,680 ETB
      expect(amboSugg?.estimatedCost.toNumber()).toBe(22680);
    });

    it('creates consolidated purchase orders automatically grouped by vendor', async () => {
      const orders = await createPurchaseOrdersFromPar(db, tenantId, stores.KITCHEN, 'par_engine');
      expect(orders.length).toBeGreaterThanOrEqual(1);

      const bgiOrder = orders.find((o) => o.supplierId === suppliers['SUP-BGI']);
      expect(bgiOrder).toBeDefined();
      expect(bgiOrder?.poNumber).toMatch(/^PO-/);
      expect(bgiOrder?.lineCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Goods Receiving & 3-Way Matching Engine (HMC LIEFSCH)', () => {
    it('Case A: Perfect Match (PO = GRN = Invoice) posts stock ledger and completes PO', async () => {
      // 1. Create and approve PO for 20 kg of kitfo beef @ 1100 ETB/kg
      const { purchaseOrderId } = await createPurchaseOrder(
        db,
        tenantId,
        `PO-MATCH-${Date.now().toString().slice(-4)}`,
        suppliers['SUP-MEAT'],
        stores.MAIN,
        [
          {
            itemId: items['RM-BEEF-KITFO'],
            orderUom: 'Kg',
            orderedPackQty: '20',
            packFactor: '1',
            unitPrice: '1100.00',
          },
        ],
      );
      await approvePurchaseOrder(db, tenantId, purchaseOrderId);
      await sendPurchaseOrder(db, tenantId, purchaseOrderId);

      const initialOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-KITFO']);

      // 2. Receive exactly 20 kg @ 1100 ETB/kg
      const { purchaseId, matchResult } = await receivePurchaseOrder(db, {
        tenantId,
        purchaseOrderId,
        referenceNumber: 'GRN-001',
        invoiceNumber: 'INV-001',
        invoiceAmount: '22000.00',
        occurredOn: '2026-08-10',
        lines: [
          {
            itemId: items['RM-BEEF-KITFO'],
            receivedQty: '20',
            unitCost: '1100.00',
          },
        ],
      });

      // 3. Verify 3-Way Match result
      expect(matchResult.matchStatus).toBe('matched');
      expect(matchResult.flaggedLines).toBe(0);
      expect(matchResult.totalVariance.toNumber()).toBe(0);

      // 4. Verify Stock Ledger update
      const newOnHand = await getOnHand(stores.MAIN, items['RM-BEEF-KITFO']);
      expect(newOnHand.toNumber()).toBe(initialOnHand.plus(20).toNumber());

      // 5. Verify PO transitioned to 'completed'
      const { rows: po } = await db.query<{ status: string }>(
        `select status from purchase_orders where id = $1`,
        [purchaseOrderId],
      );
      expect(po[0].status).toBe('completed');
    });

    it('Case B & C: Price Variance Gate flags receipt and Controller approves variance', async () => {
      // 1. Create PO for 10 kg of beef fillet @ contracted 1400 ETB/kg
      const { purchaseOrderId } = await createPurchaseOrder(
        db,
        tenantId,
        `PO-VAR-${Date.now().toString().slice(-4)}`,
        suppliers['SUP-MEAT'],
        stores.MAIN,
        [
          {
            itemId: items['RM-BEEF-FILLET'],
            orderUom: 'Kg',
            orderedPackQty: '10',
            packFactor: '1',
            unitPrice: '1400.00',
          },
        ],
      );
      await approvePurchaseOrder(db, tenantId, purchaseOrderId);

      // 2. Supplier delivers but invoice price is 1550 ETB/kg (+10.7% variance, exceeds 2% tolerance)
      const { purchaseId, matchResult } = await receivePurchaseOrder(db, {
        tenantId,
        purchaseOrderId,
        referenceNumber: 'GRN-002-VAR',
        invoiceNumber: 'INV-SURCHARGE-99',
        invoiceAmount: '15500.00',
        occurredOn: '2026-08-11',
        lines: [
          {
            itemId: items['RM-BEEF-FILLET'],
            receivedQty: '10',
            unitCost: '1550.00', // 150 ETB/kg surcharge
          },
        ],
      });

      // 3. Verify gate flags price mismatch
      expect(matchResult.matchStatus).toBe('variance_flagged');
      expect(matchResult.flaggedLines).toBe(1);
      expect(matchResult.lines[0].varianceStatus).toBe('price_mismatch');
      // Price variance = 10 kg * (1550 - 1400) = 1500 ETB
      expect(matchResult.lines[0].priceVariance.toNumber()).toBe(1500);

      const { rows: purHeader } = await db.query<{ match_status: string }>(
        `select match_status from purchases where id = $1`,
        [purchaseId],
      );
      expect(purHeader[0].match_status).toBe('variance_flagged');

      // 4. Controller reviews and approves variance
      await approvePurchaseVariance(
        db,
        tenantId,
        purchaseId,
        'Approved by Financial Controller due to holiday beef market supply constraint',
        testUserId ?? undefined,
      );

      const { rows: purApproved } = await db.query<{ match_status: string; variance_reason: string }>(
        `select match_status, variance_reason from purchases where id = $1`,
        [purchaseId],
      );
      expect(purApproved[0].match_status).toBe('variance_approved');
      expect(purApproved[0].variance_reason).toContain('holiday beef market');

      // Lines also updated to 'approved'
      const { rows: linesApproved } = await db.query<{ variance_status: string }>(
        `select variance_status from purchase_lines where purchase_id = $1`,
        [purchaseId],
      );
      expect(linesApproved[0].variance_status).toBe('approved');
    });

    it('Case D: Partial Delivery updates PO line to partial and keeps PO open', async () => {
      // 1. Order 10 crates of small water (240 bottles)
      const { purchaseOrderId } = await createPurchaseOrder(
        db,
        tenantId,
        `PO-PARTIAL-${Date.now().toString().slice(-4)}`,
        suppliers['SUP-BGI'],
        stores.MAIN,
        [
          {
            itemId: items['RM-WATER-S'],
            orderUom: 'Crate',
            orderedPackQty: '10',
            packFactor: '24',
            unitPrice: '600.00',
          },
        ],
      );
      await approvePurchaseOrder(db, tenantId, purchaseOrderId);

      // 2. Supplier delivers only 4 crates (96 bottles)
      const { matchResult } = await receivePurchaseOrder(db, {
        tenantId,
        purchaseOrderId,
        referenceNumber: 'GRN-PARTIAL-1',
        occurredOn: '2026-08-12',
        lines: [
          {
            itemId: items['RM-WATER-S'],
            receivedQty: '96', // 4 crates x 24 bottles
            unitCost: '25.00', // 600 / 24 = 25 ETB/bottle
          },
        ],
      });

      expect(matchResult.matchStatus).toBe('matched');

      // 3. PO status must be 'partially_received'
      const { rows: po } = await db.query<{ status: string }>(
        `select status from purchase_orders where id = $1`,
        [purchaseOrderId],
      );
      expect(po[0].status).toBe('partially_received');

      // 4. Line status must be 'partial' with received_inventory_qty = 96
      const { rows: poLine } = await db.query<{ status: string; received_inventory_qty: string }>(
        `select status, received_inventory_qty::text from purchase_order_lines where purchase_order_id = $1`,
        [purchaseOrderId],
      );
      expect(poLine[0].status).toBe('partial');
      expect(Number(poLine[0].received_inventory_qty)).toBe(96);
    });

    it('Case E: Direct execution of match_3way_receipt() database stored function', async () => {
      // Create PO
      const { purchaseOrderId } = await createPurchaseOrder(
        db,
        tenantId,
        `PO-SQL-${Date.now().toString().slice(-4)}`,
        suppliers['SUP-DAIRY'],
        stores.MAIN,
        [
          {
            itemId: items['RM-BUTTER'],
            orderUom: 'Kg',
            orderedPackQty: '10',
            packFactor: '1',
            unitPrice: '900.00',
          },
        ],
      );
      await approvePurchaseOrder(db, tenantId, purchaseOrderId);

      const { purchaseId } = await receivePurchaseOrder(db, {
        tenantId,
        purchaseOrderId,
        referenceNumber: 'GRN-SQL-TEST',
        occurredOn: '2026-08-13',
        lines: [
          {
            itemId: items['RM-BUTTER'],
            receivedQty: '10',
            unitCost: '900.00',
          },
        ],
      });

      // Call database function match_3way_receipt
      const { rows } = await db.query<{
        match_status: string;
        total_ordered_cost: string;
        total_actual_cost: string;
        total_variance: string;
        flagged_lines: number;
      }>(`select * from match_3way_receipt($1, 2.0)`, [purchaseId]);

      expect(rows).toHaveLength(1);
      expect(rows[0].match_status).toBe('matched');
      expect(Number(rows[0].total_ordered_cost)).toBe(9000);
      expect(Number(rows[0].total_actual_cost)).toBe(9000);
      expect(Number(rows[0].total_variance)).toBe(0);
      expect(rows[0].flagged_lines).toBe(0);
    });
  });
});
