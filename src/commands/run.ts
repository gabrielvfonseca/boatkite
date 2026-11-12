/**
 * boatkite run - runs the scaler
 */

import { Scaler } from "../core/scaler.js";
import { loadConfig, validateConfig, DEFAULT_CONFIG } from "../util/config.js";
import { BoatRestClient } from "../clients/boat-rest.js";
import { BuildkiteRestClient } from "../clients/buildkite-rest.js";
import { logger } from "../core/logger.js";

export async function runCommand(options: { config?: string }): Promise<void> {
  const fileConfig = loadConfig();
  const config = validateConfig({ ...DEFAULT_CONFIG, ...fileConfig });

  const boat = new BoatRestClient(config.boatApiKey);
  const buildkite = new BuildkiteRestClient(config.buildkiteToken, config.buildkiteOrg);

  const scaler = new Scaler({
    boat,
    buildkite,
    config,
    signal: AbortSignal.timeout(0), // No timeout
    onMetrics: (m) => {
      logger.debug("Metrics", { ...m });
    },
  });

  // Handle shutdown signals
  const shutdown = async () => {
    logger.info("Received shutdown signal");
    await scaler.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await scaler.start();
}
