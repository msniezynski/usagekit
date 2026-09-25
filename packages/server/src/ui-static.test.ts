import { afterEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-ui-"));
  dirs.push(dir);
  return dir;
};

test("the built UI is served at / without a token; the API still requires one", async () => {
  const ui = directory();
  mkdirSync(join(ui, "assets"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>usagekit</title>");
  writeFileSync(join(ui, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(ui, "assets", "app.css"), "body{}");
  const s = await startServer({ configDir: directory(), port: 0, uiRoot: ui, onToken: () => {} });
  try {
    const index = await s.app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect(await index.text()).toContain("<title>usagekit</title>");
    const script = await s.app.request("/assets/app.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect((await s.app.request("/assets/app.css")).headers.get("content-type")).toContain(
      "text/css",
    );
    expect((await s.app.request("/assets/missing.js")).status).toBe(401);
    expect((await s.app.request("/assets/..%2F..%2Findex.html")).status).toBe(401);
    expect((await s.app.request("/v1/usage")).status).toBe(401);
    expect((await s.app.request("/budgets")).status).toBe(401);
    expect((await s.app.request("/", { method: "POST" })).status).toBe(401);
  } finally {
    await s.stop();
  }
});

test("without a built UI the root answers 404 after authentication", async () => {
  let token = "";
  const s = await startServer({
    configDir: directory(),
    port: 0,
    uiRoot: join(directory(), "absent"),
    onToken: (t) => {
      token = t;
    },
  });
  try {
    expect((await s.app.request("/")).status).toBe(401);
    expect(
      (await s.app.request("/", { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(404);
  } finally {
    await s.stop();
  }
});

test("the UI uses the base registry blocks and base primitives unchanged", () => {
  const server = join(import.meta.dirname, "..");
  const registry = join(server, "../registry");
  for (const block of [
    "usage-table",
    "budget-card",
    "header-status",
    "coverage-summary",
    "exceptions-list",
    "usage-filters",
    "connection-list",
  ])
    expect(readFileSync(join(server, "ui/components/usagekit", `${block}.tsx`), "utf8")).toBe(
      readFileSync(join(registry, "registry/base", block, `${block}.tsx`), "utf8"),
    );
  for (const primitive of ["table", "card", "badge", "tooltip", "select", "button"])
    expect(readFileSync(join(server, "ui/components/ui", `${primitive}.tsx`), "utf8")).toBe(
      readFileSync(join(registry, "consumers/base/components/ui", `${primitive}.tsx`), "utf8"),
    );
});
