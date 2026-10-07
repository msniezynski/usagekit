import type { AccessContext, Meter } from "@usagekit/core";
import type { Problem } from "@usagekit/views";
import { identity, retainReadInput, serialize } from "./keys.js";

export type QuerySnapshot<T> = { data: T | null; error: Problem | null; fetching: boolean };
export type QueryEntry<T> = {
  key: string;
  snapshot: QuerySnapshot<T>;
  listeners: Set<() => void>;
  load: () => Promise<T>;
  generation: number;
  loadedAt: number;
  running: boolean;
};
export type QueryClientOptions = { staleTimeMs?: number; maxEntries?: number };
export const bindingKey = (meter: Meter, access: AccessContext) =>
  `${identity(meter)}:${serialize(access)}`;

/** Per-Provider read cache. It never dispatches or automatically retries a write. */
export class MeterQueryClient {
  private entries = new Map<string, QueryEntry<unknown>>();
  readonly staleTimeMs: number;
  readonly maxEntries: number;
  constructor({ staleTimeMs = 30000, maxEntries = 128 }: QueryClientOptions = {}) {
    if (
      !Number.isFinite(staleTimeMs) ||
      staleTimeMs < 0 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1
    )
      throw new RangeError("Invalid query cache bounds");
    this.staleTimeMs = staleTimeMs;
    this.maxEntries = maxEntries;
  }
  entry<I, T>(
    meter: Meter,
    access: AccessContext,
    load: (m: Meter, a: AccessContext, i: I) => Promise<T>,
    input: I,
  ): QueryEntry<T> {
    const key = `${bindingKey(meter, access)}:${identity(load)}:${serialize(input)}`;
    let entry = this.entries.get(key) as QueryEntry<T> | undefined;
    if (!entry) {
      const retainedAccess = retainReadInput(access);
      const retainedInput = retainReadInput(input);
      entry = {
        key,
        snapshot: { data: null, error: null, fetching: false },
        listeners: new Set(),
        load: () => load(meter, retainedAccess, retainedInput),
        generation: 0,
        loadedAt: 0,
        running: false,
      };
      this.entries.set(key, entry as QueryEntry<unknown>);
    }
    return entry;
  }
  subscribe<T>(entry: QueryEntry<T>, listener: () => void): () => void {
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      this.trim();
    };
  }
  ensure<T>(entry: QueryEntry<T>): void {
    if (!entry.running && (!entry.loadedAt || Date.now() - entry.loadedAt >= this.staleTimeMs))
      this.fetch(entry);
  }
  refresh<T>(entry: QueryEntry<T>): void {
    this.fetch(entry);
  }
  /** Invalidate only the current verified binding when called by hooks. Omitted binding refreshes all. */
  invalidate(meter?: Meter, access?: AccessContext): void {
    const prefix = meter && access ? `${bindingKey(meter, access)}:` : null;
    for (const entry of this.entries.values()) {
      if (prefix && !entry.key.startsWith(prefix)) continue;
      entry.loadedAt = 0;
      if (entry.listeners.size) this.fetch(entry);
      else {
        entry.generation++;
        entry.running = false;
        entry.snapshot = { data: null, error: null, fetching: false };
      }
    }
  }
  private fetch<T>(entry: QueryEntry<T>) {
    const generation = ++entry.generation;
    entry.running = true;
    entry.snapshot = { ...entry.snapshot, error: null, fetching: true };
    this.notify(entry);
    Promise.resolve()
      .then(entry.load)
      .then(
        (data) => {
          if (generation !== entry.generation) return;
          entry.snapshot = { data, error: null, fetching: false };
          entry.loadedAt = Date.now();
          entry.running = false;
          this.notify(entry);
          this.trim();
        },
        (reason: unknown) => {
          if (generation !== entry.generation) return;
          entry.snapshot = {
            data: null,
            error: {
              kind: "error",
              message: reason instanceof Error ? reason.message : String(reason),
            },
            fetching: false,
          };
          entry.loadedAt = Date.now();
          entry.running = false;
          this.notify(entry);
          this.trim();
        },
      );
  }
  private notify<T>(entry: QueryEntry<T>) {
    for (const listener of entry.listeners) listener();
  }
  private trim() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      if (!entry.listeners.size && !entry.running) this.entries.delete(key);
    }
  }
}
export const createMeterQueryClient = (options?: QueryClientOptions): MeterQueryClient =>
  new MeterQueryClient(options);
const defaults = new WeakMap<Meter, MeterQueryClient>();
export function defaultMeterQueryClient(meter: Meter): MeterQueryClient {
  let client = defaults.get(meter);
  if (!client) {
    client = createMeterQueryClient();
    defaults.set(meter, client);
  }
  return client;
}
