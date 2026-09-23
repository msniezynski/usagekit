import { type Context, string, UsageError } from "../context.js";
export async function provider(c: Context, command?: string, name?: string) {
  const o = c.options;
  if (command === "list") return c.rest("/providers/connections");
  const id = string(o, "connection"),
    path = "/providers/connections/" + encodeURIComponent(id);
  if (command === "remove") return c.rest(path, "DELETE");
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
  return c.rest("/providers/connections", "POST", { provider: name, connectionId: id, secret });
}
