/**
 * boatkite init - interactive setup
 */

import * as readline from "node:readline";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../core/logger.js";

export async function initCommand(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  logger.info("boatkite init - interactive setup\n");

  const boatApiKey = await ask("Boat API key (boat_...): ");
  const buildkiteToken = await ask("Buildkite API token: ");
  const buildkiteOrg = await ask("Buildkite organization slug: ");
  const queue = await ask("Buildkite queue name [default]: ") || "default";
  const maxVms = parseInt(await ask("Max concurrent VMs [5]: ") || "5", 10);
  const maxJobMinutes = parseInt(await ask("Max job duration in minutes [60]: ") || "60", 10);
  const boatSnapshot = await ask("Boat snapshot name [boatkite]: ") || "boatkite";
  const defaultSize = await ask("Default VM size (small/default/large/xlarge) [default]: ") || "default";

  rl.close();

  const config = {
    boatApiKey,
    buildkiteToken,
    buildkiteOrg,
    queue,
    maxVms,
    maxJobMinutes,
    pollIntervalMs: 10_000,
    webhookPort: 8080,
    boatSnapshot,
    debugRetentionMinutes: 30,
    defaultSize,
  };

  const configPath = resolve(process.cwd(), "boatkite.config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  logger.info(`Config written to ${configPath}`);

  // Also write .env
  const envPath = resolve(process.cwd(), ".env");
  const envContent = [
    `BOATKITE_BOAT_API_KEY=${boatApiKey}`,
    `BOATKITE_BUILDKITE_TOKEN=${buildkiteToken}`,
    `BOATKITE_BUILDKITE_ORG=${buildkiteOrg}`,
    `BOATKITE_QUEUE=${queue}`,
    `BOATKITE_MAX_VMS=${maxVms}`,
    `BOATKITE_MAX_JOB_MINUTES=${maxJobMinutes}`,
    `BOATKITE_BOAT_SNAPSHOT=${boatSnapshot}`,
    `BOATKITE_DEFAULT_SIZE=${defaultSize}`,
  ].join("\n");
  writeFileSync(envPath, envContent);
  logger.info(`Env file written to ${envPath}`);
}
