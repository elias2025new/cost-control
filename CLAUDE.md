# Prime F&B Cost Control — project brief

## What this is

A web app that replaces a restaurant F&B cost-control spreadsheet with a
real system. The client is Prime Hospitality Business Group in Addis Ababa
(contact: Ato Eyob). Currency is Ethiopian birr (ETB).

It is **not** a general ERP. Accounts payable, accounts receivable, general
ledger, bank reconciliation and financial statements are explicitly out of
scope. The client sent a broader "ERP blueprint" document — treat that as a
wish list for later, not as scope.

The real scope is: what does it cost to make what we sold, what should our
stock be, what is it actually, and where is the difference.

## Reference material in `reference/`

| File | What it is |
| --- | --- |
| `client_spec.md` | The client's own sheet-by-sheet description. The most precise statement of requirements we have. |
| `prime_fnb_workbook.xlsx` | The spreadsheet system this app replaces |
| `cnet_sales_export.xlsx` | A real sales report out of the client's POS |
| `erp_blueprint.docx` | The client's broader ERP proposal. Context only — most of it is out of scope. |

Read the actual files. They contain details this brief summarises.

## Non-negotiable design rules

These are not preferences. Breaking any of them makes the system untrustworthy
in month three, which is the normal way software like this dies.

1. **Stock on hand is never stored.** There is one append-only
   `stock_movements` table. Every receipt, issue, transfer, sale depletion,
   wastage, comp, staff meal and count adjustment writes signed rows into it.
   Stock is always `SUM(qty_delta)`. Never a column you update.
2. **Nothing is deleted or edited after posting.** Corrections are reversing
   movements. An unposted document may be edited; a posted one may only be
   reversed.
3. **Costs and recipes are versioned with effective dates.** Changing an
   ingredient's cost today must not change last month's food cost report.
   This is the single biggest failure of the spreadsheet being replaced and it
   is the main reason the client is buying software.
4. **`numeric`, never float.** Quantities `numeric(18,6)`, money
   `numeric(18,2)`, rates `numeric(6,4)`. VAT on top of a service charge
   produces rounding an accountant will find.
5. **Every table carries `tenant_id`, every query is scoped by it.** Real
   multi-tenancy machinery comes later; the column and the discipline start now.
6. **An import that doesn't reconcile does not post.** See "Reconciliation".
7. **Revenue always posts; depletion is best-effort.** See "Posting rule" below.

## Posting rule — read this before touching `postSalesImport`

An earlier version of this brief said to reject the whole import if any mapped
line has no active recipe. **That was wrong and must not come back.** There
will be six to eight recipes against 171 articles, and after go-live recipes
get written gradually over weeks. An import that refused to post until every
article had a recipe would never post at all.

The rule is:

- **Revenue always posts.** Every sales line is recorded whether or not a
  recipe exists for it.
- **Depletion happens only for lines with an active recipe on that business
  date.** Lines without one are recorded and flagged as uncosted — never
  rejected, never silently dropped.
- **Reject the import only for structural problems:** it does not reconcile
  against the footer subtotal, the branch and period is already posted, or the
  file could not be parsed.
- **Report cost coverage on every import:** the percentage of the day's
  revenue that could actually be costed, and the birr value that could not.
  That number starts low, climbs as recipes get written, and is the most
  honest thing the system can show the client.

Only `reconciliation`, `duplicate_period` and `parse` issues carry severity
`block`. Everything about coverage is a `warn`.

Free and comp articles are the one case that splits the two behaviours:
`counts_as_sale = false` keeps them out of revenue, `depletes = true` keeps
them in the ledger. Free water still leaves the store. Getting this backwards
in either direction is a real bug and there are tests on both halves.

## Unverified before go-live

**Concurrent posting has never actually been exercised.** `postSalesImport`
locks the import row with `SELECT ... FOR UPDATE` and re-checks its status
inside the transaction. That design is right, but the tests run on PGlite,
which is single-connection — no test has ever caused `FOR UPDATE` to block
another session, so the protection is reasoned rather than proven.

Verify against a real PostgreSQL server before go-live: two concurrent
`postSalesImport` calls on the same import id, asserting one posts and the
other returns `alreadyPosted` with no second set of movements. The unique index
`stock_movements_sale_depletion_once` is the backstop if the lock is wrong.

The same applies to **`fulfillIssueRequest`**, which locks the request row
and re-checks status identically. Its sequential double-release is covered
by a test and by the `stock_movements_issue_fulfillment_once` index, but a
genuinely concurrent pair has never run either. Test both routines in the
same session against real PostgreSQL.

