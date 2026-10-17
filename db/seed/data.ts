/**
 * Sample master data.
 *
 * EVERYTHING IN THIS FILE IS A BEST GUESS pending the client's confirmation:
 * the ingredient quantities, the standard costs, and which store each POS
 * category depletes from. The articles and their codes are real — they come
 * out of the client's own CNET export — but no real recipe has been supplied
 * yet. Every recipe seeded here is written with is_sample = true and is
 * labelled as such wherever it is shown.
 *
 * The point of guessing plainly and visibly is that the client corrects us,
 * rather than assuming we invented his numbers.
 */

export const TENANT = { code: 'PRIME', name: 'Prime Hospitality Business Group' };
export const BRANCH = { code: 'SIYONAT', name: 'Siyonat Branch' };

export const STORES = [
  { code: 'MAIN', name: 'Central Store (Warehouse)', kind: 'main' as const },
  { code: 'KITCHEN', name: 'Main Kitchen', kind: 'kitchen' as const },
  { code: 'BAR', name: 'Main Bar', kind: 'bar' as const },
  { code: 'PREP', name: 'Pastry & Prep Kitchen', kind: 'prep' as const },
];

export const CATEGORIES = [
  { code: 'MEAT', name: 'Meat', kind: 'food' as const },
  { code: 'DAIRY', name: 'Dairy', kind: 'food' as const },
  { code: 'PRODUCE', name: 'Fresh Produce', kind: 'food' as const },
  { code: 'SPICE', name: 'Spices & Seasoning', kind: 'food' as const },
  { code: 'GRAIN', name: 'Grains & Flour', kind: 'food' as const },
  { code: 'HOTBEV', name: 'Coffee & Tea', kind: 'beverage' as const },
  { code: 'SOFT', name: 'Soft Drinks & Water', kind: 'beverage' as const },
  { code: 'BAR', name: 'Bar & Spirits', kind: 'beverage' as const },
];

/**
 * `outlet` is the store this item is issued to and depleted from, which
 * follows from the POS category mapping below. `cost` is the standard cost in
 * ETB effective from COST_EFFECTIVE_FROM.
 */
export interface SeedItem {
  code: string;
  name: string;
  category: string;
  uom: string;
  cost: string;
  outlet: 'KITCHEN' | 'BAR' | 'PREP';
  openingQty: string;
  /** a second receipt at a different price, so the moving average is visibly moving */
  secondReceipt?: { qty: string; cost: string };
  min?: string;
  max?: string;
  // HMC Master Data additions:
  purchaseUom?: string;
  packFactor?: string;
  lossPercent?: string;
  abcClass?: 'A' | 'B' | 'C';
}

export const COST_EFFECTIVE_FROM = '2026-07-01';

/**
 * Opening quantities are sized to carry the 27-day period in the client's own
 * export (8 July to 3 August 2026) without any item going negative. Yeajet
 * Kitfo alone sold 1,392 in that window, which is 348 Kg of minced beef and
 * 696 pieces of injera.
 */
