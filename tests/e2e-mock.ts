/**
 * E2E mock: in-process Boat + Buildkite simulators driven by a virtual
 * clock, so the 6 E2E scenarios run deterministically in milliseconds.
 * No network, no API keys.
 */

import { BoatApiError } from "../src/clients/boat-client.js";
import type {
  BoatLimits,
  BoatSandbox,
  BoatUsage,
  BuildkiteAgent,
  BuildkiteBuild,
  BuildkiteJob,
  BuildkitePipeline,
  CommandOptions,
  CommandResult,
  CommandStarted,
  CreateSandboxOptions,
  IBoatClient,
  IBuildkiteClient,
  JobState,
  SandboxState,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Virtual clock
// ---------------------------------------------------------------------------

export class VirtualClock {
  private nowMs = 0;
  private sleepers: Array<{ deadline: number; resolve: () => void }> = [];

  get now(): number {
    return this.nowMs;
  }

  /** Register a virtual sleep that resolves when the clock passes it. */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepers.push({ deadline: this.nowMs + ms, resolve });
    });
  }

  /**
   * Advance the clock by ms, resolving due sleepers in deadline order
   * and flushing the microtask queue between each step so state
   * changes (e.g. a sandbox flipping to ready) settle deterministically.
   */
  async tick(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    while (this.sleepers.length > 0) {
      const due = this.sleepers
        .filter((s) => s.deadline <= target)
        .sort((a, b) => a.deadline - b.deadline);
      if (due.length === 0) break;
      const next = due[0].deadline;
      this.nowMs = next;
      for (const s of this.sleepers) {
        if (s.deadline <= this.nowMs) {
          s.resolve();
        }
      }
      this.sleepers = this.sleepers.filter((s) => s.deadline > this.nowMs);
      await Promise.resolve();
    }
    this.nowMs = target;
  }
}

// ---------------------------------------------------------------------------
// E2E Boat client
// ---------------------------------------------------------------------------

interface TrackedCommand {
  sandboxId: string;
  processId: string;
  command: string;
  running: boolean;
  exitCode: number;
  startedAt: number;
}

/**
 * In-memory IBoatClient. Time comes from the VirtualClock.
 *
 * - createSandbox honors options.idempotencyKey (a repeated key returns
 *   the same sandbox) and simulates ~3s provisioning (provisioning ->
 *   ready) on the virtual clock.
 * - runCommandDetached stores the process as running WITHOUT any real
 *   timer; tests drive completion with finishCommand().
 * - seedSandbox inserts a sandbox with a GIVEN id (restart recovery).
 */
export class E2EBoatClient implements IBoatClient {
  readonly clock: VirtualClock;
  readonly sandboxes = new Map<string, BoatSandbox>();
  readonly idempotencyLog: string[] = [];
  createCount = 0;
  sandboxCount = 0;
  /** Force the next N createSandbox calls to fail with 429. */
  failNextCreate429 = 0;
  /** While the virtual clock is below this, createSandbox fails with 429. */
  failCreate429Until = 0;

  private readonly commands = new Map<string, TrackedCommand>();
  private readonly idempotencyToSandbox = new Map<string, string>();
  private processSeq = 0;

