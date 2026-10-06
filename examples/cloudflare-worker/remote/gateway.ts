import { decode, encode } from "../../../packages/store-d1/src/serialize.js";
import type { RemoteCommand } from "./owner.js";
async function authorized(request: Request, secret: string): Promise<boolean> {
  if (!secret) return false;
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [actual, expected] = await Promise.all([
    digest(request.headers.get("authorization") ?? ""),
    digest(`Bearer ${secret}`),
  ]);
  return crypto.subtle.timingSafeEqual(actual, expected);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env.USAGEKIT_TOKEN)))
      return new Response("Unauthorized", { status: 401 });
    const path = new URL(request.url).pathname;
    if (path === "/health") return Response.json({ gateway: env.GATEWAY, revision: env.REVISION });
    // Exercise the unchanged shipped HTTP example through either gateway.
    if (path.startsWith("/v1/")) return env.LEDGER.getByName(env.NAMESPACE).fetch(request);
    if (path !== "/test" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    const text = await request.text();
    if (text.length > 65536) return new Response("Too large", { status: 413 });
    let command: RemoteCommand;
    try {
      command = decode<RemoteCommand>(text);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!/^p7-[a-z0-9-]{1,80}$/.test(command?.run))
      return new Response("Invalid run", { status: 400 });
    const input = command.input as
      | { scope?: { namespace?: string }; namespace?: string }
      | undefined;
    if (
      command.method !== "inspect" &&
      (input?.scope?.namespace ?? input?.namespace) !== command.run
    )
      return new Response("Forbidden", { status: 403 });
    try {
      const result = await env.REMOTE.getByName(command.run).execute(command);
      return new Response(encode(result), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch {
      return new Response("Fixture failed", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
