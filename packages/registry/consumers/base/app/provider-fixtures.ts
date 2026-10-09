import type {
  Figure,
  ProviderAllocationRow,
  ProviderBinding,
  ProviderConnection,
  ProviderDefinition,
} from "@usagekit/views";

export const providerBinding: ProviderBinding = {
  scopeKey: "acme",
  principalKey: "owner",
  authRevision: "owner-1",
  canManage: true,
};
export const figure = (text: string, unit = "requests"): Figure => ({
  text,
  unit,
  certainty: "measured",
});
export const freshness = {
  observedAt: "2026-10-07T10:00:00.000Z",
  stale: false,
  source: "host" as const,
};
const capabilities: ProviderConnection["capabilities"] = [
  "test",
  "reconnect",
  "disconnect",
  "funding",
  "settings",
  "rates",
  "allocations",
];
export const demoProviders: ProviderDefinition[] = [
  {
    id: "search",
    label: "Search",
    fundingSources: ["byok", "platform"],
    capabilities: ["connect", "test"],
    credentialFields: [{ name: "key", label: "API key", kind: "secret", required: true }],
  },
  {
    id: "language",
    label: "Language",
    fundingSources: ["byok", "platform"],
    capabilities: ["connect", "test"],
    credentialFields: [{ name: "key", label: "API key", kind: "secret", required: true }],
  },
];
export const connection = (
  id: string,
  provider: string,
  label: string,
  fundingSource: "byok" | "platform",
  priority: number,
): ProviderConnection => ({
  id,
  provider,
  label,
  fundingSource,
  priority,
  enabled: true,
  revision: "1",
  fallbackChain: id === "search-own" ? ["language-platform"] : ["search-own"],
  plan: "Standard",
  status: { state: "connected" },
  availability: { state: "available" },
  freshness,
  capabilities,
  hasStoredCredentials: true,
  credentialLabel: "Configured API key",
  rates: [
    {
      id: "standard",
      label: "Standard request",
      operation: "request",
      unit: "request",
      priceUnit: "cents",
      price: figure("0.6250", "cents"),
      fundingSource,
      editable: true,
      provenance: {
        source: "measured",
        origin: "provider",
        checkedAt: freshness.observedAt,
        sampleSize: "153",
        version: "rate-1",
      },
    },
  ],
});
export const initialConnections = [
  connection("search-own", "search", "Search production", "byok", 0),
  connection("language-platform", "language", "Language shared", "platform", 1),
];
export const initialAllocations: ProviderAllocationRow[] = (["byok", "platform"] as const).flatMap(
  (fundingSource) =>
    (["app", "programmatic"] as const).map((surface) => {
      const unit = fundingSource === "byok" ? "requests" : "customer_cents";
      return {
        id: `${fundingSource}-${surface}`,
        connectionId: "search-own",
        label: `${surface === "app" ? "Application" : "Programmatic"} monthly limit`,
        revision: "1",
        fundingSource,
        surface,
        unit,
        limit: figure(fundingSource === "byok" ? "1000" : "250.0000", unit),
        unlimited: false,
        used: figure("12", unit),
        reserved: figure("3", unit),
        remaining: figure("985", unit),
        available: figure(fundingSource === "byok" ? "9007199254740993.125" : "100.6250", unit),
        availabilityBasis: "after_reservations",
        editable: true,
      };
    }),
);
