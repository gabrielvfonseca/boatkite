/**
 * Fake Buildkite client for unit tests.
 */

import type {
  IBuildkiteClient,
  BuildkiteJob,
  BuildkiteBuild,
  BuildkitePipeline,
  BuildkiteAgent,
} from "../types.js";
import { BuildkiteApiError } from "./buildkite-client.js";

export interface FakeBuildkiteOptions {
  jobs?: BuildkiteJob[];
  jobStates?: Record<string, string>;
  delay?: number;
  shouldFail?: boolean;
}

export class FakeBuildkiteClient implements IBuildkiteClient {
  private jobs: BuildkiteJob[];
  private jobStates: Record<string, string>;
  private readonly options: Required<FakeBuildkiteOptions>;

  constructor(options: FakeBuildkiteOptions = {}) {
    this.options = {
      jobs: options.jobs ?? [],
      jobStates: options.jobStates ?? {},
      delay: options.delay ?? 0,
      shouldFail: options.shouldFail ?? false,
    };
    this.jobs = this.options.jobs;
    this.jobStates = { ...this.options.jobStates };
  }

  setJobState(jobId: string, state: string): void {
    this.jobStates[jobId] = state;
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) job.state = state as any;
  }

  addJob(job: BuildkiteJob): void {
    this.jobs.push(job);
  }

  async findScheduledJobs(_queue: string): Promise<BuildkiteJob[]> {
    if (this.options.delay > 0) {
      await new Promise((r) => setTimeout(r, this.options.delay));
    }
    if (this.options.shouldFail) {
      throw new BuildkiteApiError("API error", 500);
    }
    return this.jobs.filter(
      (j) => (j.state === "scheduled" || j.state === "blocked") && !this.jobStates[j.id]
    );
  }

  async getJob(jobId: string): Promise<BuildkiteJob> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) throw new BuildkiteApiError("Not found", 404);
    return { ...job, state: (this.jobStates[job.id] ?? job.state) as any };
  }

  async getBuild(buildId: string): Promise<BuildkiteBuild> {
    return {
      id: buildId,
      number: 1,
      state: "scheduled",
      jobs: this.jobs.filter((j) => j.build?.id === buildId),
    };
  }

  async getPipeline(slug: string): Promise<BuildkitePipeline> {
    return { slug, name: slug };
  }

  async listAgents(): Promise<BuildkiteAgent[]> {
    return [];
  }

  async getJobLog(_jobId: string): Promise<string> {
    return "log content";
  }

  async cancelJob(_jobId: string): Promise<void> {}

  async retryJob(_jobId: string): Promise<void> {}
}