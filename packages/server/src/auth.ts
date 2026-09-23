import { timingSafeEqual, randomBytes } from "node:crypto";
import type { AccessContext } from "@usagekit/core";
import { hashToken, writePrivate } from "./config.js";
import type { Config } from "./config.js";
export const localAccess: AccessContext = {
  namespace: "local",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
export function createAuth(config: Config, path: string) {
  return {
    authenticate: async (request: Request): Promise<AccessContext | null> => {
      const header = request.headers.get("Authorization");
      if (!header?.startsWith("Bearer ")) return null;
      const actual = Buffer.from(hashToken(header.slice(7)), "hex"),
        expected = Buffer.from(config.tokenHash, "hex");
      return timingSafeEqual(actual, expected) ? localAccess : null;
    },
    rotate: () => {
      const token = randomBytes(32).toString("base64url"),
        next = { ...config, tokenHash: hashToken(token) };
      writePrivate(path, JSON.stringify(next));
      config.tokenHash = next.tokenHash;
      return token;
    },
  };
}
