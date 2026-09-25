/** Block names of the usagekit shadcn registry, in index order. Sources live under registry/. */
export const blockNames = [
  "usage-table",
  "budget-card",
  "header-status",
  "coverage-summary",
  "exceptions-list",
  "usage-filters",
  "connection-list",
] as const;
export type BlockName = (typeof blockNames)[number];
export const variants = ["radix", "base"] as const;
export type Variant = (typeof variants)[number];
/** Blocks whose primitive API differs between Radix and Base UI; the others share one file. */
export const variantSpecific: readonly BlockName[] = [
  "budget-card",
  "header-status",
  "usage-filters",
];
