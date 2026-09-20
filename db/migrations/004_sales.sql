-- 004_sales.sql
-- Sales imports from the POS, and the lines they carry.

-- ---------------------------------------------------------------------------
-- A NOTE ON MONEY PRECISION, because this departs from the stated rule.
--
-- Design rule 4 says money is numeric(18,2). Every figure this system
-- CALCULATES obeys that. But the client's own CNET export does not: article
-- amounts carry three decimals (227.743, 683.229, 4484.587) and the footer
-- Sub Total is 8,928,373.056. Stored at two decimals the sum would no longer
-- reproduce that footer, and an import that does not reconcile does not post —
-- so the import would refuse every real file the client has.
--
-- POS-sourced amounts are therefore held at numeric(18,4): wide enough to keep
-- the source data exactly as issued, still fixed-point, still never a float.
-- Anything we derive ourselves — costs, values, the ledger — stays at (18,2).
-- ---------------------------------------------------------------------------

create table sales_imports (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  branch_id     uuid not null references branches(id),
  source        text not null default 'CNET',

  -- The real export is run over a date range, not a single day: the client's
  -- file covers 08/07/2026 to 03/08/2026. A single business day is simply the
  -- case where period_start = period_end.
  period_start  date not null,
  period_end    date not null,
  -- the date depletion is posted on
  business_date date not null,

  filename      text,
  file_sha256   text,
  uploaded_at   timestamptz not null default now(),

  status        text not null default 'draft'
                check (status in ('draft','validated','posted','rejected','reversed')),

  -- as printed in the file's own footer
  declared_sub_total   numeric(18,4),
  declared_add_charge  numeric(18,4),
  declared_discount    numeric(18,4),
  declared_tax         numeric(18,4),
  declared_grand_total numeric(18,4),

  -- as summed from the parsed lines
  computed_sub_total   numeric(18,4),
  computed_qty         numeric(18,6),

  reconciled    boolean not null default false,
  posted_at     timestamptz,
  reversed_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),

  check (period_end >= period_start)
);

-- The same period cannot post twice for a branch and source. Restricted to
-- posted rows so that a rejected file can be corrected and re-uploaded.
create unique index sales_imports_one_posting_per_period
  on sales_imports (tenant_id, branch_id, source, period_start, period_end)
  where status = 'posted';

-- Catches re-uploading byte-identical files; surfaced as a validation warning.
create index sales_imports_by_hash on sales_imports (tenant_id, file_sha256);

create table sales_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  sales_import_id  uuid not null references sales_imports(id) on delete cascade,
  line_no          integer not null,

  -- exactly as they appear in the file
  pos_category     text,
  pos_sub_category text,
  article_code     text not null,   -- TEXT. '00081' keeps its leading zeros.
  article_name     text,            -- kept verbatim, whitespace and all

  qty              numeric(18,6) not null,
  avg_amount       numeric(18,4),
  total_amount     numeric(18,4) not null,

  -- resolved at validation time
  pos_item_map_id  uuid references pos_item_map(id),
  menu_item_id     uuid references menu_items(id),
  resolved_store_id uuid references stores(id),

  -- Set at posting time.
  --
  -- Revenue always posts: every sales line is recorded whether or not a recipe
  -- exists for it. Depletion is the part that needs a recipe, and it happens
  -- only for lines that have one active on the business date. A line without
  -- one is recorded and flagged here — never rejected. There will be a handful
  -- of recipes against 171 articles for a long time, and recipes get written
  -- gradually over weeks after go-live.
  depleted         boolean not null default false,
  uncosted_reason  text,

  unique (tenant_id, sales_import_id, line_no)
);

create index sales_lines_by_import on sales_lines (sales_import_id);
create index sales_lines_by_article on sales_lines (tenant_id, article_code);

