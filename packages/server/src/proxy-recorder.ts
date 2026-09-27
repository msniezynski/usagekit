import { join } from "node:path";
import type { ProxyOptions } from "@usagekit/proxy";
import type { Catalog } from "@usagekit/providers";
import { writePrivate } from "./config.js";
import { redactFixture } from "./redaction.js";
/** Explicit recordings are separate from the content-free ledger. Never record by default. */
export function createProxyRecorder({
  catalog,
  dir,
  now,
}: {
  catalog: Catalog;
  dir: string;
  now: () => Date;
}): NonNullable<ProxyOptions["recordFixture"]> {
  return async ({ provider, operation, request, status, body, secrets }) => {
    const descriptor = catalog.providers().find((p) => p.id === provider);
    if (
      !descriptor ||
      ![provider, operation].every((v) => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(v))
    )
      throw new Error("InvalidFixturePath");
    const fixture = redactFixture(
      {
        origin: "recorded",
        provider,
        operation,
        recordedAt: now().toISOString(),
        request,
        response: { status, body },
        expect: {},
      },
      descriptor,
      secrets,
    );
    writePrivate(
      join(dir, "fixtures", provider, operation, crypto.randomUUID() + ".json"),
      JSON.stringify(fixture, null, 2) + "\n",
    );
  };
}
