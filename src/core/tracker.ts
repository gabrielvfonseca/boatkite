/**
 * Job tracker: in-memory state for running jobs.
 * State can be rebuilt from sandbox names on restart.
 */

import type { JobAssignment, BuildkiteJob } from "../types.js";
import { logger } from "./logger.js";

export class JobTracker {
  private assignments = new Map<string, JobAssignment>();

  add(assignment: JobAssignment): void {
    this.assignments.set(assignment.jobId, assignment);
  }

  get(jobId: string): JobAssignment | undefined {
    return this.assignments.get(jobId);
  }

  getBySandbox(sandboxId: string): JobAssignment | undefined {
    for (const a of this.assignments.values()) {
      if (a.sandboxId === sandboxId) return a;
    }
    return undefined;
  }

  remove(jobId: string): void {
    this.assignments.delete(jobId);
  }

  removeBySandbox(sandboxId: string): void {
    for (const [jobId, a] of this.assignments.entries()) {
      if (a.sandboxId === sandboxId) this.assignments.delete(jobId);
    }
  }

  has(jobId: string): boolean {
    return this.assignments.has(jobId);
  }

  running(): JobAssignment[] {
    return Array.from(this.assignments.values()).filter(
      (a) => a.state === "creating" || a.state === "running"
    );
  }

  all(): JobAssignment[] {
    return Array.from(this.assignments.values());
  }

  countRunning(): number {
    return this.running().length;
  }

  async recoverFromSandboxes(
    sandboxes: Array<{ id: string; name: string }>,
    getJob: (jobId: string) => Promise<BuildkiteJob | null>
  ): Promise<void> {
    for (const sb of sandboxes) {
      const match = sb.name.match(/^bk-([^-]+)-([a-f0-9-]+)$/);
      if (!match) continue;
      const pipeline = match[1];
      const jobId = match[2];
      try {
        const job = await getJob(jobId);
        if (job && (job.state === "scheduled" || job.state === "running")) {
          this.assignments.set(jobId, {
            jobId,
            sandboxId: sb.id,
            pipeline,
            size: "default",
            snapshot: "boatkite",
            startedAt: Date.now(),
            state: "running",
          });
          logger.info("Recovered job assignment", { jobId, sandboxId: sb.id, pipeline });
        }
      } catch {
        // Job not found or API error - skip
      }
    }
  }
}