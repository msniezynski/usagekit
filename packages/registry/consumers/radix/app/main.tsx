import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MeterProvider, ProviderManagementProvider } from "@usagekit/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeaderStatusPanel } from "@/components/usagekit/header-status";
import { UsageFilters } from "@/components/usagekit/usage-filters";
import { UsageSummaryCardsPanel } from "@/components/usagekit/usage-summary-cards";
import { CostSummaryCardPanel } from "@/components/usagekit/cost-summary-card";
import { MeasurementCard } from "@/components/usagekit/measurement-card";
import { UsageTablePanel } from "@/components/usagekit/usage-table";
import { BudgetCardsPanel } from "@/components/usagekit/budget-card";
import { BudgetEditor } from "@/components/usagekit/budget-editor";
import { BudgetManagerPanel } from "@/components/usagekit/budget-manager-panel";
import { CoverageSummaryPanel } from "@/components/usagekit/coverage-summary";
import { ExceptionsListPanel } from "@/components/usagekit/exceptions-list";
import { ConnectionList } from "@/components/usagekit/connection-list";
import { access, createDemoState, initialBudget, owner, period, scope } from "./demo-meter";
import type { DemoState } from "./demo-meter";
import { ProviderManagerPanel } from "@/components/usagekit/provider-manager-panel";
import { ProviderRequestQuotePanel } from "@/components/usagekit/provider-balance-card";
import { createDemoProviderPort, providerBinding } from "./demo-providers";
import "./index.css";

function Showcase() {
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [failed, setFailed] = useState(false);
  const [dark, setDark] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [selectedPeriod, setPeriod] = useState("this");
  const [providers] = useState(createDemoProviderPort);
  useEffect(() => {
    // Host portals mount under body and must inherit the same semantic theme tokens.
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  useEffect(() => {
    let active = true;
    createDemoState().then(
      (value) => {
        if (active) setDemo(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const range =
    selectedPeriod === "this"
      ? period
      : { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
  const query = { scope: owner, ...range, units: ["requests", "tokens", "customer_cents"] };
  const bounds = {
    scope,
    surface: "app" as const,
    units: ["requests"],
    platformPools: ["shared-pool"],
  };
  if (!demo)
    return (
      <p role="status" className="p-6">
        {failed ? "Sample dashboard unavailable." : "Loading sample dashboard…"}
      </p>
    );
  return (
    <MeterProvider
      meter={demo.meter}
      access={access}
      {...(!readOnly ? { budgetWriter: demo.writer } : {})}
    >
      <div>
        <main className="min-h-screen bg-background text-foreground">
          <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">Usage & budgets</h1>
                  <Badge variant="outline">Radix / New York</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Acme workspace · October 2026</p>
                <HeaderStatusPanel {...bounds} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" aria-pressed={dark} onClick={() => setDark(!dark)}>
                  {dark ? "Light theme" : "Dark theme"}
                </Button>
                <Button
                  variant="outline"
                  aria-pressed={readOnly}
                  onClick={() => setReadOnly(!readOnly)}
                >
                  {readOnly ? "Enable editing" : "View only"}
                </Button>
              </div>
            </header>
            <UsageFilters
              period={selectedPeriod}
              periods={[
                { value: "this", label: "October 2026" },
                { value: "last", label: "September 2026" },
              ]}
              onPeriodChange={setPeriod}
              scope="workspace"
              scopes={[{ value: "workspace", label: "Acme workspace" }]}
              onScopeChange={() => {}}
            />
            <UsageSummaryCardsPanel
              {...query}
              unitLabels={{
                requests: "Requests",
                tokens: "Tokens",
                customer_cents: "Customer charges",
              }}
            />
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <CostSummaryCardPanel {...query} />
              <MeasurementCard
                title="Delayed provider proof"
                description="A receipt has not arrived yet."
                value={{ text: "", unit: "requests", certainty: "unknown" }}
              />
            </div>
            <section aria-label="Usage detail" className="space-y-3">
              <h2 className="text-lg font-semibold">Usage detail</h2>
              <UsageTablePanel {...query} groupBy={["provider"]} limit={2} />
            </section>
            <section aria-label="Budget status" className="space-y-3">
              <h2 className="text-lg font-semibold">Budget status</h2>
              <BudgetCardsPanel {...bounds} />
            </section>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <BudgetEditor
                budget={initialBudget}
                title="Monthly requests"
                description="Current limit · resets November 1"
              />
              <BudgetManagerPanel
                scope={owner}
                budgetTitles={{
                  "monthly-requests": "Monthly requests",
                  "monthly-tokens": "Monthly tokens",
                }}
                templates={[
                  {
                    title: "Monthly tokens",
                    description: "Token limit · calendar month",
                    budget: {
                      id: "monthly-tokens",
                      version: 0,
                      scope: owner,
                      surface: "any",
                      unit: "tokens",
                      window: { kind: "calendar_month", timezone: "UTC" },
                    },
                  },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <CoverageSummaryPanel scope={owner} {...range} />
              <section className="min-w-0 space-y-3">
                <h2 className="text-lg font-semibold">Needs attention</h2>
                <ExceptionsListPanel scope={owner} {...range} />
              </section>
            </div>
            <section className="min-w-0 space-y-3">
              <h2 className="text-lg font-semibold">Connections</h2>
              <ConnectionList
                connections={[
                  {
                    id: "search-key",
                    provider: "search",
                    label: "Search production",
                    fundingSource: "byok",
                    tags: ["production"],
                  },
                  {
                    id: "language-key",
                    provider: "language",
                    label: "Language platform",
                    fundingSource: "platform",
                    plan: "Team",
                  },
                ]}
              />
            </section>
            <ProviderManagementProvider
              port={providers.port}
              binding={{ ...providerBinding, canManage: !readOnly }}
            >
              <section aria-label="Provider management" className="space-y-6 min-w-0">
                <ProviderManagerPanel />
                <ProviderRequestQuotePanel
                  query={{
                    kind: "projection",
                    connectionId: "search-own",
                    operation: "request",
                    quantity: "1",
                    unit: "requests",
                    surface: "app",
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => providers.setNextOutcome("conflict")}
                  >
                    Simulate next conflict
                  </Button>
                  <Button
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => providers.setNextOutcome("unknown")}
                  >
                    Simulate next unknown result
                  </Button>
                </div>
              </section>
            </ProviderManagementProvider>
            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              Sample data. Changes stay in this local dashboard.
            </p>
          </div>
        </main>
      </div>
    </MeterProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
);
