import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scaler } from "../src/core/scaler.js";
import { JobTracker } from "../src/core/tracker.js";
import type { IBoatClient, IBuildkiteClient, BoatkiteConfig, BuildkiteJob } from "../src/types.js";
import { FakeBoatClient } from "../src/clients/fake-boat.js";
import { FakeBuildkiteClient } from "../src/clients/fake-buildkite.js";

describe("Scaler", () => {
  let boat: FakeBoatClient;
  let buildkite: FakeBuildkiteClient;
  let config: BoatkiteConfig;

  beforeEach(() => {
    boat = new FakeBoatClient();
    buildkite = new FakeBuildkiteClient();
    config = {
      boatApiKey: "test",
      buildkiteToken: "test",
      buildkiteOrg: "test",
      queue: "test",
      maxVms: 2,
      maxJobMinutes: 60,
      pollIntervalMs: 100,
      webhookPort: 8080,
      boatSnapshot: "test-snapshot",
      debugRetentionMinutes: 30,
      defaultSize: "default",
    };
  });

  it("should respect concurrency cap", async () => {
    const jobs: BuildkiteJob[] = [
      { id: "job-1", state: "scheduled", build: { pipeline: { slug: "test" } } },
      { id: "job-2", state: "scheduled", build: { pipeline: { slug: "test" } } },
      { id: "job-3", state: "scheduled", build: { pipeline: { slug: "test" } } },
    ];
    buildkite = new FakeBuildkiteClient({ jobs });

    const scaler = new Scaler({ boat, buildkite, config });
    const tracker = scaler.getTracker();

    // Manually add a running job to simulate capacity
    tracker.add({
      jobId: "existing",
      sandboxId: "bx_existing",
      pipeline: "test",
      size: "default",
      snapshot: "test",
      startedAt: Date.now(),
      state: "running",
    });

    // Start scaler (will run one poll cycle)
    const startPromise = scaler.start();
    await new Promise((r) => setTimeout(r, 200));
    await scaler.stop();
    await startPromise;

    // Should only have started 1 new job (maxVms=2, 1 already running)
    const assignments = tracker.all();
    const newOnes = assignments.filter((a) => a.jobId !== "existing");
    expect(newOnes.length).toBeLessThanOrEqual(1);
  });

  it("should handle idempotency - not create duplicate sandboxes", async () => {
    const jobs: BuildkiteJob[] = [
      { id: "job-1", state: "scheduled", build: { pipeline: { slug: "test" } } },
    ];
    buildkite = new FakeBuildkiteClient({ jobs });

    const scaler = new Scaler({ boat, buildkite, config });
    const tracker = scaler.getTracker();

    // Pre-add the job
    tracker.add({
      jobId: "job-1",
      sandboxId: "bx_existing",
      pipeline: "test",
      size: "default",
      snapshot: "test",
      startedAt: Date.now(),
      state: "running",
    });

    const startPromise = scaler.start();
    await new Promise((r) => setTimeout(r, 200));
    await scaler.stop();
    await startPromise;

    // Should not create a new sandbox for job-1
    const sandboxes = await boat.listSandboxes({ namePrefix: "bk-" });
    expect(sandboxes.length).toBe(0);
  });
});

describe("JobTracker", () => {
  it("should add and retrieve assignments", () => {
    const tracker = new JobTracker();
    tracker.add({
      jobId: "job-1",
      sandboxId: "bx_1",
      pipeline: "test",
      size: "default",
      snapshot: "test",
      startedAt: Date.now(),
      state: "running",
    });

    expect(tracker.has("job-1")).toBe(true);
    expect(tracker.get("job-1")?.sandboxId).toBe("bx_1");
    expect(tracker.countRunning()).toBe(1);
  });

  it("should remove assignments", () => {
    const tracker = new JobTracker();
    tracker.add({
      jobId: "job-1",
      sandboxId: "bx_1",
      pipeline: "test",
      size: "default",
      snapshot: "test",
      startedAt: Date.now(),
      state: "running",
    });

    tracker.remove("job-1");
    expect(tracker.has("job-1")).toBe(false);
    expect(tracker.countRunning()).toBe(0);
  });

  it("should find by sandbox ID", () => {
    const tracker = new JobTracker();
    tracker.add({
      jobId: "job-1",
      sandboxId: "bx_1",
      pipeline: "test",
      size: "default",
      snapshot: "test",
      startedAt: Date.now(),
      state: "running",
    });

    expect(tracker.getBySandbox("bx_1")?.jobId).toBe("job-1");
    expect(tracker.getBySandbox("bx_unknown")).toBeUndefined();
  });
});
