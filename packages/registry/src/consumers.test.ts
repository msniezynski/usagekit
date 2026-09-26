import { execFile, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { MeterProvider } from "@usagekit/react";
import type { AccessContext, Budget, ReserveInput } from "@usagekit/core";
import { blockNames, variants } from "./index.js";
import type { Variant } from "./index.js";

/** The shadcn CLI version these tests pin; the root lockfile installs exactly this one. */
const shadcnVersion = "4.21.0";
const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const cli = join(repo, "node_modules/shadcn/dist/index.js");
// Inside the workspace root (ignored by Git and Prettier): the test module loader serves files
// under its root only. Each run removes its own directory.
mkdirSync(join(root, ".work"), { recursive: true });
const work = mkdtempSync(join(root, ".work", "run-"));
const out = join(work, "registry");
const npmLog = join(work, "npm.log");
const requests: string[] = [];
let server: Server;
let registryUrl: string;

/**
 * Loopback stand-in for the public registry: bare registryDependencies resolve to the primitive
 * files already committed in each consumer, and the base color is an empty palette. No network.
 */
function serve(): Promise<void> {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    res.setHeader("content-type", "application/json");
    if (/^\/r\/colors\/[a-z]+\.json$/.test(url)) {
      const empty = { light: {}, dark: {} };
      res.end(
        JSON.stringify({
          inlineColors: empty,
          cssVars: empty,
          cssVarsV4: empty,
          inlineColorsTemplate: "",
          cssVarsTemplate: "",
        }),
      );
      return;
    }
    const match = /^\/r\/styles\/([a-z0-9-]+)\/([a-z-]+)\.json$/.exec(url);
    const variant: Variant | null = match
      ? match[1]!.startsWith("base")
        ? "base"
        : "radix"
      : null;
    const file = match && join(root, "consumers", variant!, "components/ui", `${match[2]}.tsx`);
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        name: match![2],
        type: "registry:ui",
        files: [
          {
            path: `ui/${match![2]}.tsx`,
            type: "registry:ui",
            content: readFileSync(file, "utf8"),
          },
        ],
      }),
    );
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      registryUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/r`;
      done();
    }),
  );
}

/** Copies a committed consumer, links the workspace node_modules and adds every block to it. */
async function addBlocks(variant: Variant): Promise<string> {
  const host = join(work, variant);
  cpSync(join(root, "consumers", variant), host, { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(host, "node_modules"), "dir");
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  // The CLI installs pinned block dependencies with npm; this stub records them offline.
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${npmLog}"\n`);
  chmodSync(join(bin, "npm"), 0o755);
  // Asynchronous on purpose: the loopback registry answers from this same process.
  await promisify(execFile)(
    process.execPath,
    [cli, "add", ...blockNames.map((n) => join(out, "r", variant, `${n}.json`)), "--yes"],
    {
      cwd: host,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REGISTRY_URL: registryUrl,
      },
    },
  );
  return host;
}

const hosts = {} as Record<Variant, string>;
beforeAll(async () => {
  execFileSync(process.execPath, [join(repo, "scripts/registry-build.mjs"), "--out", out]);
  await serve();
  for (const variant of variants) hosts[variant] = await addBlocks(variant);
}, 180000);
afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});
afterEach(cleanup);