One concurrency question that is *settled* rather than pending: two
fulfilments against the same store and item cannot corrupt each other's
pricing, because an issue never moves the weighted average — only a receipt
does. A receipt landing concurrently with a fulfilment would need
serialising, but no receiving flow exists yet for that to happen against.
Revisit the day one is built.

## Data model

Master data: `tenants`, `stores`, `item_categories`, `items`,
`store_item_levels` (min/max par per store, not per item).

Users and access: `users` — two roles, `admin` (everything, manages
accounts) and `store_user` (scoped to one store via `store_id`; whether
that store is main, kitchen or bar comes from `stores.kind`, never
duplicated onto the user). Accounts are deactivated, never deleted, so past
actions stay attributable.

Issuing: `issue_requests` / `issue_request_lines` — an outlet asks its
branch's main store for stock; releasing writes the `issue_out`/`issue_in`
movement pair. See the note on that flow under Open questions.

**Auth is a signed cookie, never a session table, and `proxy.ts` must never
touch the database.** Next 16 renamed `middleware` to `proxy` and its docs
warn Proxy may run apart from the render process; `db()` is a `globalThis`
singleton and PGlite holds its data directory exclusively, so a second
connection from there risks a lock conflict. `src/lib/session.ts` is
therefore pure crypto with no DB import, and that boundary is load-bearing —
don't let anything drag `db.ts` into it. Proxy is only the early redirect;
the real gate is `requireUser()`/`requireAdmin()` inside every Server
Action, because a Server Action stays reachable independently of the route
protection in front of the page that renders its form.

Menu and recipes: `menu_items`, `pos_item_map`, `recipes`, `recipe_lines`.

**Recipes are a tree, not a flat list.** The workbook has sub-recipes: a burger
bun is costed once from flour, yeast, butter, sugar, salt and eggs, given a
batch yield of 20 pieces, and pulled into the burger recipe as one line at
cost-per-unit. So:

- a `recipe` belongs to either a `menu_item` or a sub-recipe product
- a `recipe_line` references **either** an `item` **or** another `recipe`
- sub-recipe recipes carry `batch_yield_qty` and `batch_yield_uom`
- cost rolls up recursively; depletion walks the tree down to raw items only
- guard against cycles, and cap recursion depth

Sales: `sales_imports` (one per branch per business day per source, uniquely
constrained so the same day cannot post twice), `sales_lines`.

Ledger: `stock_movements` as described above.

Counts: `stock_counts`, `stock_count_lines` with theoretical snapshot, counted
qty, and derived variance.

Costing is **moving weighted average per store and item**. Store `unit_cost` on
every movement so history is reproducible and FIFO stays possible later.

Issuing at weighted average does not move the average — only a receipt does.
So a posting reads the average once per store and item and reuses it, and the
ledger orders same-day receipts ahead of same-day depletions
(`movement_sort_rank`) so a receipt that lands today is reflected in today's
depletion cost.

**That shortcut has a precondition.** Reading the average once per posting is
only safe because a sales posting contains *depletions only* — nothing inside
it can move the average. When receiving is built, any posting that mixes
receipts with issues or depletions **must recompute the average between them**,
in ledger order. Caching it across a mixed posting would value later issues at
the pre-receipt average and silently mis-state cost of goods sold. If you are
about to write a posting routine that inserts an inbound movement, this note is
for you.

**Money precision:** figures this system calculates are `numeric(18,2)`. POS
*source* amounts are `numeric(18,4)`, because the client's own export carries
three decimals and its footer subtotal is 8,928,373.056 — at two decimals the
sum would no longer reproduce the footer and every real file would refuse to
post. Fixed-point either way, never a float.

Postgres rounds half away from zero. `src/lib/money.ts` is configured to match
(`ROUND_HALF_UP` in decimal.js means away from zero, not the half-even default
some libraries use), and a test asserts the two agree.

## What the real POS data actually looks like

From the client's own export — verified, not assumed:

- The report is "Categorized And Summarized By Article": category → sub-category
  → article rows, with values only in the top-left cell of merged ranges.
- **`Article Code` is the stable key** (`P-00052`). Parse as **text** — some
  codes have no `P-` prefix (`00081`, `00040`, `00039`) and leading zeros must
  survive.
- **Article names are not keys.** `MOJITO` and ` MOJITO` are two different
  articles at different prices. Twenty-one names carry stray whitespace.
