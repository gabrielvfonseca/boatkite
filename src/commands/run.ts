/**
 * boatkite run - runs the scaler
 */

import { BoatRestClient } from "../clients/boat-rest.js";
import { BuildkiteRestClient } from "../clients/buildkite-rest.js";
import { logger } from "../core/logger.js";
import { Scaler } from "../core/scaler.js";
import { DEFAULT_CONFIG, loadConfig, validateConfig } from "../util/config.js";

export async function runCommand(options: { config?: string }): Promise<void> {
  const fileConfig = loadConfig();
  const config = validateConfig({ ...DEFAULT_CONFIG, ...fileConfig });

  const boat = new BoatRestClient(config.boatApiKey);
  const buildkite = new BuildkiteRestClient(config.buildkiteToken, config.buildkiteOrg);

  // Persistent abort signal for the lifetime of the process.
  const abortController = new AbortController();

  const scaler = new Scaler({
    boat,
    buildkite,
    config,
    signal: abortController.signal,
    onMetrics: (m) => {
      logger.debug("Metrics", { ...m });
    },
  });

  // Handle shutdown signals
  const shutdown = async () => {
    logger.info("Received shutdown signal");
    abortController.abort();
    await scaler.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await scaler.start();
}
