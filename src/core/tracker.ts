/**
 * Job tracker: in-memory state for running jobs.
 * State can be rebuilt from sandbox names on restart.
 */

import type { BuildkiteJob, JobAssignment } from "../types.js";
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

  jobIds(): Iterable<string> {
    return this.assignments.keys();
  }

  running(): JobAssignment[] {
    return Array.from(this.assignments.values()).filter(
      (a) => a.state === "creating" || a.state === "running",
    );
  }

  all(): JobAssignment[] {
    return Array.from(this.assignments.values());
  }

  countRunning(): number {
    return this.running().length;
  }

  async recoverFromSandboxes(
    sandboxes: Array<{
      id: string;
      name: string;
      labels?: Record<string, string>;
      type?: string;
    }>,
    getJob: (jobId: string) => Promise<BuildkiteJob | null>,
  ): Promise<void> {
    for (const sb of sandboxes) {
      // Only recover sandboxes we created ourselves.
      if (sb.labels?.source !== "boatkite-scaler") continue;

      const jobId = sb.labels?.jobId;
      if (!jobId) {
        // Has source label but no jobId — skip, never adopt unknowns.
        logger.warn("Skipping sandbox without jobId label during recovery", {
          sandboxId: sb.id,
          name: sb.name,
        });
        continue;
      }

      const pipeline = sb.labels?.pipeline ?? sb.name.replace(/^bk-/, "").replace(`-${jobId}`, "");
      const size = (sb.type ?? "default") as JobAssignment["size"];

      try {
        const job = await getJob(jobId);
        if (job && (job.state === "scheduled" || job.state === "running")) {
          this.assignments.set(jobId, {
            jobId,
            sandboxId: sb.id,
            pipeline,
            size,
            snapshot: sb.labels?.snapshot ?? "boatkite",
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
