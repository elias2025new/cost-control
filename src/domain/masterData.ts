/**
 * Master Data & Dual Unit Conversion Engine
 *
 * Implements Oracle Hospitality Materials Control (HMC) algorithms:
 * - Dual Unit system: Packaging / Purchasing Unit (VPCKEINH) vs. Recipe / Production Unit (PRODEINH)
 * - Packaging Contents Factor (VPK_INHALT)
 * - Shrinkage & Yield Loss rate (ART_VERLUST)
 * - ABC Inventory Classification (ABC01.QRP)
 */

import Decimal from 'decimal.js';

export type UnitDimension = 'weight' | 'volume' | 'count' | 'custom';

export interface UnitOfMeasure {
  code: string;
  name: string;
  dimension: UnitDimension;
  baseUnit: string;
  toBaseFactor: string; // Decimal string representation
}

export interface ItemMaster {
  id: string;
  code: string;
  name: string;
  uom: string;               // Inventory / Recipe base unit
  purchaseUom?: string;      // Packaging / Purchasing unit (VPCKEINH)
  packFactor?: number | string; // Units per purchase pack (VPK_INHALT)
  lossPercent?: number | string; // Shrinkage / loss percentage (ART_VERLUST)
  defaultStoreId?: string;
  abcClass?: 'A' | 'B' | 'C';
}

export interface ItemCustomConversion {
  fromUom: string;
  toUom: string;
  factor: number | string; // qty_to = qty_from * factor
}

