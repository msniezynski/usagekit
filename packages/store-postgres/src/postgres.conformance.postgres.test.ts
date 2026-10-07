import { runStoreConformance, runStoreScalingConformance } from "@usagekit/store/conformance";
import { fixture } from "./test-fixture.js";

runStoreConformance(fixture, {
  durable: true,
  rollingWindows: false,
  maxMoneyUnits: 2n ** 63n - 1n,
  maxQuantityScale: 18,
});
runStoreScalingConformance(async () => {
  const f = await fixture();
  return {
    store: f.store,
    snapshot: () => ({ ...f.counters }),
    close: f.close,
    async readOnly(run) {
      await run();
    },
  };
});
