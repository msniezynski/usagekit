import assert from "node:assert/strict";

export const trustedNpmVersion = "11.16.0";

export function validateTrustedRelease(env, head, version) {
  assert.equal(env.GITHUB_ACTIONS, "true", "Trusted publishing requires GitHub Actions.");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REPOSITORY, "msniezynski/usagekit");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    "msniezynski/usagekit/.github/workflows/release.yml@refs/heads/main",
  );
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(env.GITHUB_SHA, head);
  assert.equal(env.USAGEKIT_APPROVED_RELEASE_SHA, head, "Approve this exact source SHA.");
  assert.equal(env.USAGEKIT_APPROVED_RELEASE_VERSION, version);
  assert.ok(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  for (const name of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "NPM_CONFIG_OTP", "npm_config_otp"])
    assert.ok(!env[name], "Trusted publishing must use OIDC without a token or OTP.");
}

export function validateReleaseCi(runs, jobs, head) {
  const latest = runs
    .filter((run) => run.head_sha === head && run.name === "CI")
    .sort((a, b) => b.id - a.id)[0];
  assert.ok(latest, "The approved SHA has no CI run.");
  assert.equal(latest.status, "completed");
  assert.equal(latest.conclusion, "success", "The latest exact-source CI must pass.");
  const verify = jobs.find((job) => job.name === "verify");
  assert.equal(verify?.conclusion, "success");
  for (const required of [
    "npm run test:unit",
    "npm run test:postgres",
    "npm run test:cloudflare:example",
    "npm run check:consumer",
  ])
    assert.ok(
      verify.steps.some((step) => step.name.includes(required) && step.conclusion === "success"),
      `Missing successful CI step: ${required}`,
    );
  return latest.id;
}
