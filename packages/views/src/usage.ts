import type { AccessContext, Certainty, FundingSource, Meter, UsageQuery } from "@usagekit/core";
import { attempt, costAmount, measurementAmount, weakest } from "./amount.js";
import type { Amount, Figure, Problem, ViewState } from "./amount.js";

export type UsageViewRow = {
  /** Stable key for list rendering: dimensions, funding source and cost owner. */
  key: string;
  dimensions: Readonly<Record<string, string>>;
  /** One entry per requested unit; "unavailable" when the row recorded no figure in it. */
  units: Readonly<Record<string, Figure>>;
  cost: Amount;
  certainty: Certainty;
  fundingSource: FundingSource;
  costOwner: string;
  unknownOperations: string;
};
export type UsageView = {
  state: ViewState;
  units: readonly string[];
  groupBy: UsageQuery["groupBy"];
  rows: readonly UsageViewRow[];
  nextCursor: string | null;
  watermark: string | null;
  asOf: string | null;
  problem: Problem | null;
};

/** One page of usage as exact text. Pass nextCursor back with the same query for the next page. */
export async function loadUsageView(
  meter: Meter,
  access: AccessContext,
  query: UsageQuery,
): Promise<UsageView> {
  const base = {
    units: [...query.units],
    groupBy: [...query.groupBy],
    rows: [],
    nextCursor: null,
    watermark: null,
    asOf: null,
  };
  const result = await attempt(() => meter.usage(access, query));
  if (result.outcome === "forbidden") return { ...base, state: "forbidden", problem: null };
  if (result.outcome === "unavailable")
    return { ...base, state: "unavailable", problem: result.problem };
  const page = result.value;
  const rows = page.rows.map((row): UsageViewRow => {
    const units: Record<string, Figure> = {};
    const certainties: Certainty[] = [row.cost.certainty];
    for (const unit of query.units) {
      const m = row.measurements.find((x) => x.unit === unit);
      units[unit] = m ? measurementAmount(m) : "unavailable";
      if (m) certainties.push(m.certainty);
    }
    return {
      key: JSON.stringify([
        Object.entries(row.dimensions).sort(([a], [b]) => (a < b ? -1 : 1)),
        row.fundingSource,
        row.costOwner,
      ]),
      dimensions: { ...row.dimensions },
      units,
      cost: costAmount(row.cost),
      certainty: weakest(certainties),
      fundingSource: row.fundingSource,
      costOwner: row.costOwner,
      unknownOperations: row.unknownOperations.toString(),
    };
  });
  return {
    ...base,
    state: rows.length ? "ok" : "empty",
    rows,
    nextCursor: page.nextCursor ?? null,
    watermark: page.watermark,
    asOf: page.asOf,
    problem: null,
  };
}
