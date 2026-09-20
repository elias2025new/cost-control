/**
 * Issue requests: an outlet asks the main store for stock, the main store
 * releases it, and the ledger records a matched, value-neutral transfer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  createIssueRequest,
  fulfillIssueRequest,
  cancelIssueRequest,
  IssueRequestError,
} from '../src/domain/issueRequest';
import { dec, Decimal } from '../src/lib/money';

let h: Harness;
let db: Database;
let tenantId: string;
let stores: Record<string, string>;
let items: Record<string, string>;

const ADMIN = { userId: null, role: 'admin' as const, storeId: null, name: 'Tester' };

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  stores = h.seeded.storeIds;
  items = h.seeded.itemIds;
});
afterAll(async () => {
  await h?.close();
});

async function onHand(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ q: string }>(
    `select qty_on_hand as q from v_stock_on_hand
      where tenant_id = $1 and store_id = $2 and item_id = $3`,
    [tenantId, stores[store], items[item]],
  );
  return dec(rows[0]?.q ?? 0);
}

async function valueOnHand(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ v: string }>(
    `select value_on_hand as v from v_stock_on_hand
      where tenant_id = $1 and store_id = $2 and item_id = $3`,
    [tenantId, stores[store], items[item]],
  );
  return dec(rows[0]?.v ?? 0);
}

async function avgCost(store: string, item: string): Promise<Decimal> {
  const { rows } = await db.query<{ a: string }>(
    `select current_avg_cost($1, $2, $3) as a`,
    [tenantId, stores[store], items[item]],
  );
  return dec(rows[0]?.a ?? 0);
}

async function lineIdsOf(requestId: string): Promise<{ id: string; item_id: string }[]> {
  const { rows } = await db.query<{ id: string; item_id: string }>(
    `select id, item_id from issue_request_lines where issue_request_id = $1 order by id`,
    [requestId],
  );
  return rows;
}

describe('making a request', () => {
  it('routes to the main store in the same branch', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-TEFF'], qty: '10' }],
      null,
    );
    expect(r.fulfillingStoreId).toBe(stores.MAIN);
    expect(r.lineCount).toBe(1);
  });

  it('refuses a request from the main store to itself', async () => {
    await expect(
      createIssueRequest(db, tenantId, stores.MAIN, [{ itemId: items['RM-TEFF'], qty: '1' }], null),
    ).rejects.toThrow(IssueRequestError);
  });

  it('refuses an empty request', async () => {
    await expect(
      createIssueRequest(db, tenantId, stores.BAR, [], null),
    ).rejects.toThrow(/at least one item/i);
  });
});

describe('releasing the stock', () => {
  it('moves quantity out of the main store and into the outlet', async () => {
    const beforeMain = await onHand('MAIN', 'RM-SUGAR');
    const beforeBar = await onHand('BAR', 'RM-SUGAR');

    const r = await createIssueRequest(
      db,
      tenantId,
      stores.BAR,
      [{ itemId: items['RM-SUGAR'], qty: '12' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    const res = await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '12' }],
      ADMIN,
    );

    expect(res.fulfilled).toBe(true);
    expect(res.linesReleased).toBe(1);
    expect((await onHand('MAIN', 'RM-SUGAR')).toString()).toBe(beforeMain.minus(12).toString());
    expect((await onHand('BAR', 'RM-SUGAR')).toString()).toBe(beforeBar.plus(12).toString());
  });

  it('is value-neutral: what leaves one store is exactly what arrives at the other', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-ONION'], qty: '7' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);

    const mainBefore = await valueOnHand('MAIN', 'RM-ONION');
    const kitchenBefore = await valueOnHand('KITCHEN', 'RM-ONION');

    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '7' }],
      ADMIN,
    );

    const mainLost = mainBefore.minus(await valueOnHand('MAIN', 'RM-ONION'));
    const kitchenGained = (await valueOnHand('KITCHEN', 'RM-ONION')).minus(kitchenBefore);
    expect(kitchenGained.toString()).toBe(mainLost.toString());
  });

  it('prices both legs at the SOURCE store average, not the destination', async () => {
    const sourceAvg = await avgCost('MAIN', 'RM-BUTTER');

    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-BUTTER'], qty: '3' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '3' }],
      ADMIN,
    );

    const { rows } = await db.query<{ movement_type: string; unit_cost: string }>(
      `select movement_type, unit_cost from stock_movements
        where source_doc_type = 'issue_request' and source_doc_id = $1
        order by movement_type`,
      [r.requestId],
    );
    expect(rows).toHaveLength(2);
    for (const m of rows) {
      expect(dec(m.unit_cost).toString()).toBe(sourceAvg.toString());
    }
  });

  it('issuing does not move the average at either end', async () => {
    const mainBefore = await avgCost('MAIN', 'RM-SALT');
    const kitchenBefore = await avgCost('KITCHEN', 'RM-SALT');

    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-SALT'], qty: '2' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '2' }],
      ADMIN,
    );

    expect((await avgCost('MAIN', 'RM-SALT')).toString()).toBe(mainBefore.toString());
    // The destination previously held stock at the same seeded cost, so its
    // average is unchanged too — an issue relocates value, never revalues it.
    expect((await avgCost('KITCHEN', 'RM-SALT')).toString()).toBe(kitchenBefore.toString());
  });

  it('records a partial release honestly, and only for what was released', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [
        { itemId: items['RM-TOMATO'], qty: '10' },
        { itemId: items['RM-KARIA'], qty: '5' },
      ],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    const beforeTomato = await onHand('KITCHEN', 'RM-TOMATO');

    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [
        { lineId: lines.find((l) => l.item_id === items['RM-TOMATO'])!.id, fulfilledQty: '4' },
        { lineId: lines.find((l) => l.item_id === items['RM-KARIA'])!.id, fulfilledQty: '0' },
      ],
      ADMIN,
    );

    expect((await onHand('KITCHEN', 'RM-TOMATO')).toString()).toBe(
      beforeTomato.plus(4).toString(),
    );
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from stock_movements
        where source_doc_id = $1 and source_doc_type = 'issue_request'`,
      [r.requestId],
    );
    // Only the tomato line moved: one out, one in. The zero line wrote nothing.
    expect(rows[0].n).toBe('2');
  });
});

describe('guards', () => {
  it('a second release is a no-op, not a second set of movements', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-GARLIC'], qty: '1' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    const fulfil = () =>
      fulfillIssueRequest(
        db,
        tenantId,
        r.requestId,
        [{ lineId: lines[0].id, fulfilledQty: '1' }],
        ADMIN,
      );

    await fulfil();
    const second = await fulfil();
    expect(second.alreadyFulfilled).toBe(true);
    expect(second.fulfilled).toBe(false);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from stock_movements
        where source_doc_id = $1 and source_doc_type = 'issue_request'`,
      [r.requestId],
    );
    expect(rows[0].n).toBe('2');
  });

  it('only the fulfilling store may release', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-GINGER'], qty: '1' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    await expect(
      fulfillIssueRequest(
        db,
        tenantId,
        r.requestId,
        [{ lineId: lines[0].id, fulfilledQty: '1' }],
        // the requesting outlet trying to release to itself
        { userId: null, role: 'store_user', storeId: stores.KITCHEN, name: 'Almaz' },
      ),
    ).rejects.toThrow(/only the store being asked/i);
  });

  it('rejects a line that belongs to a different request', async () => {
    const a = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-MITMITA'], qty: '1' }],
      null,
    );
    const b = await createIssueRequest(
      db,
      tenantId,
      stores.BAR,
      [{ itemId: items['RM-SUGAR'], qty: '1' }],
      null,
    );
    const bLines = await lineIdsOf(b.requestId);

    await expect(
      fulfillIssueRequest(
        db,
        tenantId,
        a.requestId,
        [{ lineId: bLines[0].id, fulfilledQty: '1' }],
        ADMIN,
      ),
    ).rejects.toThrow(IssueRequestError);
  });

  it('a cancelled request cannot be released', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.BAR,
      [{ itemId: items['RM-LIME'], qty: '1' }],
      null,
    );
    await cancelIssueRequest(db, tenantId, r.requestId, { role: 'admin', storeId: null });
    const lines = await lineIdsOf(r.requestId);

    await expect(
      fulfillIssueRequest(
        db,
        tenantId,
        r.requestId,
        [{ lineId: lines[0].id, fulfilledQty: '1' }],
        ADMIN,
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  it('a released request cannot be cancelled afterwards', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-BESOBELA'], qty: '0.5' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '0.5' }],
      ADMIN,
    );

    await expect(
      cancelIssueRequest(db, tenantId, r.requestId, { role: 'admin', storeId: null }),
    ).rejects.toThrow(/already released/i);
  });

  it('only the requesting store may cancel', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-ROSEMARY'], qty: '0.1' }],
      null,
    );
    await expect(
      cancelIssueRequest(db, tenantId, r.requestId, {
        role: 'store_user',
        storeId: stores.BAR,
      }),
    ).rejects.toThrow(/only the store that made the request/i);
  });

  it('the database refuses a second set of movements even if the status check were wrong', async () => {
    const r = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-KORARIMA'], qty: '0.2' }],
      null,
    );
    const lines = await lineIdsOf(r.requestId);
    await fulfillIssueRequest(
      db,
      tenantId,
      r.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '0.2' }],
      ADMIN,
    );

    // Bypass the domain function entirely and try to write the same pair
    // again — the unique index in 009 is the backstop.
    await expect(
      db.query(
        `insert into stock_movements
           (tenant_id, store_id, item_id, movement_type, qty_delta, unit_cost, value_delta,
            occurred_on, source_doc_type, source_doc_id, source_doc_line)
         values ($1, $2, $3, 'issue_out', -1, 10, -10, current_date,
                 'issue_request', $4, $5)`,
        [tenantId, stores.MAIN, items['RM-KORARIMA'], r.requestId, lines[0].id],
      ),
    ).rejects.toThrow();
  });
});
