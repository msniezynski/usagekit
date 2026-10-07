import type { ProviderActionResult } from "@usagekit/views";
import { retainReadInput } from "./keys.js";

/** Fixed credential diagnostics preserve verified outcomes without retaining provider error text. */
export function retainProviderReply(
  reply: ProviderActionResult,
  credentialBearing: boolean,
): ProviderActionResult {
  if (!credentialBearing) return retainReadInput(reply);
  switch (reply.outcome) {
    case "success":
      return retainReadInput({
        ...reply,
        message: "Provider command completed",
        ...(reply.connection
          ? {
              connection: { ...reply.connection, status: { state: reply.connection.status.state } },
            }
          : {}),
      });
    case "conflict":
      return retainReadInput({
        ...reply,
        reason: "Provider configuration changed; reload the current revision",
      });
    case "invalid":
      return retainReadInput({ ...reply, reason: "The host rejected the supplied fields" });
    case "unavailable":
      return retainReadInput({ ...reply, message: "The provider command is unavailable" });
    case "forbidden":
      return retainReadInput(reply);
  }
}
export function forgetEphemeralSecrets(secrets: Record<string, string> | undefined): void {
  if (secrets) for (const key of Object.keys(secrets)) delete secrets[key];
}