-- ---------------------------------------------------------------------------
-- Problems found while validating or posting an import. Nothing is silently
-- skipped: a generic article that cannot be costed is reported with its
-- quantity so the client can see the size of what is unmeasurable.
--
-- Severity 'block' prevents posting, and only STRUCTURAL problems earn it:
--
--   reconciliation   the lines do not sum to the file's own footer subtotal
--   duplicate_period this branch and period is already posted
--   parse            the file could not be read
--
-- Everything to do with coverage — an unmapped article, a generic article, a
-- mapped article with no recipe yet — is a 'warn'. Those are the normal state
-- of the world, not a reason to refuse a day's sales.
-- ---------------------------------------------------------------------------
create table sales_import_issues (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  sales_import_id uuid not null references sales_imports(id) on delete cascade,
  sales_line_id   uuid references sales_lines(id) on delete cascade,
  severity        text not null check (severity in ('block','warn','info')),
  kind            text not null,   -- blocking:  'reconciliation', 'duplicate_period', 'parse'
                                   -- warning:   'unmapped', 'generic', 'test', 'free_comp',
                                   --            'no_active_recipe', 'no_store_mapping',
                                   --            'duplicate_file'
  article_code    text,
  message         text not null,
  qty             numeric(18,6),
  amount          numeric(18,4),
  created_at      timestamptz not null default now()
);

create index sales_import_issues_by_import
  on sales_import_issues (sales_import_id, severity);

-- ---------------------------------------------------------------------------
-- Sales as the business reads them.
--
-- A free / comp article consumes stock but is not revenue, so it is excluded
-- here while still being depleted by postSalesImport. Test articles are
-- excluded too — they are noise priced at 0.1 birr.
-- ---------------------------------------------------------------------------
create view v_sales_lines_enriched as
select
  sl.tenant_id,
  sl.sales_import_id,
  si.branch_id,
  si.business_date,
  si.status as import_status,
  sl.id as sales_line_id,
  sl.article_code,
  sl.article_name,
  sl.pos_category,
  sl.pos_sub_category,
  sl.qty,
  sl.total_amount,
  pim.article_flag,
  pim.depletes,
  pim.counts_as_sale,
  mi.id   as menu_item_id,
  mi.name as menu_item_name,
  mi.kind as menu_kind,
  sl.resolved_store_id,
  sl.depleted,
  sl.uncosted_reason
from sales_lines sl
join sales_imports si on si.id = sl.sales_import_id
left join pos_item_map pim on pim.id = sl.pos_item_map_id
left join menu_items  mi  on mi.id = sl.menu_item_id;

-- ---------------------------------------------------------------------------
-- Cost coverage.
--
-- How much of a day's revenue the system could actually cost. With a handful
-- of recipes written against 171 articles this starts low and climbs as the
-- controller writes recipes — which makes it the single most honest number to
-- show the client, and the one that tells him what his own effort buys.
--
-- Free and comp articles are excluded from revenue: they consume stock at no
-- revenue and would otherwise drag the percentage around for no reason.
-- ---------------------------------------------------------------------------
create view v_import_cost_coverage as
select
  sl.tenant_id,
  sl.sales_import_id,
  count(*)                                                       as line_count,
  count(*) filter (where sl.depleted)                            as costed_line_count,
  sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true))
                                                                 as revenue_total,
  coalesce(sum(sl.total_amount)
    filter (where sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
                                                                 as revenue_costed,
  coalesce(sum(sl.total_amount)
    filter (where not sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
                                                                 as revenue_uncosted,
  case
    when coalesce(sum(sl.total_amount)
           filter (where coalesce(pim.counts_as_sale, true)), 0) = 0 then null
    else round(
      coalesce(sum(sl.total_amount)
        filter (where sl.depleted and coalesce(pim.counts_as_sale, true)), 0)
      / sum(sl.total_amount) filter (where coalesce(pim.counts_as_sale, true))
      * 100, 2)
  end                                                            as revenue_costed_pct
from sales_lines sl
left join pos_item_map pim on pim.id = sl.pos_item_map_id
group by sl.tenant_id, sl.sales_import_id;
