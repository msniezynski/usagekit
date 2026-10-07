import type {
  Problem,
  ViewState,
  ProviderBinding,
  ProviderManagementPort,
  ProviderQuery,
  ProviderSnapshot,
} from "@usagekit/views";
import { identity, retainReadInput, serialize } from "./keys.js";
import type { QueryClientOptions } from "./query-client.js";

export const providerBindingKey = (port: ProviderManagementPort, binding: ProviderBinding) =>
  `${identity(port)}:${serialize([binding.scopeKey, binding.principalKey, binding.authRevision, binding.canManage === true])}`;
export const retainProviderBinding = (binding: ProviderBinding): ProviderBinding =>
  Object.freeze({
    scopeKey: binding.scopeKey,
    principalKey: binding.principalKey,
    authRevision: binding.authRevision,
    canManage: binding.canManage === true,
  });
export type ProviderReadSnapshot = {
  data: ProviderSnapshot | null;
  state: "loading" | ViewState;
  error: Problem | null;
  fetching: boolean;
};
export type ProviderReadEntry = {
  key: string;
  snapshot: ProviderReadSnapshot;
  listeners: Set<() => void>;
  load: () => Promise<ProviderReadSnapshot>;
  generation: number;
  loadedAt: number;
  running: boolean;
};

/** Separate stored-provider evidence cache. Accounting reads remain in MeterQueryClient. */
export class ProviderQueryClient {
  private entries = new Map<string, ProviderReadEntry>();
  readonly staleTimeMs: number;
  readonly maxEntries: number;
  constructor({ staleTimeMs = 30000, maxEntries = 128 }: QueryClientOptions = {}) {
    if (
      !Number.isFinite(staleTimeMs) ||
      staleTimeMs < 0 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1
    )
      throw new RangeError("Invalid provider cache bounds");
    this.staleTimeMs = staleTimeMs;
    this.maxEntries = maxEntries;
  }
  entry(
    port: ProviderManagementPort,
    binding: ProviderBinding,
    query: ProviderQuery,
  ): ProviderReadEntry {
    const key = `${providerBindingKey(port, binding)}:${serialize(query)}`;
    let entry = this.entries.get(key);
    if (!entry) {
      const retainedBinding = retainProviderBinding(binding),
        retainedQuery = retainReadInput(query);
      entry = {
        key,
        snapshot: { data: null, state: "loading", error: null, fetching: false },
        listeners: new Set(),
        generation: 0,
        loadedAt: 0,
        running: false,
        load: async () => {
          const reply = await port.read(retainedBinding, retainedQuery);
          if (reply.outcome === "ok") {
            if (reply.value.state === "forbidden" || reply.value.state === "unavailable")
              return {
                data: null,
                state: reply.value.state,
                error: reply.value.problem,
                fetching: false,
              };
            if (!["ok", "empty"].includes(reply.value.state))
              throw new Error("Invalid provider snapshot state");
            if (!matchesQuery(reply.value, retainedQuery))
              throw new Error("Provider snapshot does not match the requested target");
            return {
              data: retainReadInput(reply.value),
              state: reply.value.state,
              error: reply.value.problem,
              fetching: false,
            };
          }
          const error: Problem | null =
            reply.outcome === "invalid"
              ? { kind: "invalid", field: reply.field, reason: reply.reason }
              : reply.outcome === "unavailable"
                ? { kind: "error", message: reply.message }
                : null;
          return {
            data: null,
            state: reply.outcome === "forbidden" ? "forbidden" : "unavailable",
            error,
            fetching: false,
          };
        },
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  subscribe(entry: ProviderReadEntry, listener: () => void): () => void {
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      this.trim();
    };
  }
  ensure(entry: ProviderReadEntry): void {
    if (!entry.running && (!entry.loadedAt || Date.now() - entry.loadedAt >= this.staleTimeMs))
      this.refresh(entry);
  }
  refresh(entry: ProviderReadEntry): void {
    const generation = ++entry.generation;
    entry.running = true;
    entry.snapshot = { ...entry.snapshot, error: null, fetching: true };
    this.notify(entry);
    Promise.resolve()
      .then(entry.load)
      .then(
        (snapshot) => {
          if (generation !== entry.generation) return;
          entry.snapshot = snapshot;
          this.complete(entry);
        },
        () => {
          if (generation !== entry.generation) return;
          entry.snapshot = {
            data: null,
            state: "unavailable",
            fetching: false,
            error: { kind: "error", message: "Provider evidence is unavailable" },
          };
          this.complete(entry);
        },
      );
  }
  invalidate(port?: ProviderManagementPort, binding?: ProviderBinding): void {
    const prefix = port && binding ? `${providerBindingKey(port, binding)}:` : null;
    for (const entry of this.entries.values()) {
      if (prefix && !entry.key.startsWith(prefix)) continue;
      entry.loadedAt = 0;
      if (entry.listeners.size) this.refresh(entry);
      else {
        entry.generation++;
        entry.running = false;
        entry.snapshot = { data: null, state: "loading", error: null, fetching: false };
      }
    }
  }
  private complete(entry: ProviderReadEntry) {
    entry.running = false;
    entry.loadedAt = Date.now();
    this.notify(entry);
    this.trim();
  }
  private notify(entry: ProviderReadEntry) {
    for (const listener of entry.listeners) listener();
  }
  private trim() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      if (!entry.running && !entry.listeners.size) this.entries.delete(key);
    }
  }
}
function matchesQuery(snapshot: ProviderSnapshot, query: ProviderQuery): boolean {
  if (snapshot.kind !== query.kind) return false;
  if (snapshot.kind === "connections" && query.kind === "connections")
    return (
      (!query.provider || snapshot.connections.every((row) => row.provider === query.provider)) &&
      (snapshot.state !== "empty" || !snapshot.connections.length)
    );
  if (snapshot.kind === "details" && query.kind === "details")
    return (
      !snapshot.connection ||
      (snapshot.connection.id === query.connectionId && snapshot.state !== "empty")
    );
  if (snapshot.kind === "balance" && query.kind === "balance")
    return (
      !snapshot.balance ||
      (snapshot.balance.connectionId === query.connectionId && snapshot.state !== "empty")
    );
  if (snapshot.kind === "projection" && query.kind === "projection")
    return (
      !snapshot.projection ||
      (snapshot.projection.connectionId === query.connectionId && snapshot.state !== "empty")
    );
  if (snapshot.kind === "allocations" && query.kind === "allocations")
    return (
      snapshot.rows.every((row) => query.connectionIds.includes(row.connectionId)) &&
      (snapshot.state !== "empty" || !snapshot.rows.length)
    );
  return true;
}
export const createProviderQueryClient = (options?: QueryClientOptions) =>
  new ProviderQueryClient(options);
const defaults = new WeakMap<ProviderManagementPort, ProviderQueryClient>();
export function defaultProviderQueryClient(port: ProviderManagementPort): ProviderQueryClient {
  let client = defaults.get(port);
  if (!client) {
    client = createProviderQueryClient();
    defaults.set(port, client);
  }
  return client;
}
