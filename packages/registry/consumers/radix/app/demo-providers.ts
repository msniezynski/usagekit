import type {
  ProviderActionResult,
  ProviderBinding,
  ProviderCommand,
  ProviderConnection,
  ProviderManagementPort,
  ProviderReadResult,
} from "@usagekit/views";
import {
  connection,
  demoProviders,
  freshness,
  figure,
  initialAllocations,
  initialConnections,
  providerBinding,
} from "./provider-fixtures.js";
export {
  demoProviders,
  initialAllocations,
  initialConnections,
  providerBinding,
} from "./provider-fixtures.js";
/** Local, content-free host stand-in. No provider/network requests, wallet debit or stored secrets. */
export function createDemoProviderPort(scopeKey = "acme") {
  let connections = structuredClone(initialConnections),
    rows = structuredClone(initialAllocations),
    sequence = 1;
  const journal = new Map<string, { command: ProviderCommand; result: ProviderActionResult }>();
  const calls: ProviderCommand[] = [];
  let nextOutcome: "normal" | "conflict" | "unknown" = "normal";
  let allocationRevision = "1";
  const allowed = (binding: ProviderBinding) =>
    binding.scopeKey === scopeKey && binding.principalKey === "owner";
  const success = (commandId: string, item?: ProviderConnection): ProviderActionResult => ({
    outcome: "success",
    commandId,
    revision: item?.revision ?? allocationRevision,
    ...(item ? { connection: structuredClone(item) } : {}),
    message: "Local change applied.",
  });
  const port: ProviderManagementPort = {
    async read(binding, query): Promise<ProviderReadResult> {
      if (!allowed(binding)) return { outcome: "forbidden" };
      const common = {
        state: "ok" as const,
        problem: null,
        asOf: freshness.observedAt,
        revision: allocationRevision,
      };
      const item =
        "connectionId" in query ? connections.find((item) => item.id === query.connectionId) : null;
      const value =
        query.kind === "connections"
          ? {
              ...common,
              kind: query.kind,
              connections: connections.filter(
                (item) => !query.provider || item.provider === query.provider,
              ),
              providers: demoProviders,
            }
          : query.kind === "details"
            ? { ...common, kind: query.kind, connection: item ?? null }
            : query.kind === "allocations"
              ? {
                  ...common,
                  kind: query.kind,
                  rows: rows.filter((row) => query.connectionIds.includes(row.connectionId)),
                }
              : query.kind === "balance"
                ? {
                    ...common,
                    kind: query.kind,
                    balance: item
                      ? {
                          connectionId: item.id,
                          fundingSource: item.fundingSource,
                          authority:
                            item.fundingSource === "byok"
                              ? ("provider" as const)
                              : ("host_wallet" as const),
                          balance: figure(
                            item.fundingSource === "byok" ? "9007199254740993.125" : "100.6250",
                            item.fundingSource === "byok" ? "requests" : "customer_cents",
                          ),
                          reserved: figure(
                            "3",
                            item.fundingSource === "byok" ? "requests" : "customer_cents",
                          ),
                          availability: item.availability,
                          freshness,
                        }
                      : null,
                  }
                : {
                    ...common,
                    kind: query.kind,
                    projection: item
                      ? {
                          connectionId: item.id,
                          quantity: figure(query.quantity, query.unit),
                          providerCost: figure("0.6250", "cents"),
                          customerCharge: figure(
                            item.fundingSource === "byok" ? "0.0000" : "1.0000",
                            "customer_cents",
                          ),
                          canProceed: "yes" as const,
                          freshness,
                        }
                      : null,
                  };
      return { outcome: "ok", value: structuredClone(value) };
    },
    async execute(binding, command, secrets) {
      if (!allowed(binding) || binding.canManage !== true)
        return { outcome: "forbidden", commandId: command.commandId };
      const prior = journal.get(command.commandId);
      if (prior) return structuredClone(prior.result);
      calls.push(structuredClone(command));
      if (nextOutcome === "unknown") {
        nextOutcome = "normal";
        return {
          outcome: "unavailable",
          commandId: command.commandId,
          message: "Local response deliberately delayed. Check change status.",
          ambiguous: true,
        };
      }
      const item =
        "connectionId" in command
          ? connections.find((item) => item.id === command.connectionId)
          : null;
      if (
        nextOutcome === "conflict" ||
        (item && "expectedRevision" in command && item.revision !== command.expectedRevision)
      ) {
        nextOutcome = "normal";
        if (item) item.revision = String(++sequence);
        return {
          outcome: "conflict",
          commandId: command.commandId,
          reason: "A newer connection revision is available.",
          ...(item ? { currentRevision: item.revision } : {}),
        };
      }
      if (
        (command.kind === "connect" ||
          command.kind === "reconnect" ||
          (command.kind === "test" && "provider" in command)) &&
        !("fundingSource" in command && command.fundingSource === "platform") &&
        !secrets?.key?.trim()
      )
        return {
          outcome: "invalid",
          commandId: command.commandId,
          field: "key",
          reason: "Enter an API key.",
        };
      if (command.kind === "allocations") {
        if (
          command.expectedRevision !== allocationRevision ||
          command.changes.some(
            (change) =>
              rows.find((row) => row.id === change.rowId)?.revision !== change.expectedRevision,
          )
        )
          return {
            outcome: "conflict",
            commandId: command.commandId,
            reason: "Allocations changed elsewhere.",
          };
        allocationRevision = String(++sequence);
        rows = rows.map((row) => {
          const change = command.changes.find((change) => change.rowId === row.id);
          return change
            ? {
                ...row,
                revision: allocationRevision,
                unlimited: change.limit === null,
                limit: change.limit == null ? row.limit : figure(change.limit, row.unit),
              }
            : row;
        });
      } else if (command.kind === "connect") {
        const added = connection(
          `local-${++sequence}`,
          command.provider,
          command.label ?? command.provider,
          command.fundingSource,
          connections.length,
        );
        connections.push(added);
        const result = success(command.commandId, added);
        journal.set(command.commandId, { command: structuredClone(command), result });
        return result;
      } else if (item && command.kind !== "test") {
        item.revision = String(++sequence);
        if (command.kind === "disconnect") {
          item.status = { state: "disconnected" };
          item.hasStoredCredentials = false;
        }
        if (command.kind === "reconnect") {
          item.status = { state: "connected" };
          item.hasStoredCredentials = true;
        }
        if (command.kind === "funding") item.fundingSource = command.fundingSource;
        if (command.kind === "settings") Object.assign(item, command.changes);
        if (command.kind === "rates")
          item.rates = item.rates.map((rate) => {
            const change = command.rates.find((change) => change.rateId === rate.id);
            return change
              ? {
                  ...rate,
                  price: figure(change.price ?? "0.6250", "cents"),
                  provenance: {
                    ...rate.provenance,
                    source: change.price === null ? ("list" as const) : ("manual" as const),
                    origin: "host" as const,
                  },
                }
              : rate;
          });
      }
      const result = success(command.commandId, item ?? undefined);
      journal.set(command.commandId, { command: structuredClone(command), result });
      return result;
    },
    async reconcile(binding, command) {
      if (!allowed(binding) || !binding.canManage)
        return { outcome: "forbidden", commandId: command.commandId };
      return structuredClone(
        journal.get(command.commandId)?.result ?? {
          outcome: "not_applied" as const,
          commandId: command.commandId,
        },
      );
    },
  };
  return {
    port,
    binding: { ...providerBinding, scopeKey },
    calls,
    setNextOutcome(value: typeof nextOutcome) {
      nextOutcome = value;
    },
    snapshots: () => ({ connections: structuredClone(connections), rows: structuredClone(rows) }),
  };
}
