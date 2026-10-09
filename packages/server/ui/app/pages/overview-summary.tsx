import { useBudgetsView, useUsageSummary } from "@usagekit/react";
import type { BudgetRow, BudgetsInput, Figure } from "@usagekit/views";
import { UsageOverviewCard } from "@/components/usagekit/usage-overview-card";
import { localScope } from "../session";

function figure(value: Figure | undefined, readable: boolean): string {
  if (!readable || value === undefined || value === "unavailable") return "Unavailable";
  if (value.certainty === "unknown") return "Unknown";
  return `${value.text} ${value.unit}`;
}

type Level = "ok" | "warning" | "exceeded";
type Tightest = { row: BudgetRow; level: Level; percent: number };
const severity: Record<Level, number> = { ok: 0, warning: 1, exceeded: 2 };
/**
 * The applicable budget closest to blocking: the severest level, which counts reservations,
 * alerts and hard limits, then the largest share used. Percent drives meter geometry only.
 */
function tightest(rows: readonly BudgetRow[]): Tightest | null {
  let best: Tightest | null = null;
  for (const row of rows) {
    if (row.redacted || row.level === "unavailable" || !row.used || !row.limit) continue;
    if (row.used === "unavailable" || row.used.certainty === "unknown") continue;
    if (row.limit === "unavailable" || row.limit === "unlimited") continue;
    const limit = Number.parseFloat(row.limit.text);
    if (!(limit > 0)) continue;
    const percent = (Number.parseFloat(row.used.text) / limit) * 100;
    const level = row.level;
    const severer = best ? severity[level] - severity[best.level] : 1;
    if (severer > 0 || (severer === 0 && best && percent > best.percent))
      best = { row, level, percent };
  }
  return best;
}

/** Host adapter for the same registry card used with native accounting by other hosts. */
type OverviewSummaryProps = {
  budgetInput: BudgetsInput | null;
  units: readonly string[];
  from: string;
  to: string;
};

export function OverviewSummary(props: OverviewSummaryProps) {
  return props.budgetInput ? (
    <ConnectionSummary {...props} budgetInput={props.budgetInput} />
  ) : (
    <SummaryCard {...props} budget={{ value: "No connection selected" }} />
  );
}

function ConnectionSummary(props: OverviewSummaryProps & { budgetInput: BudgetsInput }) {
  const budgets = useBudgetsView(props.budgetInput);
  const readable = budgets.state === "ok" || budgets.state === "empty";
  const rows = readable ? (budgets.data?.rows ?? []) : [];
  const top = tightest(rows);
  if (!readable)
    return (
      <SummaryCard
        {...props}
        budget={{ value: budgets.state === "loading" ? "" : "Unavailable" }}
        loadingBudgets={budgets.state === "loading"}
      />
    );
  if (!top) return <SummaryCard {...props} budget={{ value: `${rows.length} applicable` }} />;
  const percent = Math.floor(top.percent);
  const used = top.row.used === "unavailable" ? "" : top.row.used.text;
  const limit =
    top.row.limit === "unavailable" || top.row.limit === "unlimited" ? "" : top.row.limit.text;
  const reserved =
    top.row.reserved !== "unavailable" && top.row.reserved.certainty !== "unknown"
      ? top.row.reserved.text
      : "0";
  const share = `${used} of ${limit} ${top.row.unit}`;
  const held = reserved === "0" ? "" : `, ${reserved} reserved`;
  return (
    <SummaryCard
      {...props}
      budget={{
        value: `${share} used${held}`,
        figure: top.percent > 0 && top.percent < 1 ? "<1%" : `${percent}%`,
        caption: `Tightest: ${top.row.kind} ${top.row.target}, ${share}${held}`,
        percent: top.percent,
        partial: false,
        level: top.level,
      }}
    />
  );
}

function SummaryCard({
  units,
  from,
  to,
  budget,
  loadingBudgets = false,
}: OverviewSummaryProps & {
  budget: {
    value: string;
    figure?: string;
    caption?: string;
    percent?: number;
    partial?: boolean;
    level?: Level;
  };
  loadingBudgets?: boolean;
}) {
  const summary = useUsageSummary({ scope: localScope, units, from, to });
  const readable =
    (summary.state === "ok" || summary.state === "empty") && summary.data?.complete === true;
  return (
    <UsageOverviewCard
      title="Usage overview"
      description="Provider usage for the selected period."
      loading={summary.state === "loading" || loadingBudgets}
      budget={{
        label: "Budget used",
        percent: budget.percent ?? null,
        partial: budget.partial ?? false,
        warningAt: 80,
        ...budget,
      }}
      metrics={[
        { id: "cost", label: "Provider cost", value: figure(summary.data?.cost, readable) },
        ...units.map((unit) => ({
          id: unit,
          label: unit,
          value: figure(summary.data?.measurements[unit], readable),
        })),
      ]}
      empty=""
    />
  );
}
