/**
 * Configuration loading and validation.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BoatkiteConfig, SandboxType } from "../types.js";

const CONFIG_FILES = [
  "boatkite.config.json",
  "boatkite.config.yaml",
  "boatkite.config.yml",
  ".env",
];

export function loadConfig(): Partial<BoatkiteConfig> {
  for (const file of CONFIG_FILES) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf-8");
    if (file.endsWith(".json")) {
      return JSON.parse(content);
    }
    if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      return parseYaml(content) as Partial<BoatkiteConfig>;
    }
    // .env file
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    }
    return mapEnvToConfig(result);
  }
  return {};
}

function mapEnvToConfig(env: Record<string, string>): Partial<BoatkiteConfig> {
  const config: Partial<BoatkiteConfig> = {};
  if (env.BOATKITE_BOAT_API_KEY) config.boatApiKey = env.BOATKITE_BOAT_API_KEY;
  if (env.BOATKITE_BUILDKITE_TOKEN) config.buildkiteToken = env.BOATKITE_BUILDKITE_TOKEN;
  if (env.BOATKITE_AGENT_TOKEN) config.agentToken = env.BOATKITE_AGENT_TOKEN;
  if (env.BOATKITE_BUILDKITE_ORG) config.buildkiteOrg = env.BOATKITE_BUILDKITE_ORG;
  if (env.BOATKITE_QUEUE) config.queue = env.BOATKITE_QUEUE;
  if (env.BOATKITE_MAX_VMS) config.maxVms = Number.parseInt(env.BOATKITE_MAX_VMS, 10);
  if (env.BOATKITE_MAX_JOB_MINUTES)
    config.maxJobMinutes = Number.parseInt(env.BOATKITE_MAX_JOB_MINUTES, 10);
  if (env.BOATKITE_POLL_INTERVAL_MS)
    config.pollIntervalMs = Number.parseInt(env.BOATKITE_POLL_INTERVAL_MS, 10);
  if (env.BOATKITE_WEBHOOK_PORT)
    config.webhookPort = Number.parseInt(env.BOATKITE_WEBHOOK_PORT, 10);
  if (env.BOATKITE_BOAT_SNAPSHOT) config.boatSnapshot = env.BOATKITE_BOAT_SNAPSHOT;
  if (env.BOATKITE_METRICS_PORT)
    config.metricsPort = Number.parseInt(env.BOATKITE_METRICS_PORT, 10);
  if (env.BOATKITE_DEBUG_RETENTION_MINUTES)
    config.debugRetentionMinutes = Number.parseInt(env.BOATKITE_DEBUG_RETENTION_MINUTES, 10);
  if (env.BOATKITE_DEFAULT_SIZE) config.defaultSize = env.BOATKITE_DEFAULT_SIZE as SandboxType;
  return config;
}

export function validateConfig(config: Partial<BoatkiteConfig>): BoatkiteConfig {
  const required: (keyof BoatkiteConfig)[] = [
    "boatApiKey",
    "buildkiteToken",
    "agentToken",
    "buildkiteOrg",
    "queue",
    "maxVms",
    "maxJobMinutes",
    "pollIntervalMs",
    "webhookPort",
    "boatSnapshot",
    "debugRetentionMinutes",
    "defaultSize",
  ];

  for (const key of required) {
    if (config[key] === undefined) {
      throw new Error(`Missing required config: ${key}`);
    }
  }

  const requiredValues = {} as Record<keyof BoatkiteConfig, never>;
  for (const key of required) {
    const value = config[key];
    if (value === undefined) {
      throw new Error(`Missing required config: ${key}`);
    }
    (requiredValues as Record<string, unknown>)[key] = value;
  }

  return {
    boatApiKey: requiredValues.boatApiKey,
    buildkiteToken: requiredValues.buildkiteToken,
    agentToken: requiredValues.agentToken,
    buildkiteOrg: requiredValues.buildkiteOrg,
    queue: requiredValues.queue,
    maxVms: requiredValues.maxVms,
    maxJobMinutes: requiredValues.maxJobMinutes,
    pollIntervalMs: requiredValues.pollIntervalMs,
    webhookPort: requiredValues.webhookPort,
    webhookHost: config.webhookHost,
    boatSnapshot: requiredValues.boatSnapshot,
    metricsPort: config.metricsPort,
    debugRetentionMinutes: requiredValues.debugRetentionMinutes,
    defaultSize: requiredValues.defaultSize,
    region: config.region,
  };
}

export const DEFAULT_CONFIG: Partial<BoatkiteConfig> = {
  agentToken: "",
  queue: "default",
  maxVms: 5,
  maxJobMinutes: 60,
  pollIntervalMs: 10_000,
  webhookPort: 8080,
  boatSnapshot: "boatkite",
  debugRetentionMinutes: 30,
  defaultSize: "default",
};
