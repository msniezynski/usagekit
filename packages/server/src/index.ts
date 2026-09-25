import { serve } from "@hono/node-server";
import { join } from "node:path";
import type { Server } from "node:http";
import type { Clock } from "@usagekit/store";
import { createSqliteStore } from "@usagekit/store-sqlite";
import { createMeter } from "@usagekit/meter";
import { loadConfig, defaultConfigDir } from "./config.js";
import { createAuth } from "./auth.js";
import { createVault } from "./vault.js";
import { createApp } from "./app.js";
import { defaultUiRoot } from "./ui.js";
export type ServerConfig = {
  configDir?: string;
  port?: number;
  host?: string;
  allowRemote?: boolean;
  passphrase?: string;
  clock?: Clock;
  onToken?: (token: string) => void;
  /** Directory of the built UI; defaults to dist/ui next to the server. */
  uiRoot?: string;
};
export async function startServer(options: ServerConfig = {}) {
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host))
    throw new Error(options.allowRemote ? "NotSupported: remote TLS" : "LoopbackOnly");
  const dir = options.configDir ?? defaultConfigDir(),
    loaded = loadConfig(dir),
    auth = createAuth(loaded.config, loaded.path),
    vault = createVault(join(dir, "vault.enc")),
    clock = options.clock ?? { now: () => new Date() };
  if (loaded.firstToken)
    (options.onToken ?? ((token) => console.log(`usagekit token (shown once): ${token}`)))(
      loaded.firstToken,
    );
  if (options.passphrase) vault.unlock(options.passphrase);
  const store = createSqliteStore({ path: join(dir, "usage.db"), clock });
  const meter = createMeter({
      store,
      clock,
      resolveOwnership: async (scope) =>
        scope.namespace === "local"
          ? { kind: "principal", namespace: "local", principal: "local" }
          : null,
    }),
    app = createApp({
      meter,
      store,
      auth,
      vault,
      configPath: loaded.path,
      uiRoot: options.uiRoot ?? defaultUiRoot,
    });
  let maintenance: Promise<void> | undefined;
  const expireReservations = () =>
    (maintenance ??= (async () => {
      let result;
      do {
        result = await meter.expireReservations({ namespace: "local", limit: 1000 });
        if (result.outcome !== "expired") throw new Error("ReservationCleanupFailed");
      } while (result.hasMore);
    })().finally(() => {
      maintenance = undefined;
    }));
  let server: Server;
  try {
    await expireReservations();
    server = await new Promise<Server>((resolve, reject) => {
      const instance = serve({ fetch: app.fetch, hostname: host, port: options.port ?? 4242 }, () =>
        resolve(instance as Server),
      );
      instance.once("error", reject);
    });
  } catch (error) {
    store.close();
    vault.lock();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid listen address");
  const sweepTimer = setInterval(() => {
    void expireReservations().catch(() => console.error("usagekit reservation cleanup failed"));
  }, 30000);
  sweepTimer.unref();
  let stopped = false;
  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`,
    app,
    store,
    vault,
    expireReservations,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(sweepTimer);
      await maintenance?.catch(() => {});
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
      vault.lock();
    },
  };
}
