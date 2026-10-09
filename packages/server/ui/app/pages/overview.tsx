import { useState } from "react";
import type { BudgetsInput } from "@usagekit/views";
import { CoverageSummaryPanel } from "@/components/usagekit/coverage-summary";
import { HeaderStatusPanel } from "@/components/usagekit/header-status";
import { UsageFilters, monthWindow } from "@/components/usagekit/usage-filters";
import { UsageTablePanel } from "@/components/usagekit/usage-table";
import { localScope } from "../session";
import { OverviewSummary } from "./overview-summary";

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
    <section aria-label="Overview" className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <UsageFilters
          period={period}
          periods={periods}
          onPeriodChange={setPeriod}
          scope="local"
          scopes={[{ value: "local", label: "Local server" }]}
          onScopeChange={() => {}}
        />
        {budgetInput && <HeaderStatusPanel {...budgetInput} />}
      </div>
      <OverviewSummary budgetInput={budgetInput} units={units} {...window} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Usage detail" className="min-w-0 space-y-3">
          <h2 className="text-base font-semibold">Usage detail</h2>
          <UsageTablePanel
            key={period}
            scope={localScope}
            {...window}
            units={units}
            groupBy={["provider", "operation"]}
            limit={50}
          />
        </section>
        <CoverageSummaryPanel scope={localScope} {...window} />
      </div>
    </section>
  );
}
