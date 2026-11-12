/**
 * Boat REST API client using @boatdev/sdk.
 * Falls back to fetch if SDK is not available.
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

const BOAT_API_BASE = "https://boat.dev/api/v1";

export class BoatRestClient implements IBoatClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BOAT_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = body as { message?: string; code?: string; retryAfter?: number };
      throw new BoatApiError(
        error.message ?? `Boat API error: ${res.status}`,
        res.status,
        error.code,
        error.retryAfter ??
          (res.headers.get("retry-after")
            ? Number.parseInt(res.headers.get("retry-after") ?? "")
            : undefined),
      );
    }

    return res.json() as Promise<T>;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<{ sandbox: BoatSandbox }> {
    const body: Record<string, unknown> = {};
    if (options.from) body.from = options.from;
    if (options.type) body.type = options.type;
    if (options.ttlSeconds !== undefined) body.ttlSeconds = options.ttlSeconds;
    if (options.env) body.env = options.env;
    if (options.noEnv) body.noEnv = options.noEnv;
    if (options.labels) body.labels = options.labels;
    if (options.name) body.name = options.name;

    const headers: Record<string, string> = {};
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const result = await this.request<{ sandbox: BoatSandbox }>("/sandboxes", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });

    return result;
  }

  async getSandbox(sandboxId: string): Promise<BoatSandbox> {
    const result = await this.request<{ sandbox: BoatSandbox }>(`/sandboxes/${sandboxId}`);
    return result.sandbox;
  }

  async listSandboxes(options?: { namePrefix?: string; state?: SandboxState }): Promise<
    BoatSandbox[]
  > {
    const params = new URLSearchParams();
    if (options?.namePrefix) params.set("namePrefix", options.namePrefix);
    if (options?.state) params.set("state", options.state);
    const query = params.toString() ? `?${params.toString()}` : "";
    const result = await this.request<{ sandboxes: BoatSandbox[] }>(`/sandboxes${query}`);
    return result.sandboxes ?? [];
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    await this.request(`/sandboxes/${sandboxId}`, {
      method: "DELETE",
      headers: {
        "X-Ascii-Confirm-Delete": sandboxId,
      },
    });
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    await this.request(`/sandboxes/${sandboxId}/stop`, {
      method: "POST",
    });
  }

  async runCommand(
    sandboxId: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandResult | { processId: string }> {
    const body: Record<string, unknown> = { command };
    if (options?.cwd) body.cwd = options.cwd;
    if (options?.timeoutSeconds) body.timeoutSeconds = options.timeoutSeconds;
    if (options?.detached) body.detached = options.detached;
    if (options?.stream) body.stream = options.stream;
    if (options?.env) body.env = options.env;

    const result = (await this.request(`/sandboxes/${sandboxId}/commands`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as CommandResult | { processId: string };
    return result;
  }

  async runCommandDetached(
    sandboxId: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandStarted> {
    const result = (await this.runCommand(sandboxId, command, {
      ...options,
      detached: true,
    })) as { processId: string };
    return { processId: result.processId };
  }

  async getCommandStatus(
    sandboxId: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode?: number }> {
    return this.request(`/sandboxes/${sandboxId}/commands/${processId}`);
  }

  async stopCommand(sandboxId: string, processId: string): Promise<void> {
    await this.request(`/sandboxes/${sandboxId}/commands/${processId}`, {
      method: "DELETE",
    });
  }

  async getLimits(): Promise<BoatLimits> {
    return this.request("/limits");
  }

  async getUsage(sandboxId: string): Promise<BoatUsage> {
    return this.request(`/sandboxes/${sandboxId}/usage`);
  }

  async saveSnapshot(sandboxId: string, name: string): Promise<void> {
    await this.request("/saved-snapshots", {
      method: "POST",
      body: JSON.stringify({ sandboxId, name }),
    });
  }

  async getSavedSnapshot(name: string): Promise<{ status: string; snapshotId?: string }> {
    const result = await this.request<{ snapshot: { status: string; snapshotId?: string } }>(
      `/saved-snapshots/${name}`,
    );
    return result.snapshot;
  }

  async deleteSavedSnapshot(name: string): Promise<void> {
    await this.request(`/saved-snapshots/${name}`, {
      method: "DELETE",
    });
  }
}
