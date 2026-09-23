import assert from "node:assert/strict";
import { test } from "node:test";
import { parseApprovalArgs } from "../lib/approval.mjs";

const sha = "a".repeat(40);
test("approval accepts an explicit Conventional Commit squash subject", () => {
  const subject = "feat: add embedded metering and durable local server";
  assert.deepEqual(parseApprovalArgs(["--approved-sha", sha, "--subject", subject]), {
    reviewedSha: sha,
    subject,
  });
  assert.deepEqual(parseApprovalArgs(["--approved-sha", sha]), { reviewedSha: sha });
});

test("approval rejects missing identity, unknown options and unsafe subjects", () => {
  for (const args of [[], ["--approved-sha", "short"], ["--approved-sha", sha, "--unknown"]])
    assert.throws(() => parseApprovalArgs(args));
  for (const subject of ["", "Merge branch", "feat: title\nbody", "feat: Co-Authored-By: x"])
    assert.throws(() => parseApprovalArgs(["--approved-sha", sha, "--subject", subject]));
});
