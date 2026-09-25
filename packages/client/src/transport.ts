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
export type RemoteOptions = { baseUrl: string; token: string; fetch?: typeof globalThis.fetch };
export function transport({ baseUrl, token, fetch: fetcher = globalThis.fetch }: RemoteOptions) {
  return async <T>(name: RouteName, input: unknown, read = false): Promise<T> => {
    const raw = input as Record<string, unknown>,
      id =
        typeof raw.commandId === "string"
          ? raw.commandId
          : name === "reserve"
            ? String(raw.operationId)
            : crypto.randomUUID();
    const data = JSON.parse(
      encode(read ? input : { ...raw, commandId: id }),
    ) as WireInputs[typeof name];
    const path = read
      ? name === "operation"
        ? `/v1/operations/${encodeURIComponent(String(raw.operationId))}`
        : name === "usage"
          ? "/v1/usage"
          : name === "operations"
            ? "/v1/operations"
            : `/v1/budgets/${name}`
      : `/v1/operations/${name}`;
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
    if (response.status === 403 && read) return { outcome: "forbidden" } as T;
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
