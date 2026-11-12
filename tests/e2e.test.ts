/**
 * E2E mock scenarios — 6 scenarios exercising the full scaler loop with a
 * virtual clock. No network, no API keys, all well under 5s wall time.
 *
 * Scenario 1: Concurrency cap (maxVms)
 * Scenario 2: Idempotency (existing sandbox + Idempotency-Key)
 * Scenario 3: 429 backoff
 * Scenario 4: Orphan cleanup
 * Scenario 5: Job cancelled mid-run
 * Scenario 6: Restart recovery
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scaler } from "../src/core/scaler.js";
import type { BoatSandbox, BoatkiteConfig, BuildkiteJob } from "../src/types.js";
import {
  type E2EBoatClient,
  type E2EBuildkiteClient,
  type E2EEnv,
  type VirtualClock,
  makeEnv,
  makeJob,
  runUntilStable,
} from "./e2e-mock.js";

const QUEUE = "boatkite-e2e";
const PIPELINE = "test-pipeline";
const LABELS = { jobId: "", pipeline: PIPELINE, managedBy: "boatkite", source: "boatkite-scaler" };

function makeConfig(overrides: Partial<BoatkiteConfig> = {}): BoatkiteConfig {
  return {
    boatApiKey: "boat_test_key",
    buildkiteToken: "bk_test_token",
    agentToken: "bk_agent_token",
    buildkiteOrg: "test-org",
    queue: QUEUE,
    maxVms: 2,
    maxJobMinutes: 30,
    pollIntervalMs: 1_000,
    webhookPort: 0,
    boatSnapshot: "snapshot-test",
    debugRetentionMinutes: 5,
    defaultSize: "default",
    ...overrides,
  };
}

/** A job whose id is a uuid so tracker/orphan name matching works. */
function makeUuidJob(pipeline = PIPELINE): { job: BuildkiteJob; jobId: string } {
  const jobId = crypto.randomUUID();
  return { job: makeJob(jobId, pipeline, "scheduled"), jobId };
}

/**
 * Start a Scaler wired to the virtual clock and remember how to stop it.
 * stop() flips the running flag so the poll/monitor loops exit on their next
 * iteration; pending virtual sleeps are simply abandoned (the clock is
 * per-environment and never touched again after a test ends).
 */
function startScaler(
  env: E2EEnv,
  config: BoatkiteConfig,
): {
  scaler: Scaler;
  stop: () => Promise<void>;
} {
  const scaler = new Scaler({
    boat: env.boat,
    buildkite: env.buildkite,
    config,
    sleep: (ms) => env.clock.sleep(ms),
  });
  scaler.start().catch(() => {
    // Scaler was stopped or the clock abandoned; ignore the rejection.
  });
  return {
    scaler,
    stop: async () => {
      await scaler.stop();
    },
  };
}

/** Wait until a sandbox carrying this job's label exists; return it. */
async function waitForSandbox(
  clock: VirtualClock,
  boat: E2EBoatClient,
  jobId: string,
  maxMs = 60_000,
): Promise<BoatSandbox | undefined> {
  const start = clock.now;
  while (clock.now - start < maxMs) {
    const sb = [...boat.sandboxes.values()].find((s) => s.labels?.jobId === jobId);
    if (sb) return sb;
    await clock.tick(250);
  }
  return [...boat.sandboxes.values()].find((s) => s.labels?.jobId === jobId);
}

/** Wait until the job's tracker assignment exists; return it. */
async function waitForAssignment(
  clock: VirtualClock,
  scaler: Scaler,
  jobId: string,
  maxMs = 60_000,
) {
  const start = clock.now;
  while (clock.now - start < maxMs) {
    const a = scaler.getTracker().get(jobId);
    if (a) return a;
    await clock.tick(250);
  }
  return scaler.getTracker().get(jobId);
}

/** Wait until the agent's detached process has started on the job's sandbox. */
async function runUntilAgentRunning(
  clock: VirtualClock,
  boat: E2EBoatClient,
  jobId: string,
  maxMs = 60_000,
): Promise<{ sb: BoatSandbox; processId: string } | undefined> {
  const start = clock.now;
  while (clock.now - start < maxMs) {
    const sb = [...boat.sandboxes.values()].find((s) => s.labels?.jobId === jobId);
    const ids = sb ? boat.getDetachedProcessIds(sb.id) : [];
    if (sb && ids.length > 0) return { sb, processId: ids[0] };
    await clock.tick(250);
  }
  return undefined;
}

