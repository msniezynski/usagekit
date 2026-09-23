import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";
import { createManualClock } from "@usagekit/store";
import type { Budget, ReserveInput } from "@usagekit/core";
import { createSqliteStore } from "./index.js";
const input = (id: string = crypto.randomUUID()): ReserveInput => ({
  operationId: id,
  scope: { namespace: "test", principal: "u", connection: "c" },
  fundingSource: "byok",
  costOwner: "u",
  surface: "app",
  source: "app",
  provider: "example",
  operation: "search",
  estimate: [{ unit: "requests", value: 1n, scale: 0 }],
});
const budget: Budget = {
  id: "b",
  version: 1,
  scope: { kind: "principal", namespace: "test", principal: "u" },
  surface: "any",
  unit: "requests",
  limit: { unit: "requests", value: 1n, scale: 0 },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
};
const workerCode = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {createSqliteStore}=await import(workerData.module);const {createManualClock}=await import('@usagekit/store');const s=createSqliteStore({path:workerData.path,clock:createManualClock()});parentPort.postMessage('ready');parentPort.once('message',async()=>{try{parentPort.postMessage(await s.reserve(workerData.input));}catch(e){parentPort.postMessage({error:e.message});}finally{s.close();}});})()`;
const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
function child(path: string, id: string, mode: "intent" | "race" | "budget") {
  const script = `import {createSqliteStore} from ${JSON.stringify(moduleUrl)};import {createManualClock} from '@usagekit/store';const store=createSqliteStore({path:process.env.DB_PATH,clock:createManualClock()});process.send('ready');process.on('message',async()=>{if(process.env.MODE==='budget'){const b=JSON.parse(process.env.BUDGET);b.limit.value=1n;const result=store.putBudget(b);process.send({outcome:result.outcome});store.close();process.exit(0);return;}const r=await store.reserve({...JSON.parse(process.env.INPUT),estimate:[{unit:'requests',value:1n,scale:0}]});if(process.env.MODE==='intent'&&r.outcome==='reserved'){const g=await store.markDispatchIntent({namespace:'test',principal:'u',operationId:r.operation.operationId,commandId:'intent',expectedVersion:1,holder:'child',leaseTtlMs:60000});process.send({state:g.operation.state});}else{process.send({outcome:r.outcome});store.close();process.exit(0);}});`;
  return fork("--eval", [script], {
    execArgv: ["--input-type=module"],
    env: {
      ...process.env,
      DB_PATH: path,
      INPUT: JSON.stringify(input(id), (_, v) => (typeof v === "bigint" ? v.toString() : v)),
      MODE: mode,
      BUDGET: JSON.stringify(budget, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}
const message = (p: ReturnType<typeof child>) =>
  new Promise<any>((resolve, reject) => {
    p.once("message", resolve);
    p.once("error", reject);
    p.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Child exited ${code}`));
    });
  });
