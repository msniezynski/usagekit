import type { AccessContext, Meter, UsagePage, UsageQuery } from "@usagekit/core";
import { attempt, failure } from "./amount.js";
import { unavailableSummary, usageSummaryFromPages } from "./usage-summary.js";
import type { UsageSummaryInput, UsageSummaryView } from "./usage-summary.js";

/**
 * Load every page of one fixed watermark. The bound is 20 pages by default and at most 100;
 * an exhausted bound, a cursor cycle or a changed snapshot never yields query totals.
 */
export async function loadUsageSummary(
  meter: Meter,
  access: AccessContext,
  input: UsageSummaryInput,
): Promise<UsageSummaryView> {
  const maxPages = input.maxPages ?? 20;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)
    return unavailableSummary(input.units, "unavailable", {
      kind: "invalid",
      field: "maxPages",
      reason: "expected an integer from 1 to 100",
    });
  const query: UsageQuery = {
    scope: structuredClone(input.scope),
    from: input.from,
    to: input.to,
    units: [...input.units],
    groupBy: [],
    ...(input.connection !== undefined ? { connection: input.connection } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
  const verifiedAccess = structuredClone(access);
  const pages: UsagePage[] = [];
  const cursors = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const result = await attempt(() => meter.usage(verifiedAccess, query));
    if (result.outcome === "forbidden") return unavailableSummary(query.units, "forbidden");
    if (result.outcome === "unavailable")
      return unavailableSummary(query.units, "unavailable", result.problem);
    try {
      pages.push(result.value);
      const view = usageSummaryFromPages(pages, query.units);
      if (view.complete || !view.nextCursor) return view;
      if (cursors.has(view.nextCursor))
        return unavailableSummary(query.units, "unavailable", {
          kind: "invalid",
          field: "pagination",
          reason: "repeated cursor",
        });
      cursors.add(view.nextCursor);
      query.cursor = view.nextCursor;
      if (i + 1 === maxPages) return view;
    } catch (error) {
      return unavailableSummary(query.units, "unavailable", failure(error));
    }
  }
  return unavailableSummary(query.units);
}