describe("boatkite e2e", () => {
  let env: E2EEnv;
  let clock: VirtualClock;
  let boat: E2EBoatClient;
  let buildkite: E2EBuildkiteClient;
  let handle: { scaler: Scaler; stop: () => Promise<void> } | undefined;

  beforeEach(() => {
    vi.stubEnv("LOG_LEVEL", "error");
    env = makeEnv();
    clock = env.clock;
    boat = env.boat;
    buildkite = env.buildkite;
  });

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    vi.unstubAllEnvs();
  });

  it("scenario 1: enforces the concurrency cap (maxVms)", async () => {
    const { job: j1 } = makeUuidJob();
    const { job: j2 } = makeUuidJob();
    const { job: j3 } = makeUuidJob();
    buildkite.seedJob(j1);
    buildkite.seedJob(j2);
    buildkite.seedJob(j3);

    handle = startScaler(env, makeConfig({ maxVms: 2 }));

    // Two VMs start; the third job waits for a slot.
    await runUntilStable(clock, () => boat.sandboxCount === 2, 30_000);
    expect(boat.createCount).toBe(2);
    expect(boat.sandboxCount).toBe(2);

    // Finish job 1's agent (process exits) -> slot frees -> job 3 starts.
    const agent1 = await runUntilAgentRunning(clock, boat, j1.id);
    expect(agent1).toBeTruthy();
    boat.finishCommand(agent1?.sb.id, agent1?.processId, 0);
    buildkite.setJobState(j1.id, "passed");

    await runUntilStable(clock, () => boat.createCount >= 3, 60_000);
    expect(boat.createCount).toBe(3);
    const sb3 = await waitForSandbox(clock, boat, j3.id);
    expect(sb3).toBeTruthy();
    expect(boat.sandboxes.has(j3.id)).toBe(false); // sandbox id != job id
  });

  it("scenario 2: is idempotent (existing sandbox + idempotency key)", async () => {
    const { job, jobId } = makeUuidJob();
    buildkite.seedJob(job);

    // A sandbox for this job already exists (e.g. a prior attempt).
    boat.seedSandbox({
      id: "sbx-existing",
      name: `bk-${PIPELINE}-${jobId}`,
      state: "ready",
      type: "default",
      labels: { ...LABELS, jobId },
    });

    handle = startScaler(env, makeConfig());

    // The scaler reuses the existing sandbox: it tracks the job against it
    // without creating a new one.
    const assignment = await waitForAssignment(clock, handle?.scaler, jobId);
    expect(assignment).toBeTruthy();
    expect(assignment?.sandboxId).toBe("sbx-existing");
    expect(boat.createCount).toBe(0);
    expect(boat.sandboxes.has("sbx-existing")).toBe(true);

    // Idempotency contract at the client level: a repeated key reuses the
    // same sandbox instead of creating a second one.
    const first = await boat.createSandbox({ name: "bk-dup", idempotencyKey: "key-abc" });
    const second = await boat.createSandbox({ name: "bk-dup", idempotencyKey: "key-abc" });
    expect(second.sandbox.id).toBe(first.sandbox.id);
    expect(boat.idempotencyLog.filter((k) => k === "key-abc")).toHaveLength(2);
  });

  it("scenario 3: retries create after a 429 with backoff", async () => {
    const { job, jobId } = makeUuidJob();
    buildkite.seedJob(job);
    boat.failNextCreate429 = 1; // first createSandbox throws 429

    handle = startScaler(env, makeConfig());

    // The 429 was retried: create was called twice and a sandbox now exists.
    const sb = await waitForSandbox(clock, boat, jobId);
    expect(sb).toBeTruthy();
    expect(boat.createCount).toBe(2);
    expect(sb?.labels?.jobId).toBe(jobId);

    // The job now runs: finish the agent -> the sandbox is cleaned up.
    const agent = await runUntilAgentRunning(clock, boat, jobId);
    expect(agent).toBeTruthy();
    boat.finishCommand(agent?.sb.id, agent?.processId, 0);
    buildkite.setJobState(jobId, "passed");
    await runUntilStable(clock, () => !boat.sandboxes.has(sb?.id), 60_000);
    expect(boat.sandboxes.has(sb?.id)).toBe(false);
  });

  it("scenario 4: cleans up orphan sandboxes", async () => {
    // Orphan A: its Buildkite job has passed (should be deleted).
    const passedJobId = crypto.randomUUID();
    buildkite.seedJob(makeJob(passedJobId, PIPELINE, "passed"));
    boat.seedSandbox({
      id: "sbx-orphan-passed",
      name: `bk-${PIPELINE}-${passedJobId}`,
      state: "idle",
      type: "default",
      labels: { ...LABELS, jobId: passedJobId },
    });

    // Orphan B: no matching Buildkite job at all (should be deleted).
    const ghostJobId = crypto.randomUUID();
    boat.seedSandbox({
      id: "sbx-orphan-ghost",
      name: `bk-${PIPELINE}-${ghostJobId}`,
      state: "idle",
      type: "default",
      labels: { ...LABELS, jobId: ghostJobId },
    });

    // Tracked sandbox: belongs to a running job in the tracker (kept).
    const { job, jobId } = makeUuidJob();
    buildkite.seedJob(job);
    handle = startScaler(env, makeConfig());
    const tracked = await waitForAssignment(clock, handle?.scaler, jobId);
    expect(tracked).toBeTruthy();
    const trackedSbId = tracked?.sandboxId;

    await handle?.scaler.cleanupOrphans();

    expect(boat.sandboxes.has("sbx-orphan-passed")).toBe(false);
    expect(boat.sandboxes.has("sbx-orphan-ghost")).toBe(false);
    expect(boat.sandboxes.has(trackedSbId)).toBe(true);
  });

  it("scenario 5: stops the agent when a job is cancelled mid-run", async () => {
    const { job, jobId } = makeUuidJob();
    buildkite.seedJob(job);

    handle = startScaler(env, makeConfig());

    // Wait until the agent process is running on the sandbox.
    const agent = await runUntilAgentRunning(clock, boat, jobId);
    expect(agent).toBeTruthy();
    expect(boat.sandboxes.has(agent?.sb.id)).toBe(true);

    // Buildkite cancels the job while the agent is running.
    buildkite.setJobState(jobId, "canceled");

    // The monitor notices, stops the command and removes the sandbox.
    await runUntilStable(clock, () => !boat.sandboxes.has(agent?.sb.id), 60_000);
    expect(boat.sandboxes.has(agent?.sb.id)).toBe(false);
    expect(handle?.scaler.getTracker().has(jobId)).toBe(false);
  });

  it("scenario 6: recovers state across a restart", async () => {
    const { job, jobId } = makeUuidJob();
    buildkite.seedJob(job);

    // First run: the scaler creates the sandbox and drives it to ready.
    handle = startScaler(env, makeConfig());
    const first = await waitForSandbox(clock, boat, jobId);
    expect(first).toBeTruthy();
    const firstSb = first as BoatSandbox;
    expect(firstSb.name).toBe(`bk-${PIPELINE}-${jobId}`);
    await runUntilStable(clock, () => boat.sandboxes.get(firstSb.id)?.state === "ready", 30_000);
    expect(boat.createCount).toBe(1);

    // Restart: new scaler (fresh tracker) on the SAME boat/buildkite state —
    // the sandbox persists with the same id.
    await handle?.stop();
    handle = undefined;

    env = makeEnv();
    clock = env.clock;
    boat = env.boat;
    buildkite = env.buildkite;
    buildkite.seedJob(job);
    boat.seedSandbox({ ...firstSb });

    handle = startScaler(env, makeConfig());

    // Recovery re-attaches to the SAME sandbox instead of creating a new one.
    const assignment = await waitForAssignment(clock, handle?.scaler, jobId);
    expect(assignment).toBeTruthy();
    expect(assignment?.sandboxId).toBe(firstSb.id);
    expect(boat.createCount).toBe(0);
    expect(boat.sandboxes.size).toBe(1);
  });
});
