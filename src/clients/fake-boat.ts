/**
 * Fake Boat client for unit tests.
 */

import type {
  BoatLimits,
  BoatSandbox,
  BoatUsage,
  CommandOptions,
  CommandResult,
  CommandStarted,
  CreateSandboxOptions,
  IBoatClient,
  SandboxState,
  SandboxType,
} from "../types.js";
import { BoatApiError } from "./boat-client.js";

export interface FakeBoatOptions {
  createDelay?: number;
  createShouldFail?: boolean;
  createFailures?: number;
  rateLimitCount?: number;
  rateLimitAfter?: number;
  concurrentLimit?: number;
  maxConcurrent?: number;
}

export class FakeBoatClient implements IBoatClient {
  sandboxes = new Map<string, BoatSandbox>();
  private nextId = 1;
  private createCount = 0;
  private rateLimitHits = 0;
  private readonly options: Required<FakeBoatOptions>;

  constructor(options: FakeBoatOptions = {}) {
    this.options = {
      createDelay: options.createDelay ?? 0,
      createShouldFail: options.createShouldFail ?? false,
      createFailures: options.createFailures ?? 0,
      rateLimitCount: options.rateLimitCount ?? 0,
      rateLimitAfter: options.rateLimitAfter ?? 0,
      concurrentLimit: options.concurrentLimit ?? 100,
      maxConcurrent: options.maxConcurrent ?? 100,
    };
  }

  private genId(): string {
    return `bx_fake${this.nextId++}`;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<{ sandbox: BoatSandbox }> {
    this.createCount++;
    if (this.options.createDelay > 0) {
      await new Promise((r) => setTimeout(r, this.options.createDelay));
    }
    if (this.options.createShouldFail || this.createCount <= this.options.createFailures) {
      throw new BoatApiError("Create failed", 500, "create_failed");
    }
    if (this.rateLimitHits < this.options.rateLimitCount) {
      this.rateLimitHits++;
      throw new BoatApiError("Rate limited", 429, "rate_limited", this.options.rateLimitAfter);
    }
    if (this.sandboxes.size >= this.options.concurrentLimit) {
      throw new BoatApiError("Limit reached", 429, "limit_reached", 30);
    }
    const id = options.idempotencyKey
      ? `bx_idem_${options.idempotencyKey.slice(0, 8)}`
      : this.genId();
    const sandbox: BoatSandbox = {
      id,
      name: options.name ?? `Sandbox ${id}`,
      state: "provisioning",
      type: options.type ?? "default",
      labels: options.labels,
    };
    this.sandboxes.set(id, sandbox);
    // Simulate provisioning -> ready
    setTimeout(() => {
      const s = this.sandboxes.get(id);
      if (s) {
        s.state = "ready";
        s.updatedAt = new Date().toISOString();
      }
    }, 10);
    return { sandbox };
  }

  async getSandbox(sandboxId: string): Promise<BoatSandbox> {
    const s = this.sandboxes.get(sandboxId);
    if (!s) throw new BoatApiError("Not found", 404, "not_found");
    return s;
  }

  async listSandboxes(options?: { namePrefix?: string; state?: SandboxState }): Promise<
    BoatSandbox[]
  > {
    let result = Array.from(this.sandboxes.values());
    if (options?.namePrefix) {
      const prefix = options.namePrefix;
      result = result.filter((s) => s.name.startsWith(prefix));
    }
    if (options?.state) {
      result = result.filter((s) => s.state === options.state);
    }
    return result;
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    this.sandboxes.delete(sandboxId);
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const s = this.sandboxes.get(sandboxId);
    if (s) {
      s.state = "archived";
      s.updatedAt = new Date().toISOString();
    }
  }

  async runCommand(
    sandboxId: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandResult | { processId: string }> {
    if (options?.detached) {
      return { processId: `proc_${sandboxId}_${Date.now()}` };
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  }

  async runCommandDetached(
    sandboxId: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandStarted> {
    return { processId: `proc_${sandboxId}_${Date.now()}` };
  }

  async getCommandStatus(
    sandboxId: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode?: number }> {
    return { running: false, exitCode: 0 };
  }

  async stopCommand(sandboxId: string, processId: string): Promise<void> {}

  async getLimits(): Promise<BoatLimits> {
    return {
      canStart: true,
      startsMinuteRemaining: 10,
      startsHourRemaining: 50,
      startsDayRemaining: 100,
      sandboxesAtOnce: this.options.maxConcurrent,
      sandboxesAtOnceRemaining: this.options.maxConcurrent - this.sandboxes.size,
      walletBalance: 100,
      planIncludedVmHoursRemaining: 1000,
      machineTypes: [
        { type: "small", available: true },
        { type: "default", available: true },
        { type: "large", available: true },
        { type: "xlarge", available: true },
      ],
    };
  }

  async getUsage(sandboxId: string): Promise<BoatUsage> {
    return { seconds: 60, sandboxType: "default", dollars: 0.006 };
  }

  async saveSnapshot(sandboxId: string, name: string): Promise<void> {}

  async getSavedSnapshot(name: string): Promise<{ status: string; snapshotId?: string }> {
    return { status: "ready", snapshotId: `snap_${name}` };
  }

  async deleteSavedSnapshot(name: string): Promise<void> {}
}
