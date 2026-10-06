import { decodeMeterJson } from "@usagekit/core";
import type { WireInputs, RouteName } from "@usagekit/http";
export class RemoteUnavailable extends Error {
  constructor(readonly requestId: string) {
    super(`Remote unavailable; request ${requestId}`);
    this.name = "RemoteUnavailable";
  }
}
export class RemoteHttpError extends Error {
  constructor(
    readonly status: number,
    readonly requestId: string,
  ) {
    super(`Remote HTTP ${status}; request ${requestId}`);
    this.name = "RemoteHttpError";
  }
}
export const encode = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
export const decode = decodeMeterJson;
/** Route paths, mirrored from the handler's route table (the client imports only types from it). */
const paths: Record<Exclude<RouteName, "operation">, string> = {
  importBilling: "/v1/billing/import",
  billingImports: "/v1/billing/imports",
  expire: "/v1/operations/expire",
  reserve: "/v1/operations/reserve",
  intent: "/v1/operations/intent",
  renew: "/v1/operations/renew",
  claim: "/v1/operations/claim",
  settle: "/v1/operations/settle",
  correct: "/v1/operations/correct",
  release: "/v1/operations/release",
  count: "/v1/requests/count",
  usage: "/v1/usage",
  operations: "/v1/operations",
  defined: "/v1/budgets/defined",
  applicable: "/v1/budgets/applicable",
  counts: "/v1/requests/counts",
};
export type RemoteOptions = { baseUrl: string; token: string; fetch?: typeof globalThis.fetch };
export function transport({ baseUrl, token, fetch: fetcher = globalThis.fetch }: RemoteOptions) {
  return async <T>(name: RouteName, input: unknown, read = false): Promise<T> => {
    const raw = input as Record<string, unknown>,
      id =
        typeof raw.commandId === "string"
          ? raw.commandId
          : name === "importBilling"
            ? String(raw.fileHash)
            : name === "reserve"
              ? String(raw.operationId)
              : crypto.randomUUID();
    const data = JSON.parse(
      encode(read || name === "importBilling" ? input : { ...raw, commandId: id }),
    ) as WireInputs[typeof name];
    const path =
      name === "operation"
        ? `/v1/operations/${encodeURIComponent(String(raw.operationId))}`
        : paths[name];
    const query = read
      ? "?q=" +
        btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "")
      : "";
    let response: Response;
    try {
      response = await fetcher(baseUrl.replace(/\/$/, "") + path + query, {
        method: read ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Request-ID": id,
        },
        ...(!read ? { body: JSON.stringify(data) } : {}),
      });
    } catch {
      throw new RemoteUnavailable(id);
    }
    if (response.status >= 500) throw new RemoteUnavailable(id);
    if (response.status === 403 && (read || name === "importBilling"))
      return { outcome: "forbidden" } as T;
    if (response.status === 401 || response.status === 403 || response.status === 404)
      throw new RemoteHttpError(response.status, id);
    try {
      const result = decode(await response.text());
      if (response.status === 400)
        return { outcome: "invalid", field: "body", reason: "Invalid request schema" } as T;
      if (!response.ok || result === null || typeof result !== "object")
        throw new Error("Invalid response");
      return result as T;
    } catch {
      throw new RemoteUnavailable(id);
    }
  };
}
