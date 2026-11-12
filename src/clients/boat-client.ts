/**
 * Boat API client interface. Implemented with @boatdev/sdk and a fake for tests.
 */

import type {
  BoatLimits,
  BoatSandbox,
  BoatUsage,
  BoatWebhookPayload,
  CommandOptions,
  CommandResult,
  CommandStarted,
  CreateSandboxOptions,
  SandboxState,
  SandboxType,
} from "../types.js";

export interface IBoatClient {
  createSandbox(options: CreateSandboxOptions): Promise<{ sandbox: BoatSandbox }>;
  getSandbox(sandboxId: string): Promise<BoatSandbox>;
  listSandboxes(options?: { namePrefix?: string; state?: SandboxState }): Promise<BoatSandbox[]>;
  deleteSandbox(sandboxId: string): Promise<void>;
  stopSandbox(sandboxId: string): Promise<void>;
  runCommand(sandboxId: string, command: string, options?: CommandOptions): Promise<CommandResult>;
  runCommandDetached(
    sandboxId: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandStarted>;
  getCommandStatus(
    sandboxId: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode?: number }>;
  stopCommand(sandboxId: string, processId: string): Promise<void>;
  getLimits(): Promise<BoatLimits>;
  getUsage(sandboxId: string): Promise<BoatUsage>;
  saveSnapshot(sandboxId: string, name: string): Promise<void>;
  getSavedSnapshot(name: string): Promise<{ status: string; snapshotId?: string }>;
  deleteSavedSnapshot(name: string): Promise<void>;
}

export class BoatApiError extends Error {
  status: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "BoatApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function isRateLimited(error: unknown): error is BoatApiError {
  return error instanceof BoatApiError && error.status === 429;
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof BoatApiError) {
    return error.status === 429 || error.status === 503 || error.status >= 500;
  }
  return false;
}
