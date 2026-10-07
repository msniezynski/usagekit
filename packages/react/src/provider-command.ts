import type { ProviderCommand } from "@usagekit/views";
import { retainReadInput } from "./keys.js";

type Validation = { command: ProviderCommand } | { field: string; reason: string };
const invalid = (field: string, reason = "Invalid provider command"): Validation => ({
  field,
  reason,
});
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
function data(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(
    ([key, descriptor]) => keys.includes(key) && !descriptor.get && !descriptor.set,
  );
}
const funding = (value: unknown) => value === "byok" || value === "platform";
const decimal = (value: unknown) => value === null || text(value);

/** Reject extra fields rather than accidentally retaining credentials in a command journal. */
export function retainProviderCommand(input: ProviderCommand): Validation {
  if (
    !data(input, [
      "kind",
      "commandId",
      "provider",
      "fundingSource",
      "label",
      "credentialRef",
      "connectionId",
      "expectedRevision",
      "changes",
      "rates",
    ])
  )
    return invalid("command", "Commands must contain only supported content-free fields");
  if (!text(input.commandId)) return invalid("commandId");
  const common = ["kind", "commandId"];
  if (input.kind === "connect" || (input.kind === "test" && !("connectionId" in input))) {
    const keys =
      input.kind === "connect"
        ? [...common, "provider", "fundingSource", "label", "credentialRef"]
        : [...common, "provider", "fundingSource"];
    if (!data(input, keys) || !text(input.provider) || !funding(input.fundingSource))
      return invalid("provider");
    if ("label" in input && input.label !== undefined && typeof input.label !== "string")
      return invalid("label");
    if ("credentialRef" in input && input.credentialRef !== undefined && !text(input.credentialRef))
      return invalid("credentialRef");
  } else if (input.kind === "allocations") {
    if (
      !data(input, [...common, "expectedRevision", "changes"]) ||
      !text(input.expectedRevision) ||
      !Array.isArray(input.changes) ||
      !input.changes.length
    )
      return invalid("allocations");
    const ids = new Set<string>();
    for (const change of input.changes) {
      if (
        !data(change, ["rowId", "expectedRevision", "limit"]) ||
        !text(change.rowId) ||
        !text(change.expectedRevision) ||
        (change.limit !== undefined && !decimal(change.limit)) ||
        ids.has(change.rowId)
      )
        return invalid("allocations");
      ids.add(change.rowId);
    }
  } else {
    if (!("connectionId" in input) || !text(input.connectionId) || !text(input.expectedRevision))
      return invalid("connection");
    const existing = [...common, "connectionId", "expectedRevision"];
    switch (input.kind) {
      case "test":
      case "disconnect":
        if (!data(input, existing)) return invalid("command");
        break;
      case "reconnect":
        if (
          !data(input, [...existing, "credentialRef"]) ||
          (input.credentialRef !== undefined && !text(input.credentialRef))
        )
          return invalid("credentialRef");
        break;
      case "funding":
        if (!data(input, [...existing, "fundingSource"]) || !funding(input.fundingSource))
          return invalid("fundingSource");
        break;
      case "settings": {
        if (
          !data(input, [...existing, "changes"]) ||
          !data(input.changes, ["enabled", "priority", "fallbackChain", "plan"])
        )
          return invalid("settings");
        const changes = input.changes;
        if (changes.enabled !== undefined && typeof changes.enabled !== "boolean")
          return invalid("enabled");
        if (
          changes.priority !== undefined &&
          (!Number.isSafeInteger(changes.priority) || changes.priority < 0)
        )
          return invalid("priority");
        if (changes.plan !== undefined && changes.plan !== null && !text(changes.plan))
          return invalid("plan");
        if (
          changes.fallbackChain !== undefined &&
          (!Array.isArray(changes.fallbackChain) ||
            !changes.fallbackChain.every(text) ||
            new Set(changes.fallbackChain).size !== changes.fallbackChain.length ||
            changes.fallbackChain.includes(input.connectionId))
        )
          return invalid("fallbackChain");
        break;
      }
      case "rates": {
        if (
          !data(input, [...existing, "rates"]) ||
          !Array.isArray(input.rates) ||
          !input.rates.length
        )
          return invalid("rates");
        const ids = new Set<string>();
        for (const rate of input.rates) {
          if (
            !data(rate, ["rateId", "price"]) ||
            !text(rate.rateId) ||
            !decimal(rate.price) ||
            ids.has(rate.rateId)
          )
            return invalid("rates");
          ids.add(rate.rateId);
        }
        break;
      }
      default:
        return invalid("kind");
    }
  }
  return { command: retainReadInput(input) };
}

export function copyEphemeralSecrets(
  input: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!data(input, Object.keys(input))) throw new TypeError("Invalid credential fields");
  const result: Record<string, string> = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (typeof descriptor.value !== "string") throw new TypeError("Invalid credential fields");
    result[key] = descriptor.value;
  }
  return result;
}
