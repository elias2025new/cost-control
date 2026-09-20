/**
 * Which item categories may hold stock in which kind of store.
 *
 * Food goes in the kitchen or the main store, beverage goes in the bar or
 * the main store - never the other way round. "Other" (napkins, to-go
 * boxes) has no natural split, so it's allowed anywhere. Pure and
 * dependency-free so both a client-side picker and a server action can
 * enforce the exact same rule.
 */
export function categoryAllowedInStore(categoryKind: string, storeKind: string): boolean {
  if (categoryKind === 'food') return storeKind === 'main' || storeKind === 'kitchen';
  if (categoryKind === 'beverage') return storeKind === 'main' || storeKind === 'bar';
  return true; // 'other'
}
