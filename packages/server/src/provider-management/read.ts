import { createHash } from "node:crypto";
import { formatQuantity } from "@usagekit/core";
import type { Catalog } from "@usagekit/providers";
import type {
  ProviderCommand,
  ProviderConnection,
  ProviderDefinition,
  ProviderQuery,
  ProviderReadResult,
} from "@usagekit/views";
import type { Vault } from "../vault.js";

export const localCapabilities: readonly ProviderCommand["kind"][] = [
  "test",
  "reconnect",
  "disconnect",
  "rates",
];
export function managementReader(vault: Vault, catalog: Catalog, now: () => Date) {
  const definitions = (): ProviderDefinition[] =>
    catalog.providers().map((provider) => ({
      id: provider.id,
      label: provider.label,
      fundingSources: ["byok"],
      capabilities: ["connect", "test"],
      credentialFields: [
        {
          name: "secret",
          label: provider.auth.kind === "basic" ? "Login:password" : "API key",
          kind: "secret",
          required: true,
          fundingSources: ["byok"],
        },
      ],
    }));
  const connection = (id: string): ProviderConnection | undefined => {
    const entry = vault.describe().find((item) => item.connectionId === id);
    if (!entry) return undefined;
    const descriptor = catalog.providers().find((provider) => provider.id === entry.provider);
    const unit = descriptor?.billing.unit ?? "unknown";
    const rates = catalog
      .operationsOf(entry.provider)
      .filter((op) => op.billable)
      .map((op) => {
        const manual = entry.manualPrices?.[op.id];
        // Options, overage and unselected plans cannot yield a generic list price.
        const rows =
          descriptor?.prices.filter(
            (row) =>
              row.operation === op.id &&
              !row.option &&
              !row.overage &&
              (row.plan === undefined || row.plan === entry.plan) &&
              row.validFrom <= now().toISOString().slice(0, 10),
          ) ?? [];
        const row = rows.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
        return {
          id: op.id,
          label: op.label,
          operation: op.id,
          unit: "requests",
          priceUnit: unit,
          price: manual
            ? {
                text: formatQuantity({ ...manual, value: BigInt(manual.value) }),
                unit: manual.unit,
                certainty: "estimated" as const,
              }
            : row
              ? { text: row.perUnit, unit: row.unit, certainty: "estimated" as const }
              : ("unavailable" as const),
          fundingSource: "byok" as const,
          editable: !!descriptor && vault.unlocked,
          provenance: {
            source: manual ? ("manual" as const) : row ? ("list" as const) : ("unknown" as const),
            origin: manual ? ("host" as const) : row ? ("catalog" as const) : ("unknown" as const),
            checkedAt: manual ? null : (row?.checkedAt ?? null),
            sampleSize: null,
            version: manual ? (entry.revision ?? null) : (row?.validFrom ?? null),
          },
        };
      });
    return {
      id,
      provider: entry.provider,
      label: entry.label ?? descriptor?.label ?? entry.provider,
      revision: entry.revision ?? "legacy-unverified",
      fundingSource: "byok",
      enabled: !!descriptor,
      priority: 0,
      fallbackChain: [],
      plan: entry.plan ?? null,
      status: {
        state: "unknown",
        message: "Credentials are stored; provider authentication has not been verified.",
      },
      availability: { state: "unknown" },
      freshness: { observedAt: null, stale: true, source: "unknown" },
      capabilities: descriptor ? localCapabilities : ["disconnect"],
      rates,
      hasStoredCredentials: true,
    };
  };
  return {
    connection,
    read(query: ProviderQuery): ProviderReadResult {
      const entries = vault.describe();
      const revision = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
      const base = { asOf: now().toISOString(), revision, problem: null };
      if (query.kind === "connections") {
        const connections = entries
          .filter((entry) => !query.provider || query.provider === entry.provider)
          .map((entry) => connection(entry.connectionId)!);
        return {
          outcome: "ok",
          value: {
            ...base,
            kind: query.kind,
            state: connections.length ? "ok" : "empty",
            connections,
            providers: definitions().filter(
              (provider) => !query.provider || provider.id === query.provider,
            ),
          },
        };
      }
      if (query.kind === "details") {
        const found = connection(query.connectionId);
        return found
          ? { outcome: "ok", value: { ...base, kind: query.kind, state: "ok", connection: found } }
          : { outcome: "invalid", field: "connectionId", reason: "Connection not found" };
      }
      if (query.kind === "allocations")
        return {
          outcome: "unavailable",
          message:
            "Local allocations are managed through Meter budgets, not provider wallet allocations.",
        };
      if (!connection(query.connectionId))
        return { outcome: "invalid", field: "connectionId", reason: "Connection not found" };
      return {
        outcome: "unavailable",
        message:
          query.kind === "balance"
            ? "No retained provider balance evidence is available; reads never probe a provider."
            : "No retained request quote is available; reads never dispatch provider requests.",
      };
    },
  };
}
