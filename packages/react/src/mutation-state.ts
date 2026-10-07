import type { Budget } from "@usagekit/core";
import type { MeterQueryClient } from "./query-client.js";
import type { BudgetSaveResult } from "./writer.js";

export type BudgetMutationState = "idle" | "pending" | BudgetSaveResult["outcome"];
export type MutationSnapshot = {
  state: BudgetMutationState;
  result: BudgetSaveResult | null;
  ambiguous: boolean;
  pending: boolean;
};
export const idleMutation: MutationSnapshot = {
  state: "idle",
  result: null,
  ambiguous: false,
  pending: false,
};
export type MutationEntry = {
  snapshot: MutationSnapshot;
  candidate: Budget | null;
  listeners: Set<() => void>;
};
const mutations = new WeakMap<MeterQueryClient, Map<string, MutationEntry>>();
export function mutationEntry(client: MeterQueryClient, key: string): MutationEntry {
  let entries = mutations.get(client);
  if (!entries) {
    entries = new Map();
    mutations.set(client, entries);
  }
  let entry = entries.get(key);
  if (!entry) {
    entry = { snapshot: idleMutation, candidate: null, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}
export function publishMutation(entry: MutationEntry, snapshot: MutationSnapshot) {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}
export function retainBudget(budget: Budget): Budget {
  const copy: Budget = structuredClone(budget);
  function freeze(value: object) {
    for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
    Object.freeze(value);
  }
  freeze(copy);
  return copy;
}
