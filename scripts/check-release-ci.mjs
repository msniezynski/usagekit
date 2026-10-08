import assert from "node:assert/strict";
import { git, run } from "./lib/git.mjs";
import { validateReleaseCi } from "./lib/trusted-release.mjs";

const head = process.env.USAGEKIT_APPROVED_RELEASE_SHA;
assert.equal(git(["rev-parse", "HEAD"]), head);
const api = (path) => JSON.parse(run("gh", ["api", `repos/msniezynski/usagekit/${path}`]));
const runs = api(`actions/workflows/ci.yml/runs?head_sha=${head}&per_page=100`).workflow_runs;
const latest = runs.filter((run) => run.head_sha === head).sort((a, b) => b.id - a.id)[0];
assert.ok(latest, "Run CI on the approved SHA before starting the release.");
const jobs = api(`actions/runs/${latest.id}/jobs?per_page=100`).jobs;
console.log(`Verified exact-source CI run ${validateReleaseCi(runs, jobs, head)} for ${head}.`);
