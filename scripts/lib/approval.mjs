import { existsSync, readFileSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { assertCommitMessage } from "./git.mjs";

export function parseApprovalArgs(args) {
  const { values } = parseArgs({
    args,
    options: { "approved-sha": { type: "string" }, subject: { type: "string" } },
  });
  const reviewedSha = values["approved-sha"];
  if (!reviewedSha || !/^[a-f0-9]{40}$/.test(reviewedSha))
    throw new Error(
      "Usage: npm run approve:main -- --approved-sha <full reviewed HEAD SHA> [--subject <Conventional Commit title>]. Explicit owner approval is required.",
    );
  if (values.subject !== undefined) {
    if (/[\r\n]/.test(values.subject)) throw new Error("Squash subject must be one line.");
    assertCommitMessage(values.subject);
    return { reviewedSha, subject: values.subject };
  }
  return { reviewedSha };
}

export function clearExpiredApproval(file, now = Date.now()) {
  if (!existsSync(file)) return;
  const { expiresAt } = JSON.parse(readFileSync(file, "utf8"));
  if (!Number.isFinite(expiresAt)) throw new Error(`Invalid approval expiry: ${file}`);
  if (expiresAt < now) {
    rmSync(file);
    return;
  }
  const seconds = Math.ceil((expiresAt - now) / 1000);
  throw new Error(`Another approval is active: ${file} (${seconds} seconds remaining).`);
}
