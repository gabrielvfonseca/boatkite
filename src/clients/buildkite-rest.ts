/**
 * Buildkite REST API client.
 */

import type { BuildkiteJob, BuildkiteBuild, BuildkitePipeline, BuildkiteAgent } from "../types.js";
import { IBuildkiteClient, BuildkiteApiError } from "./buildkite-client.js";

const BK_API = "https://api.buildkite.com/v2";

export class BuildkiteRestClient implements IBuildkiteClient {
  constructor(
    private token: string,
    private org: string
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BK_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new BuildkiteApiError(`Buildkite API error: ${res.status} ${res.statusText}`, res.status);
    }
    return res.json() as T;
  }

  async findScheduledJobs(queue: string): Promise<BuildkiteJob[]> {
    // Use GraphQL to find scheduled jobs for a queue
    const query = `
      query {
        organization(slug: "${this.org}") {
          pipelines(first: 100) {
            edges {
              node {
                slug
                builds(state: "scheduled", first: 100) {
                  edges {
                    node {
                      id
                      number
                      state
                      jobs(first: 100) {
                        edges {
                          node {
                            id
                            name
                            state
                            agents {
                              queue
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    // For now, use REST endpoint for builds
    const builds = await this.request<any>(`/organizations/${this.org}/builds?state=scheduled`);
    const jobs: BuildkiteJob[] = [];
    for (const build of builds ?? []) {
      for (const job of build.jobs ?? []) {
        if (job.state === "scheduled" || job.state === "blocked") {
          jobs.push({ ...job, build });
        }
      }
    }
    return jobs;
  }

  async getJob(jobId: string): Promise<BuildkiteJob> {
    return this.request<BuildkiteJob>(`/organizations/${this.org}/jobs/${jobId}`);
  }

  async getBuild(buildId: string): Promise<BuildkiteBuild> {
    return this.request<BuildkiteBuild>(`/organizations/${this.org}/builds/${buildId}`);
  }

  async getPipeline(slug: string): Promise<BuildkitePipeline> {
    return this.request<BuildkitePipeline>(`/organizations/${this.org}/pipelines/${slug}`);
  }

  async listAgents(): Promise<BuildkiteAgent[]> {
    return this.request<BuildkiteAgent[]>(`/organizations/${this.org}/agents`);
  }

  async getJobLog(jobId: string): Promise<string> {
    const res = await fetch(
      `${BK_API}/organizations/${this.org}/jobs/${jobId}/log`,
      { headers: { Authorization: `Bearer ${this.token}` } }
    );
    if (!res.ok) throw new BuildkiteApiError(`Failed to get job log: ${res.status}`, res.status);
    return res.text();
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.request(`/organizations/${this.org}/jobs/${jobId}/cancel`, {
      method: "PUT",
    });
  }

  async retryJob(jobId: string): Promise<void> {
    await this.request(`/organizations/${this.org}/jobs/${jobId}/retry`, {
      method: "PUT",
    });
  }
}
