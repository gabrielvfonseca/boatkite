/**
 * boatkite status - shows running sandboxes, waiting jobs, recent jobs
 */

import { BoatRestClient } from "../clients/boat-rest.js";
import { BuildkiteRestClient } from "../clients/buildkite-rest.js";
import { logger } from "../core/logger.js";
import { DEFAULT_CONFIG, loadConfig, validateConfig } from "../util/config.js";

export async function statusCommand(): Promise<void> {
  const fileConfig = loadConfig();
  const config = validateConfig({ ...DEFAULT_CONFIG, ...fileConfig });

  const boat = new BoatRestClient(config.boatApiKey);
  const buildkite = new BuildkiteRestClient(config.buildkiteToken, config.buildkiteOrg);

  try {
    const sandboxes = await boat.listSandboxes({ namePrefix: "bk-" });
    const running = sandboxes.filter((s) =>
      ["ready", "idle", "running", "provisioning", "provisioned", "cloning"].includes(s.state),
    );

    console.log("\n=== boatkite status ===\n");
    console.log(`Queue: ${config.queue}`);
    console.log(`Running VMs: ${running.length} / ${config.maxVms}\n`);

    if (running.length > 0) {
      console.log("Sandboxes:");
      for (const sb of running) {
        const match = sb.name.match(/^bk-([^-]+)-([a-f0-9-]+)$/);
        const jobId = match ? match[2] : "unknown";
        console.log(`  ${sb.id}  ${sb.name}  state=${sb.state}  type=${sb.type}  job=${jobId}`);
      }
      console.log("");
    }

    const jobs = await buildkite.findScheduledJobs(config.queue);
    console.log(`Waiting jobs: ${jobs.length}\n`);

    if (jobs.length > 0) {
      console.log("Jobs:");
      for (const job of jobs.slice(0, 10)) {
        const pipeline = job.build?.pipeline?.slug ?? job.pipeline?.slug ?? "unknown";
        console.log(`  ${job.id}  pipeline=${pipeline}  state=${job.state}`);
      }
      if (jobs.length > 10) {
        console.log(`  ... and ${jobs.length - 10} more`);
      }
      console.log("");
    }
  } catch (err) {
    logger.error("Failed to get status", { error: String(err) });
    process.exit(1);
  }
}
