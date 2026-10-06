import { DurableObject } from "cloudflare:workers";
import { createDurableObjectStore } from "@usagekit/store-d1";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";

/** A fixed namespace and principal make this an example, not a multi-tenant product backend. */
export class UsageLedger extends DurableObject<Env> {
  private readonly handle: (request: Request) => Promise<Response>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = createDurableObjectStore({
      storage: ctx.storage,
      clock: { now: () => new Date() },
    });
    // Existing versions survive restarts. Configuration changes require a new budget version.
    if (store.listBudgets().length === 0)
      store.putBudget({
        id: "example-requests",
        version: 1,
        scope: { kind: "principal", namespace: env.NAMESPACE, principal: "demo-user" },
        surface: "any",
        unit: "requests",
        limit: { value: 10n, scale: 0, unit: "requests" },
        window: { kind: "calendar_month", timezone: "UTC" },
        onExceed: "block",
      });
    this.handle = createUsageHandlers({
      meter: createMeter({ store, clock: { now: () => new Date() } }),
      authenticate: async (request) => {
        if (!env.USAGEKIT_TOKEN) return null;
        const provided = request.headers.get("authorization") ?? "";
        const digest = (text: string) =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        const [actual, expected] = await Promise.all([
          digest(provided),
          digest(`Bearer ${env.USAGEKIT_TOKEN}`),
        ]);
        if (!crypto.subtle.timingSafeEqual(actual, expected)) return null;
        return {
          namespace: env.NAMESPACE,
          readablePrincipals: ["demo-user"],
          canManageBudgets: true,
          readableGroups: [],
          readablePools: [],
          canReadBillingDetail: true,
        };
      },
    });
  }
  async fetch(request: Request): Promise<Response> {
    return this.handle(request);
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // All principals sharing any budget must use the SAME object. Never shard by principal.
    return env.LEDGER.getByName(env.NAMESPACE).fetch(request);
  },
} satisfies ExportedHandler<Env>;
