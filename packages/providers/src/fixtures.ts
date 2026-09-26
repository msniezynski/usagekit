import { decodeMeterJson } from "@usagekit/core";
import type { BalanceSnapshot, BillingLine, PriceRow, ProviderDescriptor } from "@usagekit/core";
import type { ProviderRequest, ProviderResponse, ReceiptDraft } from "./types.js";
import type { Catalog } from "./catalog.js";

/**
 * One fixture file: a redacted request and response pair plus the expected parsed values.
 * documentation fixtures are authored from public API documentation; recorded ones come from
 * the local server recorder; synthetic ones exercise the catalog itself.
 */
export type Fixture = {
  path: string;
  origin: "documentation" | "recorded" | "synthetic";
  provider: string;
  operation: string;
  source?: string;
  description?: string;
  recordedAt?: string;
  request: ProviderRequest;
  response: ProviderResponse & { body: unknown };
  expect: FixtureExpectation;
};
export type FixtureExpectation = {
  options?: Record<string, string>;
  receipt?: ReceiptDraft;
  /** null asserts that the body carries no provider request id. */
  requestId?: string | null;
  balance?: BalanceSnapshot;
  priceList?: { checkedAt: string; rows: PriceRow[] };
  billingLines?: BillingLine[];
};
/** Parsed fixture files keyed by path, for example the result of import.meta.glob(..., { eager: true }). */
export type FixtureDirectory = Readonly<Record<string, unknown>>;

const origins = ["documentation", "recorded", "synthetic"];
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Validate fixture files. Paths end in <operation>/<case>.json and the folder must name the
 * fixture's operation. Quantities and money in expectations become bigint.
 */
export function loadFixtures(files: FixtureDirectory): Fixture[] {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, raw]) => {
      const fail = (what: string) => new Error(`InvalidFixture: ${path}: ${what}`);
      const segments = path.split("/");
      if (segments.length < 2 || !path.endsWith(".json")) throw fail("path");
      if (!isObject(raw)) throw fail("object");
      const data = decodeMeterJson(JSON.stringify(raw)) as Record<string, unknown>;
      if (!origins.includes(String(data.origin))) throw fail("origin");
      if (typeof data.provider !== "string" || typeof data.operation !== "string")
        throw fail("provider and operation");
      if (segments.at(-2) !== data.operation) throw fail("operation folder");
      const request = data.request,
        response = data.response;
      if (
        !isObject(request) ||
        typeof request.method !== "string" ||
        typeof request.url !== "string"
      )
        throw fail("request");
      if (!isObject(response) || typeof response.status !== "number" || !("body" in response))
        throw fail("response");
      return {
        ...(data as unknown as Fixture),
        expect: (data.expect ?? {}) as FixtureExpectation,
        path,
      };
    });
}

/** Advertised operations without any fixture. A descriptor may not advertise them. */
export function missingFixtures(descriptor: ProviderDescriptor, fixtures: readonly Fixture[]) {
  return descriptor.operations
    .map((o) => o.id)
    .filter((id) => !fixtures.some((f) => f.provider === descriptor.id && f.operation === id));
}

/** Key-order-insensitive deep equality with exact bigints. */
function canonical(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Problems of one fixture against the catalog: match, options and every declared expectation. */
export function verifyFixture(catalog: Catalog, fixture: Fixture): string[] {
  const problems: string[] = [],
    e = fixture.expect,
    matched = catalog.match(fixture.provider, fixture.request);
  const id = matched.operation === "unknown" ? "unknown" : matched.operation.id;
  if (id !== fixture.operation) return [`matched ${id}, expected ${fixture.operation}`];
  const module = catalog.providers().find((d) => d.id === fixture.provider)!;
  if (e.options && "options" in matched && !same(matched.options, e.options))
    problems.push("options differ");
  const declared = (
    ["options", "receipt", "requestId", "balance", "priceList", "billingLines"] as const
  ).filter((k) => k in e);
  if (!declared.length) problems.push("fixture declares no expectation");
  if (e.receipt) {
    const receipt = catalog.extract(
      fixture.provider,
      fixture.operation,
      fixture.request,
      fixture.response,
      fixture.response.body,
    );
    if (!same(receipt, e.receipt)) problems.push("receipt differs");
  }
  if (
    "requestId" in e &&
    catalog.requestId(fixture.provider, fixture.response.body) !== (e.requestId ?? undefined)
  )
    problems.push("request id differs");
  if (e.balance && !same(catalog.probe(fixture.provider, fixture.response.body), e.balance))
    problems.push("balance differs");
  const parsers = catalog.parsers(module.id);
  if (e.priceList) {
    if (!parsers.priceList) problems.push("no price list parser");
    else if (
      !same(parsers.priceList(fixture.response.body, e.priceList.checkedAt), e.priceList.rows)
    )
      problems.push("price list differs");
  }
  if (e.billingLines) {
    if (!parsers.billingExport) problems.push("no billing export parser");
    else if (!same(parsers.billingExport(fixture.response.body), e.billingLines))
      problems.push("billing lines differ");
  }
  return problems;
}