export const ITEMS: SeedItem[] = [
  // --- kitchen -------------------------------------------------------------
  { code: 'RM-BEEF-KITFO', name: 'Beef, lean minced (kitfo grade)', category: 'MEAT', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '12.0', abcClass: 'A', cost: '1100.00', outlet: 'KITCHEN', openingQty: '300', secondReceipt: { qty: '300', cost: '1150.00' }, min: '60', max: '400' },
  { code: 'RM-BEEF-FILLET', name: 'Beef fillet', category: 'MEAT', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '15.0', abcClass: 'A', cost: '1400.00', outlet: 'KITCHEN', openingQty: '150', secondReceipt: { qty: '150', cost: '1450.00' }, min: '40', max: '220' },
  { code: 'RM-AYIB', name: 'Ayib (Ethiopian cottage cheese)', category: 'DAIRY', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '5.0', abcClass: 'B', cost: '320.00', outlet: 'KITCHEN', openingQty: '200', min: '30', max: '150' },
  { code: 'RM-GOMEN', name: 'Gomen (collard greens)', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '10.0', abcClass: 'B', cost: '60.00', outlet: 'KITCHEN', openingQty: '250', min: '35', max: '190' },
  { code: 'RM-TEFF', name: 'Teff flour', category: 'GRAIN', uom: 'Kg', purchaseUom: 'Bag', packFactor: '50', lossPercent: '2.0', abcClass: 'A', cost: '130.00', outlet: 'KITCHEN', openingQty: '1600', min: '200', max: '1200' },
  { code: 'RM-BUTTER', name: 'Butter (kibe)', category: 'DAIRY', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '8.0', abcClass: 'A', cost: '900.00', outlet: 'KITCHEN', openingQty: '120', min: '15', max: '90' },
  { code: 'RM-ONION', name: 'Red onion', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Bag', packFactor: '25', lossPercent: '10.0', abcClass: 'B', cost: '90.00', outlet: 'KITCHEN', openingQty: '120', min: '20', max: '90' },
  { code: 'RM-TOMATO', name: 'Tomato', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Crate', packFactor: '20', lossPercent: '12.0', abcClass: 'B', cost: '80.00', outlet: 'KITCHEN', openingQty: '100', min: '15', max: '75' },
  { code: 'RM-KARIA', name: 'Green chilli (karia)', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '5.0', abcClass: 'C', cost: '120.00', outlet: 'KITCHEN', openingQty: '25', min: '8', max: '20' },
  { code: 'RM-GINGER', name: 'Ginger', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '14.0', abcClass: 'C', cost: '220.00', outlet: 'KITCHEN', openingQty: '12', min: '4', max: '9' },
  { code: 'RM-GARLIC', name: 'Garlic', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '8.0', abcClass: 'C', cost: '400.00', outlet: 'KITCHEN', openingQty: '12', min: '4', max: '9' },
  { code: 'RM-KORARIMA', name: 'Korarima (Ethiopian cardamom)', category: 'SPICE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '5.0', abcClass: 'A', cost: '2200.00', outlet: 'KITCHEN', openingQty: '5', min: '2', max: '4' },
  { code: 'RM-BESOBELA', name: 'Besobela (sacred basil)', category: 'SPICE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '5.0', abcClass: 'C', cost: '700.00', outlet: 'KITCHEN', openingQty: '4', min: '1', max: '3' },
  { code: 'RM-MITMITA', name: 'Mitmita', category: 'SPICE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '2.0', abcClass: 'B', cost: '900.00', outlet: 'KITCHEN', openingQty: '20', min: '4', max: '15' },
  { code: 'RM-SALT', name: 'Iodized salt', category: 'SPICE', uom: 'Kg', purchaseUom: 'Bag', packFactor: '25', lossPercent: '1.0', abcClass: 'C', cost: '30.00', outlet: 'KITCHEN', openingQty: '40', min: '10', max: '30' },
  { code: 'RM-ROSEMARY', name: 'Rosemary', category: 'SPICE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '10.0', abcClass: 'C', cost: '400.00', outlet: 'KITCHEN', openingQty: '3', min: '1', max: '3' },

  // --- bar -----------------------------------------------------------------
  { code: 'RM-COFFEE', name: 'Coffee beans, roasted', category: 'HOTBEV', uom: 'Kg', purchaseUom: 'Bag', packFactor: '5', lossPercent: '3.0', abcClass: 'A', cost: '750.00', outlet: 'BAR', openingQty: '60', secondReceipt: { qty: '60', cost: '790.00' }, min: '20', max: '90' },
  { code: 'RM-TEALEAF', name: 'Black tea leaves', category: 'HOTBEV', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '2.0', abcClass: 'C', cost: '600.00', outlet: 'BAR', openingQty: '8', min: '3', max: '6' },
  { code: 'RM-MILK', name: 'Fresh milk', category: 'DAIRY', uom: 'Ltr', purchaseUom: 'Crate', packFactor: '10', lossPercent: '2.0', abcClass: 'B', cost: '110.00', outlet: 'BAR', openingQty: '90', min: '20', max: '70' },
  { code: 'RM-SUGAR', name: 'White sugar', category: 'SPICE', uom: 'Kg', purchaseUom: 'Bag', packFactor: '50', lossPercent: '1.0', abcClass: 'B', cost: '90.00', outlet: 'BAR', openingQty: '120', min: '25', max: '90' },
  { code: 'RM-AMBO', name: 'Ambo water 500ml', category: 'SOFT', uom: 'Bottle', purchaseUom: 'Crate', packFactor: '24', lossPercent: '0.0', abcClass: 'B', cost: '45.00', outlet: 'BAR', openingQty: '3000', min: '400', max: '2300' },
  { code: 'RM-WATER-S', name: 'Bottled water, small', category: 'SOFT', uom: 'Bottle', purchaseUom: 'Crate', packFactor: '24', lossPercent: '0.0', abcClass: 'B', cost: '25.00', outlet: 'BAR', openingQty: '3200', min: '450', max: '2400' },
  { code: 'RM-RUM', name: 'White rum', category: 'BAR', uom: 'Ltr', purchaseUom: 'Bottle', packFactor: '0.75', lossPercent: '2.0', abcClass: 'A', cost: '2800.00', outlet: 'BAR', openingQty: '12', min: '3', max: '9' },
  { code: 'RM-MINT', name: 'Fresh mint', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '15.0', abcClass: 'C', cost: '250.00', outlet: 'BAR', openingQty: '4', min: '1', max: '3' },
  { code: 'RM-LIME', name: 'Fresh lime', category: 'PRODUCE', uom: 'Kg', purchaseUom: 'Kg', packFactor: '1', lossPercent: '20.0', abcClass: 'C', cost: '180.00', outlet: 'BAR', openingQty: '10', min: '3', max: '8' },
  { code: 'RM-SODA', name: 'Soda water', category: 'BAR', uom: 'Ltr', purchaseUom: 'Crate', packFactor: '24', lossPercent: '0.0', abcClass: 'B', cost: '120.00', outlet: 'BAR', openingQty: '30', min: '8', max: '23' },
];

export interface SeedItemCustomConversion {
  itemCode: string;
  fromUom: string;
  toUom: string;
  factor: string;
  note?: string;
}

export const ITEM_CUSTOM_CONVERSIONS: SeedItemCustomConversion[] = [
  { itemCode: 'RM-AMBO', fromUom: 'bottle', toUom: 'ml', factor: '500', note: 'Ambo 500ml glass bottle' },
  { itemCode: 'RM-WATER-S', fromUom: 'bottle', toUom: 'ml', factor: '500', note: 'Small 500ml plastic water bottle' },
  { itemCode: 'RM-RUM', fromUom: 'bottle', toUom: 'ml', factor: '750', note: 'Standard 750ml liquor bottle' },
];

/**
 * Menu items, each tied to a real article code out of the client's export.
 *
 * Note P-00257 MOJITO rather than P-00402 ' MOJITO'. Those are two different
 * articles at two different prices (1,490.68 and 1,614.91) whose names differ
 * only by a leading space. Mapping by name would silently merge them.
 */
export interface SeedMenuItem {
  code: string;
  name: string;
  kind: 'food' | 'beverage' | 'other';
  articleCode: string;
  /** for reference in the demo, straight out of the export */
  posAvgPrice: string;
}

export const MENU_ITEMS: SeedMenuItem[] = [
  { code: 'MI-KITFO', name: 'Yeajet Kitfo', kind: 'food', articleCode: 'P-00001', posAvgPrice: '1655.50' },
  { code: 'MI-FILLET', name: 'Fillet Tibes', kind: 'food', articleCode: 'P-00020', posAvgPrice: '1324.22' },
  { code: 'MI-TRADCOF', name: 'Traditional Coffee', kind: 'beverage', articleCode: 'P-00054', posAvgPrice: '107.66' },
  { code: 'MI-MACC', name: 'Macchiato', kind: 'beverage', articleCode: 'P-00056', posAvgPrice: '165.63' },
  { code: 'MI-TEA', name: 'Tea', kind: 'beverage', articleCode: 'P-00057', posAvgPrice: '78.68' },
  { code: 'MI-AMBO', name: 'Ambo Water', kind: 'beverage', articleCode: 'P-00045', posAvgPrice: '124.24' },
  { code: 'MI-WATER', name: 'Small Water', kind: 'beverage', articleCode: 'P-00051', posAvgPrice: '99.38' },
  { code: 'MI-MOJITO', name: 'Mojito', kind: 'beverage', articleCode: 'P-00257', posAvgPrice: '1490.68' },
];

/**
 * Free and complimentary articles: real stock leaves the building at no
 * revenue, so all four are excluded from sales whether or not we can cost them.
 *
 * Two of them name a product we hold and so deplete stock. FREE SOFT DRINK
 * names a class rather than a product, and we carry no Novida — those two are
 * still kept out of revenue, because counting 0.03 birr of FREE NOVIDA as a
 * sale is wrong however small it is.
 */
export const FREE_ARTICLE_MAPPINGS: {
  articleCode: string;
  menuItem: string | null;
  note: string;
}[] = [
  { articleCode: 'P-00192', menuItem: 'MI-WATER', note: 'FREE WATER — depletes stock, not revenue' },
  { articleCode: 'P-00196', menuItem: 'MI-AMBO', note: 'FREE AMBO — depletes stock, not revenue' },
  { articleCode: 'P-00195', menuItem: null, note: 'FREE SOFT DRINK — not revenue; names a class of product, so it cannot be costed' },
  { articleCode: 'P-00197', menuItem: null, note: 'FREE NOVIDA — not revenue; no Novida item is stocked yet' },
];

/**
 * Articles that name a class of product rather than a product. No recipe can
 * exist for them, so they can never be costed — and between them they are
 * 2,226 units of the client's month. Flagged loudly, never skipped silently.
 */
export const GENERIC_ARTICLE_CODES = ['P-00052', 'P-00046', '00081'];
//                                     SOFT DRINK  BEER      SEASONAL FRESH JUICE

/** Test articles live in production, all priced around 0.1 birr. */
export const TEST_ARTICLE_CODES = ['P-00129', 'P-00000', 'P-00172'];
//                                  TEST DRINK  TEST FOOD  TEST

/**
 * Which store does a POS category deplete from?
 *
 * The export carries no outlet dimension, so category is the only proxy we
 * have and this mapping is our assumption, not the client's answer. Every row
 * is marked is_assumed and shown to him as an open question.
 *
 * CAFE MENU is the least obvious: traditional coffee is brewed at the coffee
 * station, which may belong to neither the kitchen nor the bar.
 */
export const CATEGORY_STORE_MAP: {
  category: string;
  subCategory: string | null;
  store: string;
  note: string;
}[] = [
  { category: 'FOOD', subCategory: null, store: 'KITCHEN', note: 'Assumed: food is prepared in the kitchen.' },
  { category: 'BEVERAGE', subCategory: null, store: 'BAR', note: 'Assumed: beverages are poured at the bar.' },
  { category: 'CAFE MENU', subCategory: null, store: 'BAR', note: 'ASSUMED — confirm with client. Traditional coffee may be its own station rather than the bar.' },
  { category: 'EXTRAS', subCategory: 'TAKEAWAY BOX', store: 'KITCHEN', note: 'Assumed: packaging is held in the kitchen.' },
  { category: 'EXTRAS', subCategory: 'FREE EXTRA', store: 'BAR', note: 'Assumed: the free extras are all drinks.' },
];

/* ------------------------------------------------------------------ recipes */

export interface SeedRecipeLine {
  item?: string;
  recipe?: string;
  qty: string;
  note?: string;
}

export interface SeedRecipe {
  code: string;
  name: string;
  kind: 'menu' | 'sub';
  menuItem?: string;
  batchYieldQty?: string;
  batchYieldUom?: string;
  lines: SeedRecipeLine[];
}

export const RECIPE_EFFECTIVE_FROM = '2026-07-01';

/**
 * Sub-recipes, costed once over a batch and pulled into a parent at cost per
 * unit. Niter Kibbeh is deliberately used by two different parents at two
 * different depths, and Kitfo Base pulls it in turn — so the tree is three
 * levels deep and an ingredient (salt) is reached by two separate branches.
 */
export const SUB_RECIPES: SeedRecipe[] = [
  {
    code: 'SR-NITER',
    name: 'Niter Kibbeh (spiced clarified butter)',
    kind: 'sub',
    batchYieldQty: '2.7',
    batchYieldUom: 'Kg',
    lines: [
      { item: 'RM-BUTTER', qty: '3' },
      { item: 'RM-GINGER', qty: '0.05' },
      { item: 'RM-GARLIC', qty: '0.05' },
      { item: 'RM-KORARIMA', qty: '0.02' },
      { item: 'RM-BESOBELA', qty: '0.02' },
    ],
  },
  {
    code: 'SR-INJERA',
    name: 'Injera',
    kind: 'sub',
    batchYieldQty: '12',
    batchYieldUom: 'Pcs',
    lines: [
      { item: 'RM-TEFF', qty: '3' },
      { item: 'RM-SALT', qty: '0.01' },
    ],
  },
  {
    code: 'SR-KITFOBASE',
    name: 'Kitfo Base',
    kind: 'sub',
    batchYieldQty: '4',
    batchYieldUom: 'Portion',
    lines: [
      { item: 'RM-BEEF-KITFO', qty: '1' },
      { recipe: 'SR-NITER', qty: '0.12', note: 'sub-recipe inside a sub-recipe' },
      { item: 'RM-MITMITA', qty: '0.02' },
      { item: 'RM-SALT', qty: '0.005' },
    ],
  },
  {
    code: 'SR-SYRUP',
    name: 'Mojito Syrup Base',
    kind: 'sub',
    batchYieldQty: '20',
    batchYieldUom: 'Serving',
    lines: [
      { item: 'RM-SUGAR', qty: '0.5' },
      { item: 'RM-MINT', qty: '0.1' },
      { item: 'RM-LIME', qty: '0.3' },
    ],
  },
];

export const MENU_RECIPES: SeedRecipe[] = [
  {
    code: 'RC-KITFO',
    name: 'Yeajet Kitfo',
    kind: 'menu',
    menuItem: 'MI-KITFO',
    lines: [
      { recipe: 'SR-KITFOBASE', qty: '1' },
      { item: 'RM-AYIB', qty: '0.08' },
      { item: 'RM-GOMEN', qty: '0.1' },
      { recipe: 'SR-INJERA', qty: '2' },
    ],
  },
  {
    code: 'RC-FILLET',
    name: 'Fillet Tibes',
    kind: 'menu',
    menuItem: 'MI-FILLET',
    lines: [
      { item: 'RM-BEEF-FILLET', qty: '0.25' },
      { recipe: 'SR-NITER', qty: '0.02' },
      { item: 'RM-ONION', qty: '0.08' },
      { item: 'RM-TOMATO', qty: '0.06' },
      { item: 'RM-KARIA', qty: '0.02' },
      { item: 'RM-ROSEMARY', qty: '0.002' },
      { recipe: 'SR-INJERA', qty: '2' },
    ],
  },
  {
    code: 'RC-TRADCOF',
    name: 'Traditional Coffee',
    kind: 'menu',
    menuItem: 'MI-TRADCOF',
    lines: [
      { item: 'RM-COFFEE', qty: '0.022' },
      { item: 'RM-SUGAR', qty: '0.012' },
    ],
  },
  {
    code: 'RC-MACC',
    name: 'Macchiato',
    kind: 'menu',
    menuItem: 'MI-MACC',
    lines: [
      { item: 'RM-COFFEE', qty: '0.018' },
      { item: 'RM-MILK', qty: '0.05' },
      { item: 'RM-SUGAR', qty: '0.008' },
    ],
  },
  {
    code: 'RC-TEA',
    name: 'Tea',
    kind: 'menu',
    menuItem: 'MI-TEA',
    lines: [
      { item: 'RM-TEALEAF', qty: '0.004' },
      { item: 'RM-SUGAR', qty: '0.012' },
    ],
  },
  {
    code: 'RC-AMBO',
    name: 'Ambo Water',
    kind: 'menu',
    menuItem: 'MI-AMBO',
    lines: [{ item: 'RM-AMBO', qty: '1', note: 'bought for resale, no preparation' }],
  },
  {
    code: 'RC-WATER',
    name: 'Small Water',
    kind: 'menu',
    menuItem: 'MI-WATER',
    lines: [{ item: 'RM-WATER-S', qty: '1', note: 'bought for resale, no preparation' }],
  },
  {
    code: 'RC-MOJITO',
    name: 'Mojito',
    kind: 'menu',
    menuItem: 'MI-MOJITO',
    lines: [
      { item: 'RM-RUM', qty: '0.05' },
      { recipe: 'SR-SYRUP', qty: '1' },
      { item: 'RM-SODA', qty: '0.15' },
      { item: 'RM-LIME', qty: '0.02' },
    ],
  },
];

export interface SeedSupplier {
  code: string;
  name: string;
  contact?: string;
}

export const SUPPLIERS: SeedSupplier[] = [
  { code: 'SUP-MEAT', name: 'Addis Abattoir Enterprise', contact: '+251-11-442-1234' },
  { code: 'SUP-BGI', name: 'BGI Ethiopia Beverages', contact: '+251-11-551-5000' },
  { code: 'SUP-GRAIN', name: 'Merkato Wholesale Grain Traders', contact: '+251-11-275-8899' },
  { code: 'SUP-PRODUCE', name: 'Atkilt Tera Fresh Farm Supply', contact: '+251-11-277-3344' },
  { code: 'SUP-DAIRY', name: 'Shola Dairy & Sidama Coffee', contact: '+251-11-646-7788' },
];

export interface SeedSupplierPrice {
  supplierCode: string;
  itemCode: string;
  supplierItemCode?: string;
  purchaseUom: string;
  packFactor: string;
  contractPrice: string;
  taxRate?: string;
  minOrderQty?: string;
  leadTimeDays?: number;
  isPreferred?: boolean;
}

export const SUPPLIER_PRICES: SeedSupplierPrice[] = [
  // Meat
  { supplierCode: 'SUP-MEAT', itemCode: 'RM-BEEF-KITFO', purchaseUom: 'Kg', packFactor: '1', contractPrice: '1100.00', minOrderQty: '20', leadTimeDays: 1, isPreferred: true },
  { supplierCode: 'SUP-MEAT', itemCode: 'RM-BEEF-FILLET', purchaseUom: 'Kg', packFactor: '1', contractPrice: '1400.00', minOrderQty: '10', leadTimeDays: 1, isPreferred: true },

  // Beverages
  { supplierCode: 'SUP-BGI', itemCode: 'RM-AMBO', purchaseUom: 'Crate', packFactor: '24', contractPrice: '1080.00', minOrderQty: '5', leadTimeDays: 2, isPreferred: true },
  { supplierCode: 'SUP-BGI', itemCode: 'RM-WATER-S', purchaseUom: 'Crate', packFactor: '24', contractPrice: '600.00', minOrderQty: '10', leadTimeDays: 2, isPreferred: true },
  { supplierCode: 'SUP-BGI', itemCode: 'RM-SODA', purchaseUom: 'Crate', packFactor: '24', contractPrice: '2880.00', minOrderQty: '2', leadTimeDays: 2, isPreferred: true },

  // Grains & Sugar
  { supplierCode: 'SUP-GRAIN', itemCode: 'RM-TEFF', purchaseUom: 'Bag', packFactor: '50', contractPrice: '6500.00', minOrderQty: '5', leadTimeDays: 3, isPreferred: true },
  { supplierCode: 'SUP-GRAIN', itemCode: 'RM-SUGAR', purchaseUom: 'Bag', packFactor: '50', contractPrice: '4500.00', minOrderQty: '2', leadTimeDays: 2, isPreferred: true },
  { supplierCode: 'SUP-GRAIN', itemCode: 'RM-SALT', purchaseUom: 'Bag', packFactor: '25', contractPrice: '750.00', minOrderQty: '1', leadTimeDays: 2, isPreferred: true },

  // Produce
  { supplierCode: 'SUP-PRODUCE', itemCode: 'RM-ONION', purchaseUom: 'Bag', packFactor: '25', contractPrice: '2250.00', minOrderQty: '2', leadTimeDays: 1, isPreferred: true },
  { supplierCode: 'SUP-PRODUCE', itemCode: 'RM-TOMATO', purchaseUom: 'Crate', packFactor: '20', contractPrice: '1600.00', minOrderQty: '2', leadTimeDays: 1, isPreferred: true },

  // Dairy & Coffee
  { supplierCode: 'SUP-DAIRY', itemCode: 'RM-BUTTER', purchaseUom: 'Kg', packFactor: '1', contractPrice: '900.00', minOrderQty: '5', leadTimeDays: 1, isPreferred: true },
  { supplierCode: 'SUP-DAIRY', itemCode: 'RM-MILK', purchaseUom: 'Crate', packFactor: '10', contractPrice: '1100.00', minOrderQty: '3', leadTimeDays: 1, isPreferred: true },
  { supplierCode: 'SUP-DAIRY', itemCode: 'RM-COFFEE', purchaseUom: 'Bag', packFactor: '5', contractPrice: '3750.00', minOrderQty: '2', leadTimeDays: 2, isPreferred: true },
];

export interface SeedStaffUser {
  username: string;
  password: string;
  displayName: string;
  role: 'admin' | 'store_user';
  departmentGroup: 'admin' | 'controller' | 'storekeeper' | 'chef' | 'bar';
  storeCode?: string;
  allStoresAccess?: boolean;
  documentVisibility?: 'all' | 'department' | 'own';
  permissions: string[];
}

export const SEED_STAFF_USERS: SeedStaffUser[] = [
  {
    username: 'admin',
    password: 'password123',
    displayName: 'General Manager (Admin)',
    role: 'admin',
    departmentGroup: 'admin',
    allStoresAccess: true,
    documentVisibility: 'all',
    permissions: ['all'],
  },
  {
    username: 'controller',
    password: 'password123',
    displayName: 'F&B Cost Controller',
    role: 'store_user',
    departmentGroup: 'controller',
    allStoresAccess: true,
    documentVisibility: 'all',
    permissions: [
      'sales_eod_upload',
      'sales_view',
      'price_override_approve',
      'recount_authorize',
      'waste_approve',
      'reports_view',
      'variance_view',
      'ledger_view',
      'recipe_view',
      'recipe_cost_manage',
    ],
  },
  {
    username: 'storekeeper',
    password: 'password123',
    displayName: 'Central Storekeeper',
    role: 'store_user',
    departmentGroup: 'storekeeper',
    storeCode: 'MAIN',
    allStoresAccess: false,
    documentVisibility: 'all',
    permissions: [
      'po_create',
      'purchase_receive',
      'issue_fulfill',
      'transfer_manage',
      'count_entry',
      'waste_log',
      'ledger_view',
    ],
  },
  {
    username: 'chef',
    password: 'password123',
    displayName: 'Executive Chef',
    role: 'store_user',
    departmentGroup: 'chef',
    storeCode: 'KITCHEN',
    allStoresAccess: false,
    documentVisibility: 'department',
    permissions: [
      'issue_request',
      'issue_authorize',
      'butcher_test',
      'production_batch',
      'waste_log',
      'count_entry',
      'recipe_view',
      'ledger_view',
    ],
  },
  {
    username: 'bar',
    password: 'password123',
    displayName: 'Bar Manager',
    role: 'store_user',
    departmentGroup: 'bar',
    storeCode: 'BAR',
    allStoresAccess: false,
    documentVisibility: 'department',
    permissions: [
      'issue_request',
      'transfer_manage',
      'waste_log',
      'count_entry',
      'recipe_view',
      'ledger_view',
    ],
  },
];

