import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReleaseCi, validateTrustedRelease } from "../lib/trusted-release.mjs";

const head = "a".repeat(40);
const valid = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "msniezynski/usagekit",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "msniezynski/usagekit/.github/workflows/release.yml@refs/heads/main",
  GITHUB_SHA: head,
  USAGEKIT_APPROVED_RELEASE_SHA: head,
  USAGEKIT_APPROVED_RELEASE_VERSION: "0.6.0",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-fixture",
};

test("OIDC release binds owner approval to hosted main and the configured workflow", () => {
  validateTrustedRelease(valid, head, "0.6.0");
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REPOSITORY: "someone/usagekit" },
    { GITHUB_REF: "refs/heads/feat/example" },
    { GITHUB_WORKFLOW_REF: "msniezynski/usagekit/.github/workflows/ci.yml@refs/heads/main" },
    { GITHUB_SHA: "b".repeat(40) },
    { USAGEKIT_APPROVED_RELEASE_SHA: "b".repeat(40) },
    { USAGEKIT_APPROVED_RELEASE_VERSION: "0.7.0" },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
    { NPM_TOKEN: "test-fixture" },
    { NODE_AUTH_TOKEN: "test-fixture" },
    { NPM_CONFIG_OTP: "test-fixture" },
  ])
    assert.throws(() => validateTrustedRelease({ ...valid, ...change }, head, "0.6.0"));
});

test("release rejects stale green CI when the latest attempt failed or coverage is missing", () => {
  const run = { id: 1, head_sha: head, name: "CI", status: "completed", conclusion: "success" };
  const verify = {
    name: "verify",
    conclusion: "success",
    steps: ["test:unit", "test:postgres", "test:cloudflare:example", "check:consumer"].map(
      (name) => ({ name: `npm run ${name}`, conclusion: "success" }),
    ),
  };
  assert.equal(validateReleaseCi([run], [verify], head), 1);
  assert.throws(() => validateReleaseCi([{ ...run, head_sha: "b".repeat(40) }], [verify], head));
  assert.throws(() =>
    validateReleaseCi([run, { ...run, id: 2, conclusion: "failure" }], [verify], head),
  );
  assert.throws(() => validateReleaseCi([{ ...run, status: "in_progress" }], [verify], head));
  assert.throws(() =>
    validateReleaseCi([run], [{ ...verify, steps: verify.steps.slice(1) }], head),
  );
  assert.throws(() => validateReleaseCi([run], [{ ...verify, conclusion: "skipped" }], head));
});