describe("shadcn add against both consumers", () => {
  test("the pinned CLI version runs", () => {
    expect(execFileSync(process.execPath, [cli, "--version"]).toString().trim()).toBe(
      shadcnVersion,
    );
  });
  test.each(variants)("%s: every block lands unchanged and primitives stay intact", (variant) => {
    const host = hosts[variant];
    for (const name of blockNames)
      expect(readFileSync(join(host, "components/usagekit", `${name}.tsx`), "utf8")).toBe(
        readFileSync(join(root, "registry", variant, name, `${name}.tsx`), "utf8"),
      );
    for (const primitive of ["table", "card", "badge", "tooltip", "select", "button"])
      expect(readFileSync(join(host, "components/ui", `${primitive}.tsx`), "utf8")).toBe(
        readFileSync(join(root, "consumers", variant, "components/ui", `${primitive}.tsx`), "utf8"),
      );
    expect(readFileSync(join(host, "app/index.css"), "utf8")).toBe(
      readFileSync(join(root, "consumers", variant, "app/index.css"), "utf8"),
    );
  });
  test("block dependencies were requested at the pinned versions, offline", () => {
    const version = (name: string) =>
      JSON.parse(readFileSync(join(repo, "packages", name, "package.json"), "utf8")).version;
    const log = readFileSync(npmLog, "utf8");
    for (const name of ["react", "views", "core"])
      expect(log).toContain(`@usagekit/${name}@${version(name)}`);
    expect(requests.every((url) => url.startsWith("/r/"))).toBe(true);
    expect(requests.some((url) => url.startsWith("/r/styles/base-vega/"))).toBe(true);
    expect(requests.some((url) => url.startsWith("/r/styles/new-york/"))).toBe(true);
  });
  test.each(variants)("%s: the consumer typechecks with the added blocks", (variant) => {
    const host = hosts[variant];
    const paths = Object.fromEntries(
      ["core", "views", "react"].map((n) => [
        `@usagekit/${n}`,
        [join(repo, "packages", n, "src/index.ts")],
      ]),
    );
    writeFileSync(
      join(host, "tsconfig.check.json"),
      JSON.stringify({
        extends: "./tsconfig.json",
        compilerOptions: { paths: { "@/*": ["./*"], ...paths } },
      }),
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.check.json"],
        { cwd: host, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});

const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["u1"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const scope = { namespace: "test", principal: "u1", connection: "c1" };
const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
const budgets: Budget[] = [
  {
    id: "cap",
    version: 1,
    scope: { kind: "principal", namespace: "test", principal: "u1" },
    surface: "any",
    unit: "requests",
    limit: { value: 10n, scale: 0, unit: "requests" },
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "allow",
    hardLimit: { value: 15n, scale: 0, unit: "requests" },
    alerts: [{ at: { percent: 50 } }],
  },
  {
    id: "pool",
    version: 1,
    scope: { kind: "platform_pool", namespace: "test", poolId: "p1" },
    surface: "any",
    unit: "requests",
    limit: { value: 100n, scale: 0, unit: "requests" },
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "block",
  },
];

async function memoryMeter() {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [...budgets] }),
    meter = createMeter({ store, clock });
  const reserve = async (overrides: Partial<ReserveInput> = {}) => {
    const r = await store.reserve({
      operationId: crypto.randomUUID(),
      scope,
      fundingSource: "byok",
      costOwner: "u1",
      surface: "app",
      source: "app",
      provider: "search",
      operation: "search",
      platformPools: ["p1"],
      estimate: [{ value: 1n, scale: 0, unit: "requests" }],
      ...overrides,
    });
    if (r.outcome !== "reserved") throw new Error("fixture");
    return r.operation;
  };
  for (const provider of ["alpha", "beta"]) {
    const op = await reserve({ provider });
    const ref = { namespace: "test", principal: "u1", operationId: op.operationId };
    const g = await store.markDispatchIntent({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: op.version,
      holder: "h",
      leaseTtlMs: 60000,
    });
    if (!("granted" in g) || !g.granted) throw new Error("fixture");
    await store.settle({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: g.operation.version,
      authority: { kind: "lease", leaseId: g.lease.leaseId },
      receipt: {
        id: crypto.randomUUID(),
        measurements: [
          {
            unit: "requests",
            quantity: { value: 3n, scale: 0, unit: "requests" },
            certainty: "measured",
          },
        ],
        cost: { certainty: "measured", money: { units: 12345n, currency: "USD" } },
        occurredAt: "2026-09-23T12:00:00.000Z",
        recordedAt: "2026-09-23T12:00:00.000Z",
        cached: false,
        failed: false,
      },
    });
  }
  await reserve({ reservationTtlMs: 1000 });
  clock.advance(5000);
  await meter.countRequest({
    commandId: "unpriced-request",
    scope,
    provider: "search",
    operation: "unknown",
    surface: "app",
    source: "app",
    state: "unpriced",
  });
  return meter;
}

type Module = Record<string, ComponentType<Record<string, unknown>>>;
const load = async (variant: Variant, name: string): Promise<Module> =>
  (await import(
    /* @vite-ignore */ pathToFileURL(join(hosts[variant], "components/usagekit", `${name}.tsx`))
      .href
  )) as Module;

describe.each(variants)("%s blocks render against a memory Meter", (variant) => {
  const withMeter = async (node: ReactNode) => {
    const meter = await memoryMeter();
    return render(createElement(MeterProvider, { meter, access }, node));
  };
  test("usage table pages through the view", async () => {
    const { UsageTablePanel } = await load(variant, "usage-table");
    await withMeter(
      createElement(UsageTablePanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
        units: ["requests", "tokens"],
        groupBy: ["provider"],
        limit: 1,
      }),
    );
    await screen.findByText("alpha");
    expect(screen.getByText("3 requests")).toBeTruthy();
    expect(screen.getByText("1.2345 cents")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("beta");
    expect(screen.getByRole("button", { name: "First page" })).toBeTruthy();
  });
  test("budget cards show figures, markers and the redacted pool", async () => {
    const { BudgetCardsPanel } = await load(variant, "budget-card");
    const { container } = await withMeter(
      createElement(BudgetCardsPanel!, {
        scope,
        surface: "app",
        units: ["requests"],
        platformPools: ["p1"],
      }),
    );
    await screen.findByText("principal u1");
    expect(screen.getByText("6 requests")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText(/figures are hidden/)).toBeTruthy();
    expect(screen.getByLabelText("Hard limit 15 requests")).toBeTruthy();
    expect(screen.getByLabelText("Alert 50%")).toBeTruthy();
    expect(container.querySelector('[style*="width: 40%"]')).toBeTruthy();
  });
  test("header status shows one pill per visible bound", async () => {
    const { HeaderStatusPanel } = await load(variant, "header-status");
    await withMeter(
      createElement(HeaderStatusPanel!, {
        scope,
        surface: "app",
        units: ["requests"],
        platformPools: ["p1"],
      }),
    );
    // Six settled plus one expired reservation that no sweep has released yet: reads never mutate.
    const pill = await screen.findByText("3 of 10 requests left");
    expect(pill.closest("[data-level]")?.getAttribute("data-level")).toBe("warning");
    expect(screen.getByText("1 hidden bounds")).toBeTruthy();
  });
  test("coverage summary states what cost excludes", async () => {
    const { CoverageSummaryPanel } = await load(variant, "coverage-summary");
    await withMeter(
      createElement(CoverageSummaryPanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
      }),
    );
    await screen.findByText("6");
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/Cost excludes untracked requests/)).toBeTruthy();
  });
  test("exceptions list shows state and age", async () => {
    const { ExceptionsListPanel } = await load(variant, "exceptions-list");
    await withMeter(
      createElement(ExceptionsListPanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
      }),
    );
    await screen.findByText("Reservation expired");
    expect(screen.getByText("4 s")).toBeTruthy();
    expect(screen.getByText("reserved")).toBeTruthy();
  });
  test("usage filters render the host select with the chosen values", async () => {
    const { UsageFilters } = await load(variant, "usage-filters");
    render(
      createElement(UsageFilters!, {
        period: "this",
        periods: [
          { value: "this", label: "This month" },
          { value: "last", label: "Last month" },
        ],
        onPeriodChange: () => {},
        scope: "me",
        scopes: [{ value: "me", label: "My usage" }],
        onScopeChange: () => {},
      }),
    );
    expect(screen.getByRole("combobox", { name: "Period" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Scope" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("This month")).toBeTruthy());
    expect(screen.getByText("My usage")).toBeTruthy();
  });
  test("connection list shows funding, tags and plan", async () => {
    const { ConnectionList } = await load(variant, "connection-list");
    render(
      createElement(ConnectionList!, {
        connections: [
          { id: "c1", provider: "search", label: "Search", fundingSource: "byok", tags: ["prod"] },
          { id: "c2", provider: "maps", fundingSource: "platform", plan: "developer" },
        ],
      }),
    );
    expect(screen.getByText("Own key")).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("prod")).toBeTruthy();
    expect(screen.getByText("developer")).toBeTruthy();
    expect(screen.getByText("c2")).toBeTruthy();
  });
});
