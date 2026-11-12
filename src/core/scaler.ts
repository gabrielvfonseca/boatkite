/**
 * boatkite scaler core.
 * Watches Buildkite for waiting jobs and runs each on a fresh Boat VM.
 */

import type {
  IBoatClient,
  IBuildkiteClient,
  BoatkiteConfig,
  JobAssignment,
  BuildkiteJob,
  ScalerMetrics,
  JobState,
  SandboxType,
  BoatSandbox,
} from "../types.js";
import { JobTracker } from "./tracker.js";
import { logger } from "./logger.js";
import { withBackoff, sleep, computeBackoff } from "./backoff.js";
import { randomUUID } from "node:crypto";

export interface ScalerOptions {
  boat: IBoatClient;
  buildkite: IBuildkiteClient;
  config: BoatkiteConfig;
  signal?: AbortSignal;
  onMetrics?: (m: ScalerMetrics) => void;
}

export class Scaler {
  private readonly boat: IBoatClient;
  private readonly buildkite: IBuildkiteClient;
  private readonly cfg: BoatkiteConfig;
  private readonly tracker = new JobTracker();
  private readonly signal?: AbortSignal;
  private readonly onMetrics?: (m: ScalerMetrics) => void;
  private running = false;
  private startFailures = 0;
  private rateLimit429Count = 0;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: ScalerOptions) {
    this.boat = options.boat;
    this.buildkite = options.buildkite;
    this.cfg = options.config;
    this.signal = options.signal;
    this.onMetrics = options.onMetrics;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("Starting scaler", {
      queue: this.cfg.queue,
      maxVms: this.cfg.maxVms,
      pollInterval: this.cfg.pollIntervalMs,
    });

    // Recover state from existing sandboxes
    await this.recoverState();

    // Start cleanup loop
    this.cleanupTimer = setInterval(() => this.cleanupOrphans(), 60_000);

    // Main poll loop
    while (this.running) {
      await this.pollOnce();
      await sleep(this.cfg.pollIntervalMs, this.signal);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    logger.info("Scaler stopping, waiting for running jobs", {
      runningJobs: this.tracker.countRunning(),
    });
  }

  private async recoverState(): Promise<void> {
    try {
      const sandboxes = await this.boat.listSandboxes({ namePrefix: "bk-" });
      await this.tracker.recoverFromSandboxes(sandboxes, async (jobId) => {
        try {
          return await this.buildkite.getJob(jobId);
        } catch {
          return null;
        }
      });
    } catch (err) {
      logger.error("Failed to recover state", { error: String(err) });
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.running) return;

    const runningCount = this.tracker.countRunning();
    const maxVms = this.cfg.maxVms;
    const available = maxVms - runningCount;

    if (available <= 0) {
      logger.debug("Max VMs reached, waiting", { running: runningCount, maxVms });
      return;
    }

    let jobs: BuildkiteJob[];
    try {
      jobs = await withBackoff(() => this.buildkite.findScheduledJobs(this.cfg.queue), {
        maxAttempts: 3,
        signal: this.signal,
      });
    } catch (err: any) {
      if (err?.status === 429) {
        this.rateLimit429Count++;
        const delay = computeBackoff(0, 5000, 30000);
        logger.warn("Buildkite rate limited, backing off", { delayMs: delay });
        await sleep(delay, this.signal);
        return;
      }
      logger.error("Failed to fetch scheduled jobs", { error: String(err) });
      await sleep(5000, this.signal);
      return;
    }

    // Filter out jobs we already have
    const newJobs = jobs.filter((j) => !this.tracker.has(j.id));

    if (newJobs.length === 0) {
      logger.debug("No new jobs", { queue: this.cfg.queue });
      return;
    }

    logger.info("Found new jobs", {
      count: newJobs.length,
      available: available,
      running: runningCount,
    });

    // Start as many as we can
    const toStart = Math.min(newJobs.length, available);
    for (let i = 0; i < toStart; i++) {
      const job = newJobs[i];
      if (!this.running) break;
      this.startJob(job).catch((err) => {
        logger.error("Failed to start job", {
          jobId: job.id,
          error: String(err),
        });
        this.startFailures++;
      });
    }
  }

  private async startJob(job: BuildkiteJob): Promise<void> {
    const jobId = job.id;
    const pipeline = job.build?.pipeline?.slug ?? job.pipeline?.slug ?? "unknown";
    const agents = this.parseAgents(job);

    const size = (agents["boat-size"] as SandboxType) ?? this.cfg.defaultSize;
    const snapshot = (agents["boat-snapshot"] as string) ?? this.cfg.boatSnapshot;
    const debug = agents["boat-debug"] === "true";

    const sandboxName = `bk-${pipeline}-${jobId}`;

    // Check if already exists
    const existing = await this.boat.listSandboxes({ namePrefix: sandboxName });
    if (existing.length > 0) {
      logger.debug("Sandbox already exists for job", { jobId, sandboxId: existing[0].id });
      this.tracker.add({
        jobId,
        sandboxId: existing[0].id,
        pipeline,
        size,
        snapshot,
        startedAt: Date.now(),
        state: "running",
      });
      return;
    }

    // Check Boat limits
    try {
      const limits = await this.boat.getLimits();
      if (!limits.canStart) {
        logger.warn("Cannot start new sandboxes, Boat limit reached", {
          jobId,
          startsMinute: limits.startsMinuteRemaining,
        });
        await sleep(computeBackoff(0, 10000, 60000), this.signal);
        return;
      }
      if (limits.sandboxesAtOnceRemaining <= 0) {
        logger.warn("Concurrent sandbox limit reached", { jobId });
        await sleep(30_000, this.signal);
        return;
      }
    } catch (err) {
      logger.warn("Failed to check Boat limits", { error: String(err) });
    }

    logger.info("Creating sandbox for job", {
      jobId,
      pipeline,
      size,
      snapshot,
      sandboxName,
    });

    try {
      const result = await withBackoff(
        () =>
          this.boat.createSandbox({
            from: snapshot,
            type: size,
            ttlSeconds: this.cfg.maxJobMinutes * 60,
            noEnv: true, // SECURITY: no secrets leak into job VM
            name: sandboxName,
            labels: {
              jobId,
              pipeline,
              managedBy: "boatkite",
            },
            idempotencyKey: randomUUID(),
          }),
        {
          maxAttempts: 4,
          baseMs: 2000,
          signal: this.signal,
        }
      );

      const sandboxId = result.sandbox.id;

      this.tracker.add({
        jobId,
        sandboxId,
        pipeline,
        size,
        snapshot,
        startedAt: Date.now(),
        state: "creating",
      });

      logger.info("Sandbox created, starting agent", {
        jobId,
        sandboxId,
        pipeline,
      });

      // Start the Buildkite agent with --acquire-job
      this.startAgent(sandboxId, jobId, pipeline).catch((err) => {
        logger.error("Failed to start agent", {
          jobId,
          sandboxId,
          error: String(err),
        });
        this.cleanupFailedJob(jobId, sandboxId);
      });
    } catch (err: any) {
      if (err?.status === 429) {
        this.rateLimit429Count++;
        const delay = computeBackoff(0, 5000, 60000);
        logger.warn("Boat rate limited on create", {
          jobId,
          retryAfter: err.retryAfter,
          delayMs: delay,
        });
        await sleep(delay, this.signal);
        return;
      }
      logger.error("Failed to create sandbox", {
        jobId,
        error: String(err),
        status: err?.status,
      });
      this.startFailures++;
    }
  }

  private async startAgent(sandboxId: string, jobId: string, pipeline: string): Promise<void> {
    // Wait for sandbox to be ready
    let attempts = 0;
    while (attempts < 60) {
      try {
        const sb = await this.boat.getSandbox(sandboxId);
        if (sb.state === "ready" || sb.state === "idle" || sb.state === "running") {
          break;
        }
        if (sb.state === "error" || sb.state === "cancelled") {
          throw new Error(`Sandbox in ${sb.state} state`);
        }
      } catch (err) {
        if (attempts > 5) throw err;
      }
      await sleep(2000, this.signal);
      attempts++;
    }

    // Start buildkite-agent with --acquire-job
    const command = [
      "buildkite-agent start",
      `--token "$BUILDKITE_AGENT_TOKEN"`,
      `--acquire-job "${jobId}"`,
      "--disconnect-after-job",
      "--tags \"queue=boat\"",
      "--log-format json",
    ].join(" ");

    // Run detached so we can monitor
    try {
      const result = await this.boat.runCommandDetached(sandboxId, command, {
        env: { BUILDKITE_AGENT_TOKEN: this.cfg.buildkiteToken },
      });

      // Update tracker
      const assignment = this.tracker.get(jobId);
      if (assignment) {
        assignment.state = "running";
        assignment.startedAt = Date.now();
      }

      logger.info("Agent started", { jobId, sandboxId, processId: result.processId ?? "unknown" });

      // Monitor the agent process in background
      this.monitorAgent(sandboxId, jobId, pipeline, result.processId ?? "unknown").catch((err) => {
        logger.error("Agent monitoring failed", { jobId, sandboxId, error: String(err) });
      });
    } catch (err: any) {
      if (err?.status === 429) {
        this.rateLimit429Count++;
        throw err;
      }
      throw err;
    }
  }

  private async monitorAgent(
    sandboxId: string,
    jobId: string,
    pipeline: string,
    processId: string
  ): Promise<void> {
    // Poll agent status until done
    while (this.running) {
      await sleep(10_000, this.signal);

      try {
        const status = await this.boat.getCommandStatus(sandboxId, processId);
        if (!status.running) {
          // Agent finished
          await this.finishJob(jobId, sandboxId, pipeline, status.exitCode ?? 0);
          return;
        }
      } catch (err) {
        logger.warn("Failed to check agent status", { jobId, sandboxId, error: String(err) });
        // Continue trying
      }

      // Check if job is still valid in Buildkite
      try {
        const job = await this.buildkite.getJob(jobId);
        if (job.state === "canceled" || job.state === "cancelled") {
          logger.info("Job cancelled, stopping agent", { jobId, sandboxId });
          await this.boat.stopCommand(sandboxId, processId);
          await this.cleanupFailedJob(jobId, sandboxId);
          return;
        }
        if (job.state === "passed" || job.state === "failed" || job.state === "broken") {
          // Job finished but agent might still be running
          await this.finishJob(jobId, sandboxId, pipeline, job.state === "passed" ? 0 : 1);
          return;
        }
      } catch {
        // Job might be gone, continue
      }

      // Check timeout
      const assignment = this.tracker.get(jobId);
      if (assignment) {
        const elapsed = Date.now() - assignment.startedAt;
        if (elapsed > this.cfg.maxJobMinutes * 60_000) {
          logger.warn("Job timeout, stopping", {
            jobId,
            sandboxId,
            elapsedMinutes: Math.floor(elapsed / 60000),
          });
          await this.boat.stopSandbox(sandboxId);
          await this.tracker.remove(jobId);
          return;
        }
      }
    }
  }

  private async finishJob(
    jobId: string,
    sandboxId: string,
    pipeline: string,
    exitCode: number
  ): Promise<void> {
    logger.info("Job finished", {
      jobId,
      sandboxId,
      pipeline,
      exitCode,
    });

    // Get cost
    try {
      const usage = await this.boat.getUsage(sandboxId);
      logger.info("Job cost", {
        jobId,
        seconds: usage.seconds,
        dollars: usage.dollars,
      });
    } catch {
      // Ignore
    }

    // Delete sandbox
    try {
      await this.boat.deleteSandbox(sandboxId);
    } catch (err) {
      logger.warn("Failed to delete sandbox", { jobId, sandboxId, error: String(err) });
    }

    this.tracker.remove(jobId);
    this.emitMetrics();
  }

  private async cleanupFailedJob(jobId: string, sandboxId: string): Promise<void> {
    this.tracker.remove(jobId);
    try {
      await this.boat.deleteSandbox(sandboxId);
    } catch {
      // Ignore
    }
  }

  private async cleanupOrphans(): Promise<void> {
    try {
      const sandboxes = await this.boat.listSandboxes({ namePrefix: "bk-" });
      for (const sb of sandboxes) {
        const assignment = this.tracker.getBySandbox(sb.id);
        if (!assignment) {
          // Unknown sandbox - check if job exists
          const match = sb.name.match(/^bk-([^-]+)-([a-f0-9-]+)$/);
          if (match) {
            const jobId = match[2];
            try {
              const job = await this.buildkite.getJob(jobId);
              if (
                job.state === "passed" ||
                job.state === "failed" ||
                job.state === "canceled" ||
                job.state === "cancelled" ||
                job.state === "broken"
              ) {
                logger.info("Cleaning up orphan sandbox", {
                  jobId,
                  sandboxId: sb.id,
                  jobState: job.state,
                });
                await this.boat.deleteSandbox(sb.id);
              }
            } catch {
              // Job not found, delete sandbox
              logger.info("Deleting sandbox for unknown job", {
                sandboxId: sb.id,
              });
              await this.boat.deleteSandbox(sb.id);
            }
          }
        } else {
          // Check timeout
          const elapsed = Date.now() - assignment.startedAt;
          if (elapsed > this.cfg.maxJobMinutes * 60_000) {
            logger.info("Cleaning up timed out job", {
              jobId: assignment.jobId,
              sandboxId: sb.id,
              elapsedMinutes: Math.floor(elapsed / 60000),
            });
            await this.boat.deleteSandbox(sb.id);
            this.tracker.remove(assignment.jobId);
          }
        }
      }
    } catch (err) {
      logger.error("Cleanup failed", { error: String(err) });
    }
  }

  private parseAgents(job: BuildkiteJob): Record<string, string> {
    const agents: Record<string, string> = {};
    if (job.agents) {
      for (const a of job.agents) {
        Object.assign(agents, a);
      }
    }
    return agents;
  }

  private emitMetrics(): void {
    if (this.onMetrics) {
      this.onMetrics({
        jobsWaiting: 0,
        vmsRunning: this.tracker.countRunning(),
        vmStartTimeAvg: 0,
        jobDurationAvg: 0,
        startFailures: this.startFailures,
        rateLimit429Count: this.rateLimit429Count,
      });
    }
  }

  getTracker(): JobTracker {
    return this.tracker;
  }
}
