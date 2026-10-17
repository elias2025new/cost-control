import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db';
import { seededDb, type Harness } from './helpers';
import {
  createIssueRequest,
  approveIssueRequest,
  fulfillIssueRequest,
  getParRequisitionSuggestions,
} from '../src/domain/issueRequest';

let h: Harness;
let db: Database;
let tenantId: string;
let stores: Record<string, string>;
let items: Record<string, string>;
let testUserId: string | null = null;

beforeAll(async () => {
  h = await seededDb();
  db = h.db;
  tenantId = h.seeded.tenantId;
  stores = h.seeded.storeIds;
  items = h.seeded.itemIds;

  const { rows: u } = await db.query<{ id: string }>('select id from users limit 1');
  testUserId = u[0]?.id ?? null;
});

afterAll(async () => {
  await h?.close();
});

describe('Issue Request Pre-Approval & Par Requisition', () => {
  it('enforces pre-approval and allows fulfillment once approved', async () => {
    // 1. Kitchen requests stock
    const req = await createIssueRequest(
      db,
      tenantId,
      stores.KITCHEN,
      [{ itemId: items['RM-TEFF'], qty: '10' }],
      testUserId,
    );

    // Initial status should be requested
    const { rows: initial } = await db.query<{ status: string }>(
      `select status from issue_requests where id = $1`,
      [req.requestId],
    );
    expect(initial[0].status).toBe('requested');

    // 2. Head Chef pre-approves
    await approveIssueRequest(db, tenantId, req.requestId, {
      userId: testUserId,
      role: 'store_user',
      storeId: stores.KITCHEN,
    });

    const { rows: approved } = await db.query<{ status: string; approved_by_user_id: string }>(
      `select status, approved_by_user_id from issue_requests where id = $1`,
      [req.requestId],
    );
    expect(approved[0].status).toBe('approved');
    if (testUserId) {
      expect(approved[0].approved_by_user_id).toBe(testUserId);
    }

    // 3. Main Storekeeper fulfills
    const { rows: lines } = await db.query<{ id: string }>(
      `select id from issue_request_lines where issue_request_id = $1`,
      [req.requestId],
    );

    const result = await fulfillIssueRequest(
      db,
      tenantId,
      req.requestId,
      [{ lineId: lines[0].id, fulfilledQty: '10' }],
      { userId: testUserId, role: 'store_user', storeId: stores.MAIN, name: 'Storekeeper' },
    );

    expect(result.fulfilled).toBe(true);
    expect(result.linesReleased).toBe(1);
  });

  it('calculates par requisition suggestions correctly', async () => {
    // Set a max par of 25 for RM-SALT in BAR
    await db.query(
      `insert into store_item_levels (tenant_id, store_id, item_id, min_qty, max_qty)
       values ($1, $2, $3, 5, 25)
       on conflict (tenant_id, store_id, item_id) do update set max_qty = 25, min_qty = 5`,
      [tenantId, stores.BAR, items['RM-SALT']],
    );

    // BAR currently has 0 on hand
    const suggestions = await getParRequisitionSuggestions(db, tenantId, stores.BAR);
    const salt = suggestions.find((s) => s.itemId === items['RM-SALT']);
    expect(salt).toBeDefined();
    expect(Number(salt!.maxQty)).toBe(25);
    expect(Number(salt!.suggestedQty)).toBe(25);
  });
});
