/**
 * Core types for boatkite.
 */

export type SandboxState =
  | "provisioning"
  | "provisioned"
  | "cloning"
  | "ready"
  | "idle"
  | "running"
  | "archiving"
  | "archived"
  | "error"
  | "cancelled";

export type SandboxType = "small" | "default" | "large" | "xlarge";

export interface BoatSandbox {
  id: string;
  name: string;
  state: SandboxState;
  type: SandboxType;
  createdAt?: string;
  updatedAt?: string;
  archiveAfter?: string | null;
  labels?: Record<string, string>;
  error?: string | null;
  vcpu?: number;
  memoryGB?: number;
  billingMultiplier?: number;
  seconds?: number;
  dollars?: number;
}

export interface CreateSandboxOptions {
  from?: string;
  type?: SandboxType;
  ttlSeconds?: number | null;
  env?: Record<string, string>;
  noEnv?: boolean;
  labels?: Record<string, string>;
  name?: string;
  idempotencyKey?: string;
}

export interface CommandOptions {
  cwd?: string;
  timeoutSeconds?: number;
  detached?: boolean;
  stream?: boolean;
  env?: Record<string, string>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  processId?: string;
}

export interface CommandStarted {
  processId: string;
}

export type JobState =
  | "scheduled"
  | "running"
  | "passed"
  | "failed"
  | "canceled"
  | "cancelled"
  | "blocked"
  | "broken";

export interface BuildkiteJob {
  id: string;
  name?: string;
  state?: JobState;
  pipeline?: {
    slug?: string;
    name?: string;
  };
  build?: {
    id?: string;
    number?: number;
    pipeline?: {
      slug?: string;
    };
  };
  agents?: Record<string, string>[];
  job?: {
    id?: string;
  };
}

export interface BuildkiteAgent {
  id: string;
  name?: string;
  tags?: string[];
  queue?: string;
}

export interface BuildkiteBuild {
  id?: string;
  number?: number;
  state?: string;
  jobs?: BuildkiteJob[];
  pipeline?: {
    slug?: string;
    name?: string;
  };
}

export interface BuildkitePipeline {
  slug: string;
  name?: string;
}

export interface BoatkiteConfig {
  boatApiKey: string;
  buildkiteToken: string;
  buildkiteOrg: string;
  queue: string;
  maxVms: number;
  maxJobMinutes: number;
  pollIntervalMs: number;
  webhookPort: number;
  webhookHost?: string;
  boatSnapshot: string;
  metricsPort?: number;
  debugRetentionMinutes: number;
  defaultSize: SandboxType;
  region?: string;
}

export interface JobAssignment {
  jobId: string;
  sandboxId: string;
  pipeline: string;
  size: SandboxType;
  snapshot: string;
  startedAt: number;
  state: "creating" | "running" | "finished";
  exitCode?: number;
}

export interface ScalerMetrics {
  jobsWaiting: number;
  vmsRunning: number;
  vmStartTimeAvg: number;
  jobDurationAvg: number;
  startFailures: number;
  rateLimit429Count: number;
}

export interface BoatLimits {
  canStart: boolean;
  startsMinuteRemaining: number;
  startsHourRemaining: number;
  startsDayRemaining: number;
  sandboxesAtOnce: number;
  sandboxesAtOnceRemaining: number;
  walletBalance: number;
  planIncludedVmHoursRemaining: number;
  machineTypes: Array<{
    type: SandboxType;
    available: boolean;
    reason?: string;
  }>;
}

export interface BoatUsage {
  seconds: number;
  sandboxType: SandboxType;
  dollars: number;
}

export interface WebhookEvent {
  event: string;
  job?: BuildkiteJob;
  build?: BuildkiteBuild;
  pipeline?: BuildkitePipeline;
  sender?: {
    id: string;
    name: string;
  };
}

export interface BoatWebhookPayload {
  id: string;
  type: string;
  createdAt: string;
  data: {
    sandbox?: {
      id: string;
      name?: string;
    };
    previousState?: string;
    state?: string;
    reason?: string;
  };
}

// Client interfaces
export interface IBoatClient {
  createSandbox(options: CreateSandboxOptions): Promise<{ sandbox: BoatSandbox }>;
  getSandbox(sandboxId: string): Promise<BoatSandbox>;
  listSandboxes(options?: { namePrefix?: string; state?: SandboxState }): Promise<BoatSandbox[]>;
  deleteSandbox(sandboxId: string): Promise<void>;
  stopSandbox(sandboxId: string): Promise<void>;
  runCommand(sandboxId: string, command: string, options?: CommandOptions): Promise<CommandResult>;
  runCommandDetached(sandboxId: string, command: string, options?: CommandOptions): Promise<CommandStarted>;
  getCommandStatus(sandboxId: string, processId: string): Promise<{ running: boolean; exitCode?: number }>;
  stopCommand(sandboxId: string, processId: string): Promise<void>;
  getLimits(): Promise<BoatLimits>;
  getUsage(sandboxId: string): Promise<BoatUsage>;
  saveSnapshot(sandboxId: string, name: string): Promise<void>;
  getSavedSnapshot(name: string): Promise<{ status: string; snapshotId?: string }>;
  deleteSavedSnapshot(name: string): Promise<void>;
}

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