- **Generic articles cannot be costed.** `SOFT DRINK` sold 1,803 units,
  `BEER` 379, `SEASONAL FRESH JUICE` 44. These name no specific product, so no
  recipe can exist. Flag them loudly on import — do not skip silently.
- **Test articles are live in production**: `TEST DRINK`, `TEST FOOD`, `TEST`,
  all priced around 0.1 birr. Flag.
- **Free/comp articles** (`FREE AMBO`, `FREE WATER`, `FREE SOFT DRINK`,
  `FREE NOVIDA`) consume real stock with no revenue. They must deplete
  inventory but must not count as sales.
- **VAT is 15% of (net + service charge)** — confirmed exactly against the
  client's own totals.
- **Service charge is NOT a flat rate.** It came to 4.94% of net sales, meaning
  only about half of sales carry it (takeaway is the likely reason). Never
  apply a flat 10% per line. The rule is an open question for the client.
- The report is pre-filtered to `Void State = Not void`, so voids need a
  separate report.
- The report carries **no outlet dimension** — nothing says whether a sale came
  from the bar or the kitchen. Category is a proxy; a category-to-store map is
  required.
- It can be run **per business day**, which is what depletion needs — but the
  file we actually have is a **27-day range** (`from 07/08/2026 to 08/03/2026`,
  mm/dd, so 8 July to 3 August 2026). `sales_imports` therefore carries
  `period_start` and `period_end`; a single day is the case where they are
  equal.
- Data is per **branch** (`Siyonat Branch`), so branch is a real dimension.

### Verified against the file, August 2026

- 171 articles, all codes text, all distinct. Three have no `P-` prefix.
- Σ article `Total Amount` = footer `Sub Total` = **8,928,373.056 exactly**.
  Category subtotals and the 15,983 quantity total also tie exactly. This is
  the reconciliation the import must reproduce.
- `Add. Charge` 440,747.104 = **4.9365%** of net.
- `Total Tax` 1,405,368.786 is **0.762 birr** above a flat 15% of
  (net + add charge) — per-bill rounding at the POS. Report it, never block on
  it.
- `Grand Total` = sub total + add charge − discount + tax, exactly.

## Business rules taken from the workbook

- Four leakage channels, tracked separately: **wastage, voids, complimentary,
  staff meals**. Comps cost at full standard recipe cost (a finished dish left
  the kitchen); staff meals cost at raw ingredient cost.
- **Two distinct variance checks, keep both.** Theoretical consumption compares
  what recipes say should have been used against what the store actually
  issued — this catches recipe drift and over-portioning. Inventory variance
  compares book stock at the outlet against a physical count — this catches
  theft and miscounting.
- Variance status thresholds: within 3% is OK, within 8% is REVIEW, beyond that
  is INVESTIGATE.
- Reorder status from par levels: below minimum is REORDER NOW, above maximum
  is OVERSTOCK.
- Monthly reconciliation: opening + issues + direct purchases − closing =
  consumed, then adjusted for wastage, comps and staff meals.
- Food cost % = cost of food sold ÷ food sales. Beverage the same, separately.
  Food and beverage are always reported separately, never merged.

## Open questions — do not invent answers

- Which sales carry the service charge.
- Whether kitchen and bar are separate stores (the client's written spec says
  yes with inter-outlet transfers; the workbook merges them). Assume separate.
- How many approval levels are really required, and on which documents.
  Still open in general. Answered for **issue requests only**, deliberately:
  the client's spec asks for three approvals plus a separate receive step by
  the requester, so rather than guess at levels nobody has confirmed, that
  flow is built as `requested → fulfilled → cancelled` — the storekeeper's
  single release both issues the stock and posts the movements — with the
  full chain rendered inert on the request screen. Revisit when the client
  answers; nothing else about approvals is decided.
- Whether ingredient yield/trim factors are needed in costing.
- Which store each POS category depletes from.

If any of these blocks progress, stop and ask rather than guessing.

## Stack and constraints

Python (e.g., FastAPI, Django, or Flask), PostgreSQL, and Vanilla CSS (no Tailwind). `pandas` or `openpyxl` for xlsx.

**Deployment target is undecided** — it may be cloud-hosted, or installed on a
single machine at the property serving over the LAN. So: plain PostgreSQL, no
managed-service-specific features, no edge runtime dependencies, nothing that
assumes the app can't run on a laptop. Keep it portable.

## Working style

- The developer is solo and plans in a separate chat, then builds here.
- Build the engine and prove the numbers before building screens.
- He values interactive, well-designed UI over plain output — but not before
  the calculations are right.
- When something is ambiguous, ask. Wrong numbers are worse than slow progress.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
