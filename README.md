# Prime F&B Cost Control

Phase 1: the engine. No screens yet.

## Running it

```bash
npm install
npm run db:reset     # drop, migrate, seed — repeatable from clean
npm run dev          # http://localhost:3000
npm test             # 101 tests
npm run typecheck
```

**Stop the server before `db:reset`.** PGlite holds `.pgdata/` open
exclusively, so the app and the seed script must not both have it.

To put a posted import in front of you without clicking through the upload:

```bash
npm run demo:import            # import the reference file and post it
npm run demo:import -- --no-post   # import only, leave it awaiting review
npm run coverage:curve         # how many recipes reach 50 / 80 / 90% of revenue
```

## Screens

| | |
| --- | --- |
| `/` | Overview — recipe costs, latest import, coverage |
| `/import` | Upload a CNET export; list of every import and its checks |
| `/import/[id]` | Validation panel. Reconciliation, cost coverage, every problem found, and the post button — disabled until blocking problems clear |
| `/ledger` | Pick a store and item, see every movement and the running balance |

No database to install. With `DATABASE_URL` unset the app runs on **PGlite** —
PostgreSQL itself compiled to WASM, in-process, persisted to `.pgdata/`. Set
`DATABASE_URL` and the identical SQL runs against a real server:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/prime npm run db:reset
DATABASE_URL=postgres://user:pass@localhost:5432/prime npm test
```

The SQL uses no extensions, no managed-service features and no edge runtime,
because the deployment target is still undecided.

## What is here

| | |
| --- | --- |
| `db/migrations/` | Schema. Six files, applied in order, each in one transaction. |
| `db/seed/` | Seed data. Articles are real; recipes and costs are samples. |
| `src/lib/money.ts` | Fixed-point arithmetic. Nothing monetary is ever a JS number. |
| `src/domain/costRecipe.ts` | Walks the recipe tree to raw items, priced as-of a date. |
| `src/domain/postSalesImport.ts` | Records the day's sales, depletes what it can. |
| `src/domain/parseCnet.ts` | Reads the CNET export. |
| `src/domain/importCnet.ts` | Validates and reconciles an import before posting. |
| `tests/` | 98 tests, all against the client's real file. |

## Decisions worth knowing

**POS amounts are `numeric(18,4)`, not `(18,2)`.** The client's export carries
three decimals and its footer subtotal is 8,928,373.056. At two decimals the
sum stops reproducing the footer and every real file would refuse to post.
Figures the system *calculates* are still `(18,2)`. Fixed-point either way.

**The real file is a 27-day range**, not one business day: 8 July to 3 August
2026. `sales_imports` carries `period_start` and `period_end`; a single day is
where they are equal. Depletion posts against `period_end`.

**Revenue always posts, depletion is best-effort.** Only reconciliation
failure, a duplicate period, or an unparseable file will reject an import.
Every import reports cost coverage — with the eight seeded recipes the real
file costs **43.01% of revenue, leaving 5,088,483.35 birr uncosted**. That
number is meant to start low and climb as recipes get written.

**Two implementations of the costing, deliberately.** `costRecipe()` in
TypeScript and `recipe_cost()` in SQL. A test asserts they agree to the birr on
every recipe.

## Sample data

Every recipe and every ingredient cost is a **guess**, written with
`is_sample = true` and labelled wherever shown. The article codes, names,
categories, quantities and prices are real, straight out of
`reference/cnet_sales_export.xlsx`.

Eight menu recipes and four sub-recipes. The tree is three levels deep:

```
Yeajet Kitfo
├── Kitfo Base (sub, yields 4 portions)
│   ├── Beef, lean minced
│   ├── Niter Kibbeh (sub, yields 2.7 Kg)
│   │   ├── Butter · Ginger · Garlic · Korarima · Besobela
│   ├── Mitmita
│   └── Iodized salt
├── Ayib
├── Gomen
└── Injera (sub, yields 12 pieces)
    ├── Teff flour
    └── Iodized salt        ← salt arrives twice, summed into one line
```

Niter Kibbeh is also pulled directly into Fillet Tibes, so one sub-recipe is
reached from two parents at two different depths.

## How many recipes is "enough"?

`npx tsx scripts/coverage-curve.ts` ranks his own articles by revenue. Writing
171 recipes is not the job:

| Target | Recipes needed | Revenue covered |
| --- | --- | --- |
| 25% | **1** | 2,304,456 ETB |
| 50% | **5** | 4,552,317 ETB |
| 80% | **23** | 6,938,368 ETB |
| 90% | **39** | 7,753,728 ETB |

Yeajet Kitfo alone is 26% of revenue. The eight recipes already seeded cover
44.65% of costable revenue.

Six articles can *never* be costed — 328,374 ETB, 3.68% of sales — because they
name a class of product rather than a product: SOFT DRINK (223,987), BEER
(87,883), SEASONAL FRESH JUICE (16,500), plus the three test articles. That is
the ceiling, and no amount of recipe writing lifts it. Splitting those articles
in the POS is the only fix, which is a conversation for him.

## Open questions for the client

These are modelled as configuration rather than guessed in code, and every
assumed row is marked `is_assumed`:

- **Which sales carry the service charge.** It came to 4.9365% of net, not 10%,
  so roughly half of sales carry it. No flat rate is applied anywhere.
- **Which store each POS category depletes from.** The export carries no outlet
  dimension. `pos_category_store_map` holds the answer; the seeded rows are
  assumptions. CAFE MENU → Bar is the least confident of them.
- **Whether kitchen and bar are separate stores.** Assumed yes, per his spec.
- **Ingredient yield and trim factors** are not modelled yet.
- **Approval levels** — not built, per the brief.

## Found in his own data

- 171 articles, all codes text, all distinct. Three carry no `P-` prefix.
- 21 article names carry stray whitespace. `MOJITO` and ` MOJITO` are two
  different articles at 1,490.68 and 1,614.91. So are the two `SPECIAL TEA`s.
- `Total Tax` is 0.762 birr above a flat 15% of (net + service charge) —
  per-bill rounding across 15,983 items. Reported, never blocking.
- **His workbook under-costs every dish that uses a sub-recipe.** In
  `Recipe Master` the sub-recipe lines are priced at 0, so Classic Beef Burger
  totals 106.15 and leaves out its own 5.64 bun. Continental Breakfast is
  costed at 16.80 with both its sub-recipes omitted. This engine rolls them up.
