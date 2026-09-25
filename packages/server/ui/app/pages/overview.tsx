import { useState } from "react";
import type { BudgetsInput } from "@usagekit/views";
import { CoverageSummaryPanel } from "@/components/usagekit/coverage-summary";
import { HeaderStatusPanel } from "@/components/usagekit/header-status";
import { UsageFilters, monthWindow } from "@/components/usagekit/usage-filters";
import { UsageTablePanel } from "@/components/usagekit/usage-table";
import { localScope } from "../session";

const periods = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
];

export function OverviewPage({
  budgetInput,
  units,
  now = new Date(),
}: {
  budgetInput: BudgetsInput | null;
  units: readonly string[];
  now?: Date;
}) {
  const [period, setPeriod] = useState("this");
  const window = monthWindow(now, period === "last" ? -1 : 0);
  return (
    <section className="flex flex-col gap-6">
      {budgetInput && <HeaderStatusPanel {...budgetInput} />}
      <UsageFilters
        period={period}
        periods={periods}
        onPeriodChange={setPeriod}
        scope="local"
        scopes={[{ value: "local", label: "Local server" }]}
        onScopeChange={() => {}}
      />
      <CoverageSummaryPanel scope={localScope} {...window} />
      <UsageTablePanel
        key={period}
        scope={localScope}
        {...window}
        units={units}
        groupBy={["provider", "operation"]}
        limit={50}
      />
    </section>
  );
}
