/**
 * Configuration loading and validation.
 */

import { readFileSync, existsSync } from "node:fs";
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
  if (env.BOATKITE_BUILDKITE_ORG) config.buildkiteOrg = env.BOATKITE_BUILDKITE_ORG;
  if (env.BOATKITE_QUEUE) config.queue = env.BOATKITE_QUEUE;
  if (env.BOATKITE_MAX_VMS) config.maxVms = parseInt(env.BOATKITE_MAX_VMS, 10);
  if (env.BOATKITE_MAX_JOB_MINUTES) config.maxJobMinutes = parseInt(env.BOATKITE_MAX_JOB_MINUTES, 10);
  if (env.BOATKITE_POLL_INTERVAL_MS) config.pollIntervalMs = parseInt(env.BOATKITE_POLL_INTERVAL_MS, 10);
  if (env.BOATKITE_WEBHOOK_PORT) config.webhookPort = parseInt(env.BOATKITE_WEBHOOK_PORT, 10);
  if (env.BOATKITE_BOAT_SNAPSHOT) config.boatSnapshot = env.BOATKITE_BOAT_SNAPSHOT;
  if (env.BOATKITE_METRICS_PORT) config.metricsPort = parseInt(env.BOATKITE_METRICS_PORT, 10);
  if (env.BOATKITE_DEBUG_RETENTION_MINUTES) config.debugRetentionMinutes = parseInt(env.BOATKITE_DEBUG_RETENTION_MINUTES, 10);
  if (env.BOATKITE_DEFAULT_SIZE) config.defaultSize = env.BOATKITE_DEFAULT_SIZE as SandboxType;
  return config;
}

export function validateConfig(config: Partial<BoatkiteConfig>): BoatkiteConfig {
  const required: (keyof BoatkiteConfig)[] = [
    "boatApiKey",
    "buildkiteToken",
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

  return {
    boatApiKey: config.boatApiKey!,
    buildkiteToken: config.buildkiteToken!,
    buildkiteOrg: config.buildkiteOrg!,
    queue: config.queue!,
    maxVms: config.maxVms!,
    maxJobMinutes: config.maxJobMinutes!,
    pollIntervalMs: config.pollIntervalMs!,
    webhookPort: config.webhookPort!,
    webhookHost: config.webhookHost,
    boatSnapshot: config.boatSnapshot!,
    metricsPort: config.metricsPort,
    debugRetentionMinutes: config.debugRetentionMinutes!,
    defaultSize: config.defaultSize!,
    region: config.region,
  };
}

export const DEFAULT_CONFIG: Partial<BoatkiteConfig> = {
  queue: "default",
  maxVms: 5,
  maxJobMinutes: 60,
  pollIntervalMs: 10_000,
  webhookPort: 8080,
  boatSnapshot: "boatkite",
  debugRetentionMinutes: 30,
  defaultSize: "default",
};