  constructor(clock: VirtualClock) {
    this.clock = clock;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<{ sandbox: BoatSandbox }> {
    this.createCount += 1;

    if (this.failNextCreate429 > 0) {
      this.failNextCreate429 -= 1;
      throw new BoatApiError("rate limited", 429, "rate_limited", 60_000);
    }
    if (this.clock.now < this.failCreate429Until) {
      throw new BoatApiError("rate limited", 429, "rate_limited", 60_000);
    }

    const key = options.idempotencyKey;
    if (key) {
      this.idempotencyLog.push(key);
      const existingId = this.idempotencyToSandbox.get(key);
      if (existingId) {
        const existing = this.sandboxes.get(existingId);
        if (existing) {
          return { sandbox: existing };
        }
      }
    }

    const id = `sbx-${this.sandboxes.size + 1}`;
    const sandbox: BoatSandbox = {
      id,
      name: options.name ?? id,
      state: "provisioning",
      type: options.type ?? "default",
      labels: options.labels ?? {},
      createdAt: String(this.clock.now),
      updatedAt: String(this.clock.now),
    };
    this.sandboxes.set(id, sandbox);
    this.sandboxCount += 1;
    if (key) {
      this.idempotencyToSandbox.set(key, id);
    }

    // Provisioning -> ready after ~3s of virtual time.
    void this.clock.sleep(3_000).then(() => {
      const cur = this.sandboxes.get(id);
      if (cur && cur.state === "provisioning") {
        cur.state = "ready";
        cur.updatedAt = String(this.clock.now);
      }
    });

    return { sandbox };
  }

  async getSandbox(sandboxId: string): Promise<BoatSandbox> {
    const sb = this.sandboxes.get(sandboxId);
    if (!sb) {
      throw new BoatApiError(`sandbox not found: ${sandboxId}`, 404, "not_found");
    }
    return sb;
  }

  async listSandboxes(options?: {
    namePrefix?: string;
    state?: SandboxState;
  }): Promise<BoatSandbox[]> {
    let result = [...this.sandboxes.values()];
    const { namePrefix, state } = options ?? {};
    if (namePrefix) {
      result = result.filter((s) => s.name.startsWith(namePrefix));
    }
    if (state) {
      result = result.filter((s) => s.state === state);
    }
    return result;
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    if (!this.sandboxes.delete(sandboxId)) {
      throw new BoatApiError(`sandbox not found: ${sandboxId}`, 404, "not_found");
    }
    this.sandboxCount -= 1;
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const sb = this.sandboxes.get(sandboxId);
    if (!sb) {
      throw new BoatApiError(`sandbox not found: ${sandboxId}`, 404, "not_found");
    }
    sb.state = "archived";
    sb.updatedAt = String(this.clock.now);
  }

  async runCommand(
    _sandboxId: string,
    command: string,
    _options?: CommandOptions,
  ): Promise<CommandResult> {
    return { exitCode: 0, stdout: `$ ${command}`, stderr: "" };
  }

  async runCommandDetached(
    sandboxId: string,
    command: string,
    _options?: CommandOptions,
  ): Promise<CommandStarted> {
    if (!this.sandboxes.has(sandboxId)) {
      throw new BoatApiError(`sandbox not found: ${sandboxId}`, 404, "not_found");
    }
    const processId = `proc-${++this.processSeq}`;
    this.commands.set(processId, {
      sandboxId,
      processId,
      command,
      running: true,
      exitCode: 0,
      startedAt: this.clock.now,
    });
    return { processId };
  }

  async getCommandStatus(
    sandboxId: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode?: number }> {
    const proc = this.commands.get(processId);
    if (!proc || proc.sandboxId !== sandboxId) {
      throw new BoatApiError(`command not found: ${processId}`, 404, "not_found");
    }
    if (proc.running) {
      return { running: true };
    }
    return { running: false, exitCode: proc.exitCode };
  }

  /** Test helper: finish a detached command (flips running -> done). */
  finishCommand(sandboxId: string, processId: string, exitCode = 0): void {
    const proc = this.commands.get(processId);
    if (!proc || proc.sandboxId !== sandboxId) {
      throw new BoatApiError(`command not found: ${processId}`, 404, "not_found");
    }
    proc.running = false;
    proc.exitCode = exitCode;
  }

  /** Test helper: list the detached process ids tracked for a sandbox. */
  getDetachedProcessIds(sandboxId: string): string[] {
    return [...this.commands.values()]
      .filter((c) => c.sandboxId === sandboxId)
      .map((c) => c.processId);
  }

  async stopCommand(_sandboxId: string, processId: string): Promise<void> {
    const proc = this.commands.get(processId);
    if (proc) {
      proc.running = false;
      proc.exitCode = 137;
    }
  }

  async getLimits(): Promise<BoatLimits> {
    return {
      canStart: true,
      startsMinuteRemaining: 10,
      startsHourRemaining: 50,
      startsDayRemaining: 100,
      sandboxesAtOnce: 100,
      sandboxesAtOnceRemaining: Math.max(0, 100 - this.sandboxes.size),
      walletBalance: 1000,
      planIncludedVmHoursRemaining: 1000,
      machineTypes: [
        { type: "small", available: true },
        { type: "default", available: true },
        { type: "large", available: true },
        { type: "xlarge", available: true },
      ],
    };
  }

  async getUsage(_sandboxId: string): Promise<BoatUsage> {
    return { seconds: 0, sandboxType: "default", dollars: 0 };
  }

  async saveSnapshot(_sandboxId: string, _name: string): Promise<void> {}

  async getSavedSnapshot(name: string): Promise<{ status: string; snapshotId?: string }> {
    return { status: "ready", snapshotId: `snap_${name}` };
  }

  async deleteSavedSnapshot(_name: string): Promise<void> {}

  /** Test helper: insert a sandbox with a GIVEN id (restart recovery). */
  seedSandbox(sandbox: BoatSandbox): void {
    this.sandboxes.set(sandbox.id, sandbox);
    this.sandboxCount += 1;
  }
}

// ---------------------------------------------------------------------------
// E2E Buildkite client
// ---------------------------------------------------------------------------

/**
 * In-memory IBuildkiteClient.
 *
 * The real Buildkite agent acquires jobs itself (--acquire-job), so this
 * mock has NO startJob/finishJob/annotate. Jobs start as "scheduled";
 * tests drive state transitions with setJobState / seedJob. The scaler
 * detects completion by the agent process exiting (see E2EBoatClient)
 * and by polling getJob for terminal states.
 */
export class E2EBuildkiteClient implements IBuildkiteClient {
  readonly jobs = new Map<string, BuildkiteJob>();
  readonly logs = new Map<string, string>();

