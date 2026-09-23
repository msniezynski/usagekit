import { describe, afterAll } from "vitest";
import type { StoreFactory, StoreCapabilities } from "./factory.js";
import { expirationTests } from "./expiration.test.js";
import { reserveTests } from "./reserve.test.js";
import { admissionTests } from "./admission.test.js";
import { dispatchTests } from "./dispatch.test.js";
import { authorityTests } from "./authority.test.js";
import { recoveryTests } from "./recovery.test.js";
import { readsTests } from "./reads.test.js";
import { propertyTests } from "./properties.test.js";
import { capabilityTests } from "./capabilities.test.js";
export function runStoreConformance(factory: StoreFactory, capabilities: StoreCapabilities) {
  describe("store conformance", () => {
    reserveTests(factory);
    expirationTests(factory);
    admissionTests(factory);
    dispatchTests(factory);
    authorityTests(factory);
    recoveryTests(factory);
    readsTests(factory, capabilities);
    propertyTests(factory);
    capabilityTests(factory, capabilities);
    afterAll(() =>
      console.info(
        "Skipped guarantees: " +
          [!capabilities.durable && "durable", !capabilities.rollingWindows && "rollingWindows"]
            .filter(Boolean)
            .join(", "),
      ),
    );
  });
}
