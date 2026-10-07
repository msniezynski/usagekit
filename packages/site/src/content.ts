/** Facts shared by the homepage and the docs. Keep them true to the repository. */
export const runtimeVersion = "0.5.0";
export const npmOrg = "https://www.npmjs.com/org/usagekit";
export const npmPackage = (name: string) => `https://www.npmjs.com/package/@usagekit/${name}`;

export const runtimePackages = [
  { name: "core", description: "The exact Meter contract, quantities and money." },
  { name: "store", description: "Atomic accounting commands and the in-memory Store." },
  { name: "meter", description: "Admission, reservations, settlement and recovery." },
  { name: "providers", description: "Provider catalog, price tables and receipts." },
] as const;
/** The four public packages, installable from npm today. */
export const installPackages = runtimePackages.map(({ name }) => `@usagekit/${name}`);

export const registryBlocks = [
  ["measurement-card", "An exact figure, with certainty."],
  ["usage-summary-cards", "Complete totals for each unit."],
  ["cost-summary-card", "Provider costs by funding source."],
  ["usage-table", "Usage detail and cursor pagination."],
  ["budget-card", "Usage, reservations and headroom."],
  ["budget-editor", "Edit a trusted budget definition."],
  ["budget-manager-panel", "Browse, create and reload budgets."],
  ["header-status", "Compact status across your app."],
  ["coverage-summary", "Tracked and untracked coverage."],
  ["exceptions-list", "Work that needs evidence or recovery."],
  ["usage-filters", "Controlled scope and period choices."],
  ["connection-list", "Funding, plan and tags per connection."],
  ["provider-card", "Connection status, freshness and actions."],
  ["provider-connect-form", "Connect and test through your host port."],
  ["provider-source-selector", "Own keys or platform funding."],
  ["provider-rate-editor", "Exact prices with provenance."],
  ["provider-chain-editor", "Priority, enablement and fallback order."],
  ["provider-balance-card", "Balance authority and data freshness."],
  ["provider-allocation-editor", "Own and hosted limits across app and API."],
  ["provider-manager-panel", "Compose the provider management workflow."],
] as const;

export const readHooks = [
  "useUsageView",
  "useUsageSummary",
  "useBudgetsView",
  "useDefinedBudgets",
  "useHeaderStatus",
  "useCoverageView",
  "useExceptionsView",
] as const;
export const providerHooks = [
  "useProviderConnections",
  "useProviderConnection",
  "useProviderBalance",
  "useProviderProjection",
  "useProviderAllocations",
  "useProviderAction",
  "useBudgetProjection",
] as const;
