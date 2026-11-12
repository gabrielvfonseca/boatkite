/**
 * Buildkite API client interface. Implemented with fetch and a fake for tests.
 */

import type { BuildkiteJob, BuildkiteBuild, BuildkitePipeline, BuildkiteAgent } from "../types.js";

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
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "BuildkiteApiError";
  }
}