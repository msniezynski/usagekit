import type { ProviderCommand, ProviderQuery } from "@usagekit/views";

export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const fields = (
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);
const funding = (value: unknown) => value === "byok" || value === "platform";
const unique = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every(text) &&
  new Set(value).size === value.length;
export const decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{1,38}(\.\d{1,18})?$/.test(value) &&
  value.replace(".", "").length <= 38;

export function parseQuery(value: unknown): ProviderQuery | null {
  if (!object(value)) return null;
  switch (value.kind) {
    case "connections":
      return fields(value, ["kind", "provider"]) &&
        (value.provider === undefined || text(value.provider))
        ? (value as ProviderQuery)
        : null;
    case "details":
    case "balance":
      return fields(value, ["kind", "connectionId"]) && text(value.connectionId)
        ? (value as ProviderQuery)
        : null;
    case "allocations":
      return fields(value, ["kind", "connectionIds"]) && unique(value.connectionIds)
        ? (value as ProviderQuery)
        : null;
    case "projection":
      return fields(value, ["kind", "connectionId", "operation", "quantity", "unit", "surface"]) &&
        [value.connectionId, value.operation, value.unit].every(text) &&
        decimal(value.quantity) &&
        ["app", "programmatic"].includes(String(value.surface))
        ? (value as ProviderQuery)
        : null;
    default:
      return null;
  }
}

export function parseCommand(value: unknown): ProviderCommand | null {
  if (!object(value) || !text(value.commandId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.commandId))
    return null;
  const base = ["kind", "commandId"];
  if (value.kind === "connect" || (value.kind === "test" && value.connectionId === undefined)) {
    return fields(value, [
      ...base,
      "provider",
      "fundingSource",
      ...(value.kind === "connect" ? ["label", "credentialRef"] : []),
    ]) &&
      text(value.provider) &&
      funding(value.fundingSource) &&
      (value.label === undefined || text(value.label)) &&
      (value.credentialRef === undefined || text(value.credentialRef))
      ? (value as ProviderCommand)
      : null;
  }
  if (value.kind === "allocations") {
    return fields(value, [...base, "expectedRevision", "changes"]) &&
      text(value.expectedRevision) &&
      Array.isArray(value.changes) &&
      value.changes.length > 0 &&
      value.changes.length <= 100 &&
      value.changes.every(
        (row) =>
          fields(row, ["rowId", "expectedRevision", "limit"]) &&
          text(row.rowId) &&
          text(row.expectedRevision) &&
          (row.limit === undefined || row.limit === null || decimal(row.limit)),
      )
      ? (value as ProviderCommand)
      : null;
  }
  if (!text(value.connectionId) || !text(value.expectedRevision)) return null;
  const existing = [...base, "connectionId", "expectedRevision"];
  switch (value.kind) {
    case "test":
    case "disconnect":
      return fields(value, existing) ? (value as ProviderCommand) : null;
    case "reconnect":
      return fields(value, [...existing, "credentialRef"]) &&
        (value.credentialRef === undefined || text(value.credentialRef))
        ? (value as ProviderCommand)
        : null;
    case "funding":
      return fields(value, [...existing, "fundingSource"]) && funding(value.fundingSource)
        ? (value as ProviderCommand)
        : null;
    case "settings":
      return fields(value, [...existing, "changes"]) &&
        fields(value.changes, ["enabled", "priority", "fallbackChain", "plan"]) &&
        (value.changes.enabled === undefined || typeof value.changes.enabled === "boolean") &&
        (value.changes.priority === undefined ||
          (Number.isSafeInteger(value.changes.priority) && Number(value.changes.priority) >= 0)) &&
        (value.changes.fallbackChain === undefined || unique(value.changes.fallbackChain)) &&
        (value.changes.plan === undefined ||
          value.changes.plan === null ||
          text(value.changes.plan))
        ? (value as ProviderCommand)
        : null;
    case "rates":
      return fields(value, [...existing, "rates"]) &&
        Array.isArray(value.rates) &&
        value.rates.length > 0 &&
        value.rates.length <= 100 &&
        value.rates.every(
          (row) =>
            fields(row, ["rateId", "price"]) &&
            text(row.rateId) &&
            (row.price === null || decimal(row.price)),
        ) &&
        new Set(value.rates.map((row) => (row as { rateId: string }).rateId)).size ===
          value.rates.length
        ? (value as ProviderCommand)
        : null;
    default:
      return null;
  }
}

export function parseSecrets(value: unknown): Record<string, string> | null | undefined {
  if (value === undefined) return undefined;
  if (!fields(value, ["secret"]) || typeof value.secret !== "string" || value.secret.length > 8192)
    return null;
  return { secret: value.secret };
}

/** Canonical content-free fields only; credential material is never passed here. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
