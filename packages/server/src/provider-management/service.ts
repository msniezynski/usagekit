import { randomUUID } from "node:crypto";
import type { Catalog } from "@usagekit/providers";
import type { SqliteStore } from "@usagekit/store-sqlite";
import { parseProviderDecimal } from "@usagekit/views";
import type {
  ProviderActionResult,
  ProviderCommand,
  ProviderReconciliation,
} from "@usagekit/views";
import type { Vault } from "../vault.js";
import { createCommandJournal } from "./journal.js";
import { managementReader } from "./read.js";

const unavailable = (
  commandId: string,
  ambiguous = true,
): Extract<ProviderActionResult, { outcome: "unavailable" }> => ({
  commandId,
  outcome: "unavailable",
  ambiguous,
  message: ambiguous
    ? "The original command has no definitive durable result. Do not retry the mutation."
    : "An unresolved command prevents additional local mutations.",
});
export function createProviderManagement({
  store,
  vault,
  catalog,
  now,
}: {
  store: SqliteStore;
  vault: Vault;
  catalog: Catalog;
  now: () => Date;
}) {
  const journal = createCommandJournal(store),
    reader = managementReader(vault, catalog, now);
  function replay(command: ProviderCommand): ProviderActionResult | undefined {
    const row = journal.find(command.commandId);
    if (!row) return undefined;
    if (row.command_hash !== journal.hash(command))
      return {
        commandId: command.commandId,
        outcome: "invalid",
        field: "commandId",
        reason: "Command ID was already used for a different body",
      };
    return journal.decode(row) ?? unavailable(command.commandId);
  }
  function apply(
    command: ProviderCommand,
    target: string | null,
    secrets?: Record<string, string>,
  ): ProviderActionResult {
    const invalid = (field: string, reason: string): ProviderActionResult => ({
      commandId: command.commandId,
      outcome: "invalid",
      field,
      reason,
    });
    if (["funding", "settings", "allocations"].includes(command.kind))
      return invalid("kind", "This local server does not support this provider capability");
    if (!vault.unlocked)
      return { ...unavailable(command.commandId, false), message: "The local vault is locked." };
    const entry =
      "connectionId" in command
        ? vault.describe().find((item) => item.connectionId === command.connectionId)
        : undefined;
    if ("connectionId" in command && (!entry || entry.revision !== command.expectedRevision))
      return {
        commandId: command.commandId,
        outcome: "conflict",
        reason: "Connection revision changed or the connection was removed",
        ...(entry?.revision ? { currentRevision: entry.revision } : {}),
      };
    const provider = "provider" in command ? command.provider : entry?.provider;
    const descriptor = catalog.providers().find((item) => item.id === provider);
    if (!descriptor && command.kind !== "disconnect")
      return invalid("provider", "Provider is not enabled on this local server");
    if ("fundingSource" in command && command.fundingSource !== "byok")
      return invalid("fundingSource", "Only own provider credentials are supported locally");
    if ("credentialRef" in command && command.credentialRef !== undefined)
      return invalid("credentialRef", "OAuth credential references are not supported locally");
    if (command.kind === "test" || command.kind === "connect" || command.kind === "reconnect") {
      if (entry && command.kind === "test" && secrets !== undefined)
        return invalid("secrets", "Use a draft test to validate new credentials");
      const secret =
        entry && command.kind === "test"
          ? vault.get(entry.provider, entry.connectionId)
          : secrets?.secret;
      if (
        !secret?.trim() ||
        /[\r\n\0]/.test(secret) ||
        (descriptor?.auth.kind === "basic" &&
          (!secret.includes(":") || secret.startsWith(":") || secret.endsWith(":")))
      )
        return invalid(
          "secrets",
          "Credentials failed local format validation; no provider request was made",
        );
      if (command.kind === "test")
        return {
          commandId: command.commandId,
          outcome: "success",
          revision: entry?.revision ?? null,
          ...(entry ? { connection: reader.connection(entry.connectionId)! } : {}),
          message: "Format validation only; network=false. Provider authentication was not tested.",
        };
      if (command.kind === "connect")
        vault.put(command.provider, target!, secret, undefined, {
          ...(command.label ? { label: command.label } : {}),
        });
      else vault.put(entry!.provider, entry!.connectionId, secret);
    } else {
      if (secrets !== undefined)
        return invalid("secrets", "This command does not accept credentials");
      if (command.kind === "disconnect") {
        vault.remove(command.connectionId);
        return { commandId: command.commandId, outcome: "success", revision: null };
      }
      if (command.kind !== "rates") return invalid("kind", "Unsupported command");
      const prices = { ...entry!.manualPrices };
      for (const rate of command.rates) {
        if (
          !catalog
            .operationsOf(provider!)
            .some((operation) => operation.id === rate.rateId && operation.billable)
        )
          return invalid("rates", "Rate does not belong to a supported billable operation");
        if (rate.price === null) delete prices[rate.rateId];
        else {
          const parsed = parseProviderDecimal(rate.price, descriptor!.billing.unit);
          if (parsed.outcome !== "valid")
            return invalid("rates", "Rate must be a representable exact nonnegative decimal");
          const quantity = parsed.quantity;
          prices[rate.rateId] = { ...quantity, value: quantity.value.toString() };
        }
      }
      vault.update(entry!.connectionId, { manualPrices: prices });
    }
    const connection = reader.connection(target!)!;
    return {
      commandId: command.commandId,
      outcome: "success",
      revision: connection.revision,
      connection,
    };
  }
  return {
    scopeKey: journal.scopeKey,
    mutationBlocked: journal.pending,
    read: reader.read,
    execute(command: ProviderCommand, secrets?: Record<string, string>): ProviderActionResult {
      const previous = replay(command);
      if (previous) return previous;
      const target =
        "connectionId" in command
          ? command.connectionId
          : command.kind === "connect"
            ? `connection-${randomUUID()}`
            : null;
      if (!journal.begin(command, journal.hash(command), target))
        return unavailable(command.commandId, false);
      // Intent commits before touching the external vault. No await can interleave old API writes.
      try {
        const result = apply(command, target, secrets);
        journal.complete(command.commandId, result);
        return result;
      } catch {
        // Either the external file or the completion journal may have committed. No retry grant.
        return unavailable(command.commandId);
      }
    },
    reconcile(command: ProviderCommand): ProviderReconciliation {
      return replay(command) ?? unavailable(command.commandId);
    },
  };
}
