-- 020_master_data_units_and_shrinkage.sql
-- Phase 1: Re-engineering Materials Control Master Data & Dual Unit Conversion Engine
--
-- Replicates HMC's VPCKEINH (Packaging Units), PRODEINH (Production Units),
-- VPK_INHALT (Packaging Contents Factor), and ART_VERLUST (Shrinkage / Yield Loss).

-- 1. Standard Units of Measure Dictionary
create table if not exists units_of_measure (
  code           text primary key,
  name           text not null,
  dimension      text not null check (dimension in ('weight', 'volume', 'count', 'custom')),
  base_unit      text not null,
  to_base_factor numeric(18,8) not null check (to_base_factor > 0),
  created_at     timestamptz not null default now()
);

-- Seed universal units (metric, bar volume, counts)
insert into units_of_measure (code, name, dimension, base_unit, to_base_factor) values
  -- Weight (base = g)
  ('kg',      'Kilogram',     'weight', 'g', 1000.0),
  ('g',       'Gram',         'weight', 'g', 1.0),
  ('mg',      'Milligram',    'weight', 'g', 0.001),
  ('lb',      'Pound',        'weight', 'g', 453.59237),
  ('oz',      'Ounce',        'weight', 'g', 28.349523125),

  -- Volume (base = ml)
  ('l',       'Liter',        'volume', 'ml', 1000.0),
  ('ml',      'Milliliter',   'volume', 'ml', 1.0),
  ('cl',      'Centiliter',   'volume', 'ml', 10.0),
  ('dl',      'Deciliter',    'volume', 'ml', 100.0),
  ('fl_oz',   'Fluid Ounce',  'volume', 'ml', 29.5735),
  ('gal',     'Gallon (US)',  'volume', 'ml', 3785.41),

  -- Count (base = pc)
  ('pc',      'Piece',        'count',  'pc', 1.0),
  ('each',    'Each',         'count',  'pc', 1.0),
  ('portion', 'Portion',      'count',  'pc', 1.0),
  ('serving', 'Serving',      'count',  'pc', 1.0),
  ('can',     'Can',          'count',  'pc', 1.0),
  ('bottle',  'Bottle',       'count',  'pc', 1.0),
  ('dozen',   'Dozen',        'count',  'pc', 12.0),
  ('box',     'Box / Carton', 'count',  'pc', 1.0),
  ('crate',   'Crate',        'count',  'pc', 1.0),
  ('bag',     'Bag',          'count',  'pc', 1.0),
  ('keg',     'Keg',          'count',  'pc', 1.0)
on conflict (code) do update set
  name = excluded.name,
  dimension = excluded.dimension,
  base_unit = excluded.base_unit,
  to_base_factor = excluded.to_base_factor;

-- 2. Item-Specific Custom Unit Conversions (e.g. density, bottle volume, custom pack sizes)
create table if not exists item_unit_conversions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  item_id     uuid not null references items(id),
  from_uom    text not null,
  to_uom      text not null,
  factor      numeric(18,8) not null check (factor > 0),
  note        text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, item_id, from_uom, to_uom),
  check (from_uom <> to_uom)
);

create index if not exists idx_item_unit_conversions
  on item_unit_conversions (tenant_id, item_id, from_uom, to_uom);

-- 3. Enhance `items` table with HMC Master Data properties:
--    purchase_uom (VPCKEINH)
--    pack_factor (VPK_INHALT)
--    loss_percent (ART_VERLUST / shrinkage)
--    default_store_id (ART_LAGER)
--    abc_class (ART_ABC)
alter table items
  add column if not exists purchase_uom text,
  add column if not exists pack_factor numeric(18,6) not null default 1.0 check (pack_factor > 0),
  add column if not exists loss_percent numeric(5,2) not null default 0.0 check (loss_percent >= 0 and loss_percent < 100),
  add column if not exists default_store_id uuid references stores(id),
  add column if not exists abc_class text check (abc_class in ('A', 'B', 'C')),
  add column if not exists barcode text;

-- Default purchase_uom to item uom if not specified
update items set purchase_uom = uom where purchase_uom is null;

