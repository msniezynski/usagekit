import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const bundle = async (name) =>
  (
    await build({
      entryPoints: [`examples/cloudflare-worker/remote/${name}.ts`],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers"],
    })
  ).outputFiles[0].text;
const [owner, gateway] = await Promise.all([bundle("owner"), bundle("gateway")]);
const vars = { NAMESPACE: "demo", REVISION: "initial", USAGEKIT_TOKEN: "local-fixture" };
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      ...["a", "b"].map((name) => ({
        name,
        modules: true,
        script: gateway,
        compatibilityDate: "2026-09-27",
        bindings: { ...vars, GATEWAY: name },
        durableObjects: {
          LEDGER: { className: "UsageLedger", scriptName: "owner", useSQLite: true },
          REMOTE: { className: "RemoteLedger", scriptName: "owner", useSQLite: true },
        },
      })),
      {
        name: "owner",
        modules: true,
        script: owner,
        compatibilityDate: "2026-09-27",
        bindings: { ...vars, GATEWAY: "owner" },
        durableObjects: {
          LEDGER: { className: "UsageLedger", useSQLite: true },
          REMOTE: { className: "RemoteLedger", useSQLite: true },
        },
      },
    ],
  }),
);
const encode = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? { $bigint: String(v) } : v));
const call = async (method, input, failBeforeCommit = false) => {
  const r = await mf.dispatchFetch("https://local/test", {
    method: "POST",
    headers: { authorization: "Bearer local-fixture" },
    body: encode({ run: "p7-local", method, input, now: "2026-09-27T12:00:00Z", failBeforeCommit }),
  });
  const text = await r.text();
  return {
    status: r.status,
    body: r.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text,
  };
};
try {
  assert.equal((await mf.dispatchFetch("https://local/test")).status, 401);
  assert.equal((await call("inspect")).status, 200);
  const input = {
    operationId: "one",
    scope: { namespace: "p7-local", principal: "a", connection: "c" },
    fundingSource: "byok",
    costOwner: "a",
    surface: "app",
    source: "app",
    provider: "example",
    operation: "search",
    estimate: [{ unit: "requests", value: 1n, scale: 0 }],
  };
  assert.match((await call("reserve", input, true)).body.error.message, /injected before commit/);
  assert.equal(
    (await call("getOperation", { namespace: "p7-local", principal: "a", operationId: "one" })).body
      .result,
    null,
  );
  assert.equal((await call("reserve", input)).body.result.outcome, "reserved");
  assert.equal(
    (await call("reserve", { ...input, scope: { ...input.scope, namespace: "wrong" } })).status,
    403,
  );
  console.log(
    "Remote harness local validation PASS: auth, RPC, scope, commit failure rollback and retry.",
  );
} finally {
  await mf.dispose();
}
