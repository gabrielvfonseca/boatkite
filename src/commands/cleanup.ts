/**
 * boatkite cleanup - deletes orphaned bk-* sandboxes
 */

import { BoatRestClient } from "../clients/boat-rest.js";
import { BuildkiteRestClient } from "../clients/buildkite-rest.js";
import { logger } from "../core/logger.js";
import { DEFAULT_CONFIG, loadConfig, validateConfig } from "../util/config.js";

export async function cleanupCommand(options: { config?: string }): Promise<void> {
  const fileConfig = loadConfig();
  const config = validateConfig({ ...DEFAULT_CONFIG, ...fileConfig });

  const boat = new BoatRestClient(config.boatApiKey);
  const buildkite = new BuildkiteRestClient(config.buildkiteToken, config.buildkiteOrg);

  try {
    const sandboxes = await boat.listSandboxes({ namePrefix: "bk-" });
    let deleted = 0;

    for (const sb of sandboxes) {
      const match = sb.name.match(/^bk-([^-]+)-([a-f0-9-]+)$/);
      if (!match) {
        // Doesn't match our naming pattern, skip
        continue;
      }

      const jobId = match[2];
      try {
        const job = await buildkite.getJob(jobId);
        const terminalStates = ["passed", "failed", "canceled", "cancelled", "broken"];
        if (terminalStates.includes(job.state ?? "")) {
          logger.info("Deleting orphan sandbox", {
            sandboxId: sb.id,
            jobId,
            state: job.state,
          });
          await boat.deleteSandbox(sb.id);
          deleted++;
        }
      } catch (err) {
        if ((err as { status?: number })?.status === 404) {
          // Job not found, delete sandbox
          logger.info("Deleting sandbox for unknown job", { sandboxId: sb.id });
          await boat.deleteSandbox(sb.id);
          deleted++;
        }
      }
    }

    logger.info(`Cleanup complete, deleted ${deleted} sandboxes`);
  } catch (err) {
    logger.error("Cleanup failed", { error: String(err) });
    process.exit(1);
  }
}