-- 4. Store-specific shrinkage overrides (e.g. kitchen butchery has higher loss than central warehouse)
alter table store_item_levels
  add column if not exists loss_percent numeric(5,2) check (loss_percent is null or (loss_percent >= 0 and loss_percent < 100));

-- 5. Materials Control SQL functions for unit conversions, usable quantity, and effective cost:

-- A. Usable Net Quantity given gross quantity and loss/shrinkage percent
create or replace function item_usable_qty(
  p_gross_qty    numeric,
  p_loss_percent numeric
) returns numeric as $$
  select round(p_gross_qty * (1.0 - (coalesce(p_loss_percent, 0.0) / 100.0)), 6);
$$ language sql immutable;

-- B. Effective Usable Cost per Unit given standard purchase cost and loss percent
--    e.g. 500 ETB/kg with 20% loss = 500 / 0.80 = 625 ETB/kg
create or replace function item_effective_cost(
  p_standard_cost numeric,
  p_loss_percent  numeric
) returns numeric as $$
  select case 
    when coalesce(p_loss_percent, 0.0) >= 100.0 then 0.0
    else round(p_standard_cost / (1.0 - (coalesce(p_loss_percent, 0.0) / 100.0)), 2)
  end;
$$ language sql immutable;

-- C. Universal Unit Conversion Function
create or replace function convert_item_uom(
  p_tenant  uuid,
  p_item    uuid,
  p_qty     numeric,
  p_from    text,
  p_to      text
) returns numeric as $$
declare
  v_from_norm text := lower(trim(p_from));
  v_to_norm   text := lower(trim(p_to));
  v_from_uom  units_of_measure%rowtype;
  v_to_uom    units_of_measure%rowtype;
  v_custom    numeric;
  v_pack_fac  numeric;
  v_item_uom  text;
  v_purch_uom text;
begin
  -- 1. Identity
  if v_from_norm = v_to_norm then
    return p_qty;
  end if;

  -- 2. Item-specific custom conversion table (exact match from -> to)
  select factor into v_custom
    from item_unit_conversions
   where tenant_id = p_tenant
     and item_id   = p_item
     and lower(from_uom) = v_from_norm
     and lower(to_uom)   = v_to_norm
   limit 1;

  if found then
    return round(p_qty * v_custom, 6);
  end if;

  -- Inverse item-specific conversion (to -> from)
  select factor into v_custom
    from item_unit_conversions
   where tenant_id = p_tenant
     and item_id   = p_item
     and lower(from_uom) = v_to_norm
     and lower(to_uom)   = v_from_norm
   limit 1;

  if found and v_custom > 0 then
    return round(p_qty / v_custom, 6);
  end if;

  -- 3. Check item purchase_uom vs recipe/inventory uom via pack_factor
  select lower(uom), lower(coalesce(purchase_uom, uom)), pack_factor
    into v_item_uom, v_purch_uom, v_pack_fac
    from items
   where tenant_id = p_tenant and id = p_item;

  if v_from_norm = v_purch_uom and v_to_norm = v_item_uom then
    return round(p_qty * v_pack_fac, 6);
  end if;

  if v_from_norm = v_item_uom and v_to_norm = v_purch_uom and v_pack_fac > 0 then
    return round(p_qty / v_pack_fac, 6);
  end if;

  -- 4. Universal dimension conversion (weight <-> weight, volume <-> volume, count <-> count)
  select * into v_from_uom from units_of_measure where lower(code) = v_from_norm;
  select * into v_to_uom   from units_of_measure where lower(code) = v_to_norm;

  if v_from_uom.code is not null and v_to_uom.code is not null then
    if v_from_uom.dimension = v_to_uom.dimension and v_from_uom.dimension <> 'custom' then
      -- Convert from -> base -> to
      return round((p_qty * v_from_uom.to_base_factor) / v_to_uom.to_base_factor, 6);
    end if;
  end if;

  -- 5. No conversion found
  raise exception 'Cannot convert % from % to % for item % (no standard or item-specific conversion defined)',
    p_qty, p_from, p_to, p_item
    using errcode = 'data_exception';
end;
$$ language plpgsql stable;
