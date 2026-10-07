import type { FundingSource } from "@usagekit/core";
import type { Figure, Problem, ViewState } from "./amount.js";

/** Verified host identity for UI fencing, never a substitute for server authorization. */
export type ProviderBinding = {
  /** Stable, host-qualified command-journal authority and tenant/project scope. */
  scopeKey: string;
  principalKey: string;
  authRevision: string;
  canManage?: boolean;
};
export type ProviderFreshness = {
  observedAt: string | null;
  stale: boolean;
  source: "provider" | "host" | "accounting" | "unknown";
};
export type ProviderAvailability = {
  state: "available" | "unavailable" | "unknown";
  reason?: string;
};
export type ProviderCredentialField = {
  name: string;
  label: string;
  kind: "secret" | "text";
  required: boolean;
  /** Defaults to BYOK. Platform funding need not request an own provider key. */
  fundingSources?: readonly FundingSource[];
  placeholder?: string;
};
export type ProviderDefinition = {
  id: string;
  label: string;
  credentialFields: readonly ProviderCredentialField[];
  fundingSources: readonly FundingSource[];
  capabilities: readonly ProviderCommand["kind"][];
};
export type ProviderRate = {
  id: string;
  label: string;
  operation: string;
  unit: string;
  /** Native price denomination, independent of the operation's quantity unit. */
  priceUnit: string;
  price: Figure;
  fundingSource: FundingSource;
  editable: boolean;
  provenance: {
    source: "manual" | "measured" | "list" | "unknown";
    origin: "provider" | "host" | "catalog" | "unknown";
    checkedAt: string | null;
    sampleSize: string | null;
    version: string | null;
  };
};
export type ProviderConnection = {
  id: string;
  provider: string;
  label: string;
  revision: string;
  fundingSource: FundingSource;
  enabled: boolean;
  priority: number;
  fallbackChain: readonly string[];
  plan: string | null;
  status: {
    state: "connected" | "disconnected" | "needs_reauth" | "pending" | "unknown" | "error";
    message?: string;
  };
  availability: ProviderAvailability;
  freshness: ProviderFreshness;
  capabilities: readonly ProviderCommand["kind"][];
  rates: readonly ProviderRate[];
  /** Display label only. Never return credential values or private account references. */
  credentialLabel?: string;
  hasStoredCredentials: boolean;
  credentialIssue?: "missing" | "rejected" | "expired" | "unknown";
};
export type ProviderBalance = {
  connectionId: string;
  fundingSource: FundingSource;
  authority: "provider" | "host_wallet" | "unknown";
  balance: Figure;
  reserved: Figure;
  availability: ProviderAvailability;
  freshness: ProviderFreshness;
};
/** A quote for one proposed request, not a forecast of budget exhaustion. */
export type ProviderProjection = {
  connectionId: string;
  quantity: Figure;
  providerCost: Figure;
  /** Customer charges and provider cost have independent units and authorities. */
  customerCharge: Figure;
  canProceed: "yes" | "no" | "unknown";
  reason?: string;
  freshness: ProviderFreshness;
};
export type ProviderAllocationRow = {
  id: string;
  connectionId: string;
  label: string;
  revision: string;
  fundingSource: FundingSource;
  surface: "app" | "programmatic";
  unit: string;
  limit: Figure;
  unlimited: boolean;
  used: Figure;
  reserved: Figure;
  remaining: Figure;
  available?: Figure;
  availabilityBasis?: "before_reservations" | "after_reservations";
  editable: boolean;
};
type SnapshotBase = {
  state: ViewState;
  problem: Problem | null;
  asOf: string | null;
  revision: string;
};
export type ProviderSnapshot = SnapshotBase &
  (
    | {
        kind: "connections";
        connections: readonly ProviderConnection[];
        providers: readonly ProviderDefinition[];
      }
    | { kind: "details"; connection: ProviderConnection | null }
    | { kind: "balance"; balance: ProviderBalance | null }
    | { kind: "projection"; projection: ProviderProjection | null }
    | { kind: "allocations"; rows: readonly ProviderAllocationRow[] }
  );
export type ProviderQuery =
  | { kind: "connections"; provider?: string }
  | { kind: "details"; connectionId: string }
  | { kind: "balance"; connectionId: string }
  | {
      kind: "projection";
      connectionId: string;
      operation: string;
      quantity: string;
      unit: string;
      surface: "app" | "programmatic";
    }
  | { kind: "allocations"; connectionIds: readonly string[] };
export type ProviderSnapshotOf<K extends ProviderQuery["kind"]> = Extract<
  ProviderSnapshot,
  { kind: K }
>;
export type ProviderReadResult =
  | { outcome: "ok"; value: ProviderSnapshot }
  | { outcome: "forbidden" }
  | { outcome: "invalid"; field: string; reason: string }
  | { outcome: "unavailable"; message: string };
type ExistingCommand = { commandId: string; connectionId: string; expectedRevision: string };
export type ProviderAllocationChange = {
  rowId: string;
  expectedRevision: string;
  /** Omitted means keep, null means clear, and decimal text remains exact. */
  limit?: string | null;
};
/** Content-free commands. Credential material travels only through execute's ephemeral third argument. */
export type ProviderCommand =
  | {
      kind: "connect";
      commandId: string;
      provider: string;
      fundingSource: FundingSource;
      label?: string;
      credentialRef?: string;
    }
  | (ExistingCommand & { kind: "test" })
  | {
      kind: "test";
      commandId: string;
      provider: string;
      fundingSource: FundingSource;
    }
  | (ExistingCommand & { kind: "reconnect"; credentialRef?: string })
  | (ExistingCommand & { kind: "disconnect" })
  | (ExistingCommand & { kind: "funding"; fundingSource: FundingSource })
  | (ExistingCommand & {
      kind: "settings";
      changes: {
        enabled?: boolean;
        priority?: number;
        fallbackChain?: readonly string[];
        plan?: string | null;
      };
    })
  | (ExistingCommand & {
      kind: "rates";
      rates: readonly { rateId: string; price: string | null }[];
    })
  | {
      kind: "allocations";
      commandId: string;
      expectedRevision: string;
      changes: readonly ProviderAllocationChange[];
    };
export type ProviderActionResult = { commandId: string } & (
  | {
      outcome: "success";
      revision: string | null;
      connection?: ProviderConnection;
      message?: string;
    }
  | { outcome: "conflict"; reason: string; currentRevision?: string }
  | { outcome: "invalid"; field: string; reason: string }
  | { outcome: "forbidden" }
  | { outcome: "unavailable"; message: string; ambiguous: boolean }
);
export type ProviderReconciliation =
  | ProviderActionResult
  | { outcome: "not_applied"; commandId: string };
/** Read must return stored evidence; hooks never implicitly test credentials or call a provider. */
export type ProviderManagementPort = {
  read(binding: ProviderBinding, query: ProviderQuery): Promise<ProviderReadResult>;
  execute(
    binding: ProviderBinding,
    command: ProviderCommand,
    secrets?: Readonly<Record<string, string>>,
  ): Promise<ProviderActionResult>;
  /** No secrets and no retry. Only authoritative command-journal proof may return not_applied. */
  reconcile?(binding: ProviderBinding, command: ProviderCommand): Promise<ProviderReconciliation>;
};
