import { createRemoteMeter, RemoteUnavailable, RemoteHttpError } from "@usagekit/client";
import type { AccessContext, Quantity } from "@usagekit/core";
import { homedir } from "node:os";
import { join } from "node:path";
import { encode, decode } from "./output.js";
export class UsageError extends Error {
  constructor() {
    super("Invalid arguments or conflicting retry payload");
  }
}
export type Options = Record<string, string | boolean | undefined>;
export const string = (o: Options, name: string, fallback?: string): string => {
  const v = o[name] ?? fallback;
  if (typeof v !== "string" || !v) throw new UsageError();
  return v;
};
export function quantity(text: string): Quantity {
  const match = /^(\d+)(?:\.(\d{1,18}))?:([^\s:]+)$/.exec(text);
  if (!match) throw new UsageError();
  return {
    value: BigInt(match[1]! + (match[2] ?? "")),
    scale: match[2]?.length ?? 0,
    unit: match[3]!,
  };
}
export const access: AccessContext = {
  namespace: "local",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
export function context(options: Options) {
  const baseUrl = string(
    options,
    "url",
    process.env.USAGEKIT_URL ?? "http://127.0.0.1:4242",
  ).replace(/\/$/, "");
  const token = process.env.USAGEKIT_TOKEN;
  if (!token) throw new UsageError();
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new UsageError();
  const configDir = string(
    options,
    "config-dir",
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "usagekit"),
  );
  return {
    options,
    baseUrl,
    configDir,
    meter: createRemoteMeter({ baseUrl, token }),
    async rest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
      const requestId = crypto.randomUUID();
      let res: Response;
      try {
        res = await fetch(baseUrl + path, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: encode(body) }),
        });
      } catch {
        throw new RemoteUnavailable(requestId);
      }
      if (res.status >= 500) throw new RemoteUnavailable(requestId);
      if (!res.ok) throw new RemoteHttpError(res.status, requestId);
      return decode<T>(await res.text());
    },
  };
}
export type Context = ReturnType<typeof context>;
