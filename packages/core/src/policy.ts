import type { BudgetScope, RequestState, Source, Surface } from "./contracts.js";
/** Single source of the default admission order; hosts may permute it, never shorten it. */
export const defaultBudgetOrder: readonly BudgetScope["kind"][] = Object.freeze([
  "platform_pool",
  "principal",
  "group",
  "tag",
  "connection",
  "access_credential",
]);
export const tagPattern = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
/** Sorted unique tags, or null when the list breaks the 1..16 count, format or uniqueness rules. */
export function normalizeTags(tags: readonly string[]): string[] | null {
  if (!Array.isArray(tags) || tags.length < 1 || tags.length > 16) return null;
  if (tags.some((t) => typeof t !== "string" || !tagPattern.test(t))) return null;
  const sorted = [...tags].sort();
  return sorted.some((t, n) => n > 0 && sorted[n - 1] === t) ? null : sorted;
}
const surfaceSources: Readonly<Record<Surface, readonly Source[]>> = Object.freeze({
  app: Object.freeze(["app", "worker"] as const),
  programmatic: Object.freeze(["api", "sdk", "cli", "mcp", "proxy", "import"] as const),
});
/** Sources a surface budget covers. Every Source belongs to exactly one Surface. */
export const sourcesOf = (surface: Surface): readonly Source[] => surfaceSources[surface];
/** True when a budget surface value bounds an operation with this surface and source. */
export const surfaceMatches = (
  budgetSurface: Surface | Source | "any",
  surface: Surface,
  source?: Source,
): boolean =>
  budgetSurface === "any" ||
  budgetSurface === surface ||
  (source !== undefined && budgetSurface === source);
/** Every counted request state, in display order. */
export const requestStates: readonly RequestState[] = Object.freeze([
  "passthrough",
  "unpriced",
  "cached",
  "rate_limited",
]);