// Universal standard units table
export const STANDARD_UNITS: Record<string, UnitOfMeasure> = {
  // Weight (base: g)
  kg: { code: 'kg', name: 'Kilogram', dimension: 'weight', baseUnit: 'g', toBaseFactor: '1000' },
  g: { code: 'g', name: 'Gram', dimension: 'weight', baseUnit: 'g', toBaseFactor: '1' },
  mg: { code: 'mg', name: 'Milligram', dimension: 'weight', baseUnit: 'g', toBaseFactor: '0.001' },
  lb: { code: 'lb', name: 'Pound', dimension: 'weight', baseUnit: 'g', toBaseFactor: '453.59237' },
  oz: { code: 'oz', name: 'Ounce', dimension: 'weight', baseUnit: 'g', toBaseFactor: '28.349523125' },

  // Volume (base: ml)
  l: { code: 'l', name: 'Liter', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '1000' },
  ml: { code: 'ml', name: 'Milliliter', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '1' },
  cl: { code: 'cl', name: 'Centiliter', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '10' },
  dl: { code: 'dl', name: 'Deciliter', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '100' },
  fl_oz: { code: 'fl_oz', name: 'Fluid Ounce', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '29.5735' },
  gal: { code: 'gal', name: 'Gallon (US)', dimension: 'volume', baseUnit: 'ml', toBaseFactor: '3785.41' },

  // Count (base: pc)
  pc: { code: 'pc', name: 'Piece', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  each: { code: 'each', name: 'Each', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  portion: { code: 'portion', name: 'Portion', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  serving: { code: 'serving', name: 'Serving', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  can: { code: 'can', name: 'Can', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  bottle: { code: 'bottle', name: 'Bottle', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  dozen: { code: 'dozen', name: 'Dozen', dimension: 'count', baseUnit: 'pc', toBaseFactor: '12' },
  box: { code: 'box', name: 'Box / Carton', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  crate: { code: 'crate', name: 'Crate', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  bag: { code: 'bag', name: 'Bag', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
  keg: { code: 'keg', name: 'Keg', dimension: 'count', baseUnit: 'pc', toBaseFactor: '1' },
};

/**
 * Convert quantity between units with high precision using Decimal.js.
 */
export function convertQuantity(opts: {
  item: ItemMaster;
  quantity: number | string | Decimal;
  fromUom: string;
  toUom: string;
  customConversions?: ItemCustomConversion[];
}): Decimal {
  const { item, fromUom, toUom, customConversions = [] } = opts;
  const qty = new Decimal(opts.quantity);
  const fromNorm = fromUom.trim().toLowerCase();
  const toNorm = toUom.trim().toLowerCase();

  // 1. Same unit
  if (fromNorm === toNorm) {
    return qty;
  }

  // 2. Custom item conversions (e.g. 1 bottle -> 750 ml)
  const forwardMatch = customConversions.find(
    (c) => c.fromUom.trim().toLowerCase() === fromNorm && c.toUom.trim().toLowerCase() === toNorm,
  );
  if (forwardMatch) {
    return qty.mul(new Decimal(forwardMatch.factor));
  }

  const inverseMatch = customConversions.find(
    (c) => c.fromUom.trim().toLowerCase() === toNorm && c.toUom.trim().toLowerCase() === fromNorm,
  );
  if (inverseMatch) {
    const factor = new Decimal(inverseMatch.factor);
    if (factor.isZero()) throw new Error(`Invalid zero conversion factor for item ${item.name}`);
    return qty.div(factor);
  }

  // 3. Packaging unit (purchaseUom) <-> Base unit (uom) using packFactor
  const purchaseUomNorm = (item.purchaseUom || item.uom).trim().toLowerCase();
  const baseUomNorm = item.uom.trim().toLowerCase();
  const packFactor = new Decimal(item.packFactor ?? 1);

  if (fromNorm === purchaseUomNorm && toNorm === baseUomNorm) {
    return qty.mul(packFactor);
  }

  if (fromNorm === baseUomNorm && toNorm === purchaseUomNorm) {
    if (packFactor.isZero()) throw new Error(`Invalid zero pack factor for item ${item.name}`);
    return qty.div(packFactor);
  }

  // 4. Standard dimension conversions (weight-to-weight, volume-to-volume, count-to-count)
  const uomFrom = STANDARD_UNITS[fromNorm];
  const uomTo = STANDARD_UNITS[toNorm];

  if (uomFrom && uomTo && uomFrom.dimension === uomTo.dimension && uomFrom.dimension !== 'custom') {
    const qtyInBase = qty.mul(new Decimal(uomFrom.toBaseFactor));
    return qtyInBase.div(new Decimal(uomTo.toBaseFactor));
  }

  // 5. Chained packaging conversion:
  //    e.g. item has purchaseUom='box', packFactor=24, uom='bottle', and custom conversion 1 bottle = 750 ml
  //    convert box -> bottle -> ml
  if (fromNorm === purchaseUomNorm && toNorm !== baseUomNorm) {
    const intermediateQty = qty.mul(packFactor);
    return convertQuantity({
      item,
      quantity: intermediateQty,
      fromUom: baseUomNorm,
      toUom,
      customConversions,
    });
  }

  throw new Error(
    `Cannot convert ${qty.toString()} ${fromUom} to ${toUom} for item "${item.name}" (no standard or custom conversion path found)`,
  );
}

/**
 * Materials Control Yield & Effective Cost Calculations:
 * Usable Quantity = Gross Quantity * (1 - LossPercent / 100)
 * Effective Cost  = Standard Cost / (1 - LossPercent / 100)
 */
export function calculateYieldAndEffectiveCost(opts: {
  standardCost: number | string | Decimal;
  lossPercent: number | string | Decimal;
  grossQuantity?: number | string | Decimal;
}): {
  lossPercent: Decimal;
  yieldPercent: Decimal;
  yieldFactor: Decimal;
  effectiveCost: Decimal;
  usableQuantity?: Decimal;
} {
  const loss = new Decimal(opts.lossPercent);
  if (loss.isNegative() || loss.gte(100)) {
    throw new Error(`Loss percent must be between 0 and 99.99 (got ${loss.toString()})`);
  }

  const yieldFactor = new Decimal(1).sub(loss.div(100));
  const yieldPercent = yieldFactor.mul(100);

  const stdCost = new Decimal(opts.standardCost);
  const effectiveCost = yieldFactor.isZero() ? new Decimal(0) : stdCost.div(yieldFactor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const result: ReturnType<typeof calculateYieldAndEffectiveCost> = {
    lossPercent: loss,
    yieldPercent,
    yieldFactor,
    effectiveCost,
  };

  if (opts.grossQuantity !== undefined) {
    const gross = new Decimal(opts.grossQuantity);
    result.usableQuantity = gross.mul(yieldFactor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  }

  return result;
}

/**
 * Materials Control ABC Inventory Classification Algorithm (ABC01.QRP)
 * Classifies items based on cumulative consumption / purchase value:
 * - Class A: Top items contributing up to 80% of cumulative value (highest priority)
 * - Class B: Next items contributing from 80% to 95% of cumulative value
 * - Class C: Remaining items contributing the bottom 5% of cumulative value
 */
export function classifyInventoryAbc<T extends { itemId: string; totalValue: number | string | Decimal }>(
  items: T[],
): Array<T & { abcClass: 'A' | 'B' | 'C'; cumulativeValuePercent: Decimal }> {
  if (items.length === 0) return [];

  // Sort descending by total value
  const sorted = [...items].sort((a, b) => new Decimal(b.totalValue).cmp(new Decimal(a.totalValue)));

  const grandTotal = sorted.reduce((sum, item) => sum.add(new Decimal(item.totalValue)), new Decimal(0));

  if (grandTotal.isZero()) {
    return sorted.map((item) => ({
      ...item,
      abcClass: 'C',
      cumulativeValuePercent: new Decimal(0),
    }));
  }

  let runningSum = new Decimal(0);

  return sorted.map((item) => {
    runningSum = runningSum.add(new Decimal(item.totalValue));
    const cumulativePercent = runningSum.div(grandTotal).mul(100);

    let abcClass: 'A' | 'B' | 'C' = 'A';
    if (cumulativePercent.gt(95)) {
      abcClass = 'C';
    } else if (cumulativePercent.gt(80)) {
      abcClass = 'B';
    }

    return {
      ...item,
      abcClass,
      cumulativeValuePercent: cumulativePercent.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    };
  });
}
