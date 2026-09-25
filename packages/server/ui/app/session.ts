import { decodeMeterJson } from "@usagekit/core";
import type { AccessContext, Budget } from "@usagekit/core";
import type { ConnectionInput } from "@usagekit/views";

/**
 * The token lives in React state only: never in storage, cookies or the URL. The server derives
 * access from the token; this context only feeds the view models, which pass it through.
 */
export const localAccess: AccessContext = {
  namespace: "local",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
export const localScope = { kind: "principal", namespace: "local", principal: "local" } as const;
export type Session = { baseUrl: string; token: string; fetch: typeof globalThis.fetch };

async function get(session: Session, path: string): Promise<unknown> {
  const response = await session.fetch(session.baseUrl + path, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decodeMeterJson(await response.text());
}

/** Vault entries are the user's own keys on the local server. */
export async function loadConnections(session: Session): Promise<ConnectionInput[]> {
  const list = (await get(session, "/providers/connections")) as {
    provider: string;
    connectionId: string;
    tags?: string[];
  }[];
  return list.map((c) => ({
    id: c.connectionId,
    provider: c.provider,
    fundingSource: "byok",
    ...(c.tags ? { tags: c.tags } : {}),
  }));
}
export async function loadBudgetUnits(session: Session): Promise<string[]> {
  const budgets = (await get(session, "/budgets")) as Budget[];
  const units = [...new Set(budgets.map((b) => b.unit))].sort();
  return units.length ? units : ["requests"];
}