test("process kill preserves intent; recovery settles durable budget usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-restart-")),
    path = join(dir, "usage.db"),
    clock = createManualClock();
  let s = createSqliteStore({ path, clock });
  s.putBudget(budget);
  s.close();
  const p = child(path, "op", "intent");
  try {
    await message(p);
    const result = message(p);
    p.send("go");
    expect(await result).toEqual({ state: "dispatch_intended" });
    const exited = new Promise((resolve) => p.once("exit", resolve));
    p.kill("SIGKILL");
    await exited;
    clock.advance(60001);
    s = createSqliteStore({ path, clock });
    const ref = { namespace: "test", principal: "u", operationId: "op" };
    const op = await s.getOperation(ref);
    expect(op).toMatchObject({
      state: "dispatch_intended",
      receipts: [],
      lease: { holder: "child" },
    });
    expect(Date.parse(op!.lease!.expiresAt)).toBeLessThan(clock.now().getTime());
    const claim = await s.claimForRecovery({ ...ref, holder: "parent", leaseTtlMs: 1000 });
    if (!("claimed" in claim) || !claim.claimed) throw new Error("claim");
    expect(
      await s.markDispatchIntent({
        ...ref,
        commandId: "new",
        expectedVersion: claim.operation.version,
        holder: "parent",
        leaseTtlMs: 1,
      }),
    ).toMatchObject({ reason: "already_dispatched" });
    expect(
      await s.settle({
        ...ref,
        commandId: "settle",
        expectedVersion: claim.operation.version,
        authority: { kind: "recovery", leaseId: claim.lease.leaseId },
        receipt: {
          id: "r",
          measurements: [
            {
              unit: "requests",
              quantity: { unit: "requests", value: 1n, scale: 0 },
              certainty: "measured",
            },
          ],
          cost: { certainty: "measured", money: { units: 1n, currency: "USD" } },
          occurredAt: clock.now().toISOString(),
          recordedAt: clock.now().toISOString(),
          cached: false,
          failed: false,
        },
      }),
    ).toMatchObject({ outcome: "settled" });
    expect(
      s.database.prepare("SELECT settled_value,outstanding_value FROM budget_usage").get(),
    ).toEqual({ settled_value: 1n, outstanding_value: 0n });
    console.info(
      "Restart: SIGKILL -> expired intent -> recovery -> settled usage 1, outstanding 0",
    );
  } finally {
    p.kill();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("crash hook rolls back operation and budget_usage together", async () => {
  const clock = createManualClock(),
    s = createSqliteStore({
      path: ":memory:",
      clock,
      budgets: [budget],
      testHooks: {
        afterOperationWrite: () => {
          throw new Error("simulated crash");
        },
      },
    });
  try {
    await expect(s.reserve(input())).rejects.toThrow("simulated crash");
    expect(s.database.prepare("SELECT count(*) AS n FROM operations").get()).toEqual({ n: 0n });
    expect(s.database.prepare("SELECT count(*) AS n FROM budget_usage").get()).toEqual({ n: 0n });
  } finally {
    s.close();
  }
});
test("two children race for one slot in twenty independent epochs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-race-")),
    path = join(dir, "usage.db"),
    clock = createManualClock(),
    s = createSqliteStore({ path, clock });
  try {
    for (let n = 0; n < 20; n++) {
      s.putBudget({
        ...budget,
        version: n + 1,
        window: { kind: "since_reset", epoch: `e${n}`, startsAt: "2026-09-01T00:00:00Z" },
      });
      const a = child(path, `a${n}`, "race"),
        b = child(path, `b${n}`, "race");
      try {
        await Promise.all([message(a), message(b)]);
        const results = Promise.all([message(a), message(b)]);
        a.send("go");
        b.send("go");
        expect((await results).map((r) => r.outcome).sort()).toEqual(["exceeded", "reserved"]);
      } finally {
        a.kill();
        b.kill();
      }
    }
    console.info("Two-process admission race: 20/20, exactly one winner each");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("two worker handles serialize concurrent admission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-workers-")),
    path = join(dir, "usage.db"),
    s = createSqliteStore({ path, clock: createManualClock() });
  s.putBudget(budget);
  const workers = [0, 1].map(
    () =>
      new Worker(workerCode, {
        eval: true,
        workerData: { module: moduleUrl, path, input: input() },
      }),
  );
  try {
    await Promise.all(workers.map((w) => new Promise((resolve) => w.once("message", resolve))));
    const results = Promise.all(
      workers.map((w) => new Promise<any>((resolve) => w.once("message", resolve))),
    );
    workers.forEach((w) => w.postMessage("go"));
    expect((await results).map((r) => r.outcome).sort()).toEqual(["exceeded", "reserved"]);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two processes competing for the same budget version have one winner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-budget-race-")),
    path = join(dir, "usage.db"),
    s = createSqliteStore({ path, clock: createManualClock() }),
    a = child(path, "a", "budget"),
    b = child(path, "b", "budget");
  try {
    await Promise.all([message(a), message(b)]);
    const results = Promise.all([message(a), message(b)]);
    a.send("go");
    b.send("go");
    expect((await results).map((r) => r.outcome).sort()).toEqual(["conflict", "saved"]);
    expect(s.listBudgets()).toHaveLength(1);
    console.info("Budget version race: two processes, one saved, one conflict");
  } finally {
    a.kill();
    b.kill();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
