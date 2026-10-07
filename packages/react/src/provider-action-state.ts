import type { ProviderActionResult, ProviderBinding, ProviderCommand } from "@usagekit/views";

export type ProviderActionState = "idle" | "pending" | ProviderActionResult["outcome"];
export type ProviderActionSnapshot = {
  state: ProviderActionState;
  result: ProviderActionResult | null;
  pending: boolean;
  ambiguous: boolean;
};
export const idleProviderAction: ProviderActionSnapshot = {
  state: "idle",
  result: null,
  pending: false,
  ambiguous: false,
};
export type ProviderActionEntry = {
  snapshot: ProviderActionSnapshot;
  command: ProviderCommand | null;
  binding: ProviderBinding | null;
  ownerKey: string | null;
  credentialBearing: boolean;
  listeners: Set<() => void>;
};
const entries = new Map<string, ProviderActionEntry>();
export function providerActionEntry(key: string): ProviderActionEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      snapshot: idleProviderAction,
      command: null,
      binding: null,
      ownerKey: null,
      credentialBearing: false,
      listeners: new Set(),
    };
    entries.set(key, entry);
  }
  return entry;
}
export function publishProviderAction(
  entry: ProviderActionEntry,
  snapshot: ProviderActionSnapshot,
): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
  trimProviderActions();
}
export function trimProviderActions(): void {
  for (const [key, entry] of entries) {
    if (entries.size <= 256) break;
    if (!entry.listeners.size && !entry.snapshot.pending && !entry.snapshot.ambiguous)
      entries.delete(key);
  }
}
