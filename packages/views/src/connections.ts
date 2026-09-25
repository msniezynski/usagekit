import type { FundingSource } from "@usagekit/core";

/** Host connection records. The Meter has no connection read; hosts pass their own list. */
export type ConnectionInput = {
  id: string;
  provider: string;
  label?: string;
  fundingSource: FundingSource;
  tags?: readonly string[];
  plan?: string | null;
};
export type ConnectionRow = {
  id: string;
  provider: string;
  label: string;
  funding: FundingSource;
  tags: readonly string[];
  plan: string | null;
};
/** Keeps host order; the label falls back to the id and tags sort like stored scope tags. */
export const connectionRows = (items: readonly ConnectionInput[]): ConnectionRow[] =>
  items.map((c) => ({
    id: c.id,
    provider: c.provider,
    label: c.label?.trim() || c.id,
    funding: c.fundingSource,
    tags: [...(c.tags ?? [])].sort(),
    plan: c.plan ?? null,
  }));