  /** Test helper: insert or replace a job. */
  seedJob(job: BuildkiteJob): void {
    this.jobs.set(job.id, job);
  }

  /** Test helper: set a job's state directly (agent/Buildkite side). */
  setJobState(jobId: string, state: JobState): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.state = state;
    }
  }

  /** Test helper: append to a job's log. */
  appendLog(jobId: string, line: string): void {
    this.logs.set(jobId, `${(this.logs.get(jobId) ?? "") + line}\n`);
  }

  async findScheduledJobs(_queue: string): Promise<BuildkiteJob[]> {
    return [...this.jobs.values()].filter((j) => j.state === "scheduled");
  }

  async getJob(jobId: string): Promise<BuildkiteJob> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`job not found: ${jobId}`);
    }
    return job;
  }

  async getBuild(buildId: string): Promise<BuildkiteBuild> {
    return {
      id: buildId,
      number: 1,
      state: "running",
      jobs: [...this.jobs.values()].filter((j) => j.build?.id === buildId),
    };
  }

  async getPipeline(slug: string): Promise<BuildkitePipeline> {
    return { slug, name: slug };
  }

  async listAgents(): Promise<BuildkiteAgent[]> {
    return [];
  }

  async getJobLog(jobId: string): Promise<string> {
    return this.logs.get(jobId) ?? "";
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.state = "canceled";
      this.appendLog(jobId, "job canceled");
    }
  }

  async retryJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) {
      job.state = "scheduled";
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a Buildkite job for E2E scenarios. */
export function makeJob(id: string, pipeline: string, state: JobState): BuildkiteJob {
  return {
    id,
    name: id,
    state,
    pipeline: { slug: pipeline, name: pipeline },
    build: { id: `bld-${id}`, number: 1, pipeline: { slug: pipeline } },
  };
}

export type E2EEnv = {
  clock: VirtualClock;
  boat: E2EBoatClient;
  buildkite: E2EBuildkiteClient;
};

/** Create a fresh E2E environment. */
export function makeEnv(): E2EEnv {
  const clock = new VirtualClock();
  return { clock, boat: new E2EBoatClient(clock), buildkite: new E2EBuildkiteClient() };
}

/**
 * Advance the virtual clock in stepMs increments until isStable()
 * returns true or maxMs has elapsed. Yields to the microtask queue
 * between steps so timer-driven state changes settle.
 */
export async function runUntilStable(
  clock: VirtualClock,
  isStable: () => boolean | Promise<boolean>,
  maxMs = 600_000,
  stepMs = 250,
): Promise<void> {
  let elapsed = 0;
  while (elapsed < maxMs && !(await isStable())) {
    await clock.tick(stepMs);
    elapsed += stepMs;
    await Promise.resolve();
  }
}
