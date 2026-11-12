/**
 * Buildkite API client interface. Implemented with fetch and a fake for tests.
 */

import type { BuildkiteAgent, BuildkiteBuild, BuildkiteJob, BuildkitePipeline } from "../types.js";

export interface IBuildkiteClient {
  findScheduledJobs(queue: string): Promise<BuildkiteJob[]>;
  getJob(jobId: string): Promise<BuildkiteJob>;
  getBuild(buildId: string): Promise<BuildkiteBuild>;
  getPipeline(slug: string): Promise<BuildkitePipeline>;
  listAgents(): Promise<BuildkiteAgent[]>;
  getJobLog(jobId: string): Promise<string>;
  cancelJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
}

export class BuildkiteApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BuildkiteApiError";
    this.status = status;
  }
}
