import { readFileSync } from "node:fs";
import { type Context, string, strings, pairs, quantity, UsageError } from "../context.js";
export type Connection = {
  provider: string;
  connectionId: string;
  tags?: string[];
  plan?: string;
  tracking?: Record<string, string>;
};
export async function provider(c: Context, command?: string, name?: string) {
  const o = c.options;
  if (command === "list") return c.rest<Connection[]>("/providers/connections");
  const id = string(o, "connection"),
    path = "/providers/connections/" + encodeURIComponent(id);
  if (command === "remove") return c.rest(path, "DELETE");
  if (command === "record") {
    const request: unknown = JSON.parse(readFileSync(string(o, "request"), "utf8"));
    return c.rest(path + "/record", "POST", { operation: string(o, "feature"), request });
  }
  if (command === "test") return c.rest(path + "/test", "POST");
  if (command !== "add" || !name) throw new UsageError();
  let secret = typeof o["secret-env"] === "string" ? process.env[o["secret-env"]] : undefined;
  if (!o["secret-env"]) {
    if (process.stdin.isTTY) throw new UsageError();
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    secret = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
  }
  if (!secret?.trim()) throw new UsageError();
  const tags = strings(o, "tag");
  if (o.overage !== undefined && !["true", "false"].includes(String(o.overage)))
    throw new UsageError();
  const manualPrices =
    o.price === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(pairs(o, "price")).map(([id, text]) => {
            const q = quantity(text);
            return [id, { ...q, value: q.value.toString() }];
          }),
        );
  return c.rest("/providers/connections", "POST", {
    provider: name,
    connectionId: id,
    secret,
    ...(tags ? { tags } : {}),
    ...(manualPrices ? { manualPrices } : {}),
    ...(o.overage === undefined ? {} : { overage: o.overage === "true" }),
    ...(o.plan === undefined ? {} : { plan: string(o, "plan") }),
    ...(o.tracking === undefined ? {} : { tracking: pairs(o, "tracking") }),
  });
}
