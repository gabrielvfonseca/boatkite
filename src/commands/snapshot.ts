/**
 * boatkite snapshot - creates a Boat sandbox, installs buildkite-agent,
 * Docker extras and any user packages from a setup script, saves it as a
 * snapshot, then deletes the sandbox.
 */

import { BoatRestClient } from "../clients/boat-rest.js";
import { sleep } from "../core/backoff.js";
import { logger } from "../core/logger.js";
import { DEFAULT_CONFIG, loadConfig, validateConfig } from "../util/config.js";

export async function snapshotCommand(options: { config?: string; name?: string }): Promise<void> {
  const fileConfig = loadConfig();
  const config = validateConfig({ ...DEFAULT_CONFIG, ...fileConfig });
  const snapshotName = options.name ?? config.boatSnapshot ?? "boatkite";

  const boat = new BoatRestClient(config.boatApiKey);

  try {
    logger.info(`Creating sandbox for snapshot: ${snapshotName}`);

    // Create a sandbox
    const result = await boat.createSandbox({
      type: "default",
      ttlSeconds: 3600,
      name: "boatkite-snapshot-builder",
    });

    const sandboxId = result.sandbox.id;
    logger.info(`Sandbox created: ${sandboxId}`);

    // Wait for ready
    let attempts = 0;
    while (attempts < 60) {
      const sb = await boat.getSandbox(sandboxId);
      if (sb.state === "ready" || sb.state === "idle" || sb.state === "running") {
        break;
      }
      await sleep(2000);
      attempts++;
    }

    // Install buildkite-agent
    logger.info("Installing buildkite-agent...");
    await boat.runCommand(
      sandboxId,
      [
        "curl -fsSL https://keys.openpgp.org/vks/v1/by-fingerprint/32A37959C25FAE4BDE28A9F3138D395B1B9F0A0E | gpg --dearmor -o /usr/share/keyrings/buildkite-agent-archive-keyring.gpg",
        "echo 'deb [signed-by=/usr/share/keyrings/buildkite-agent-archive-keyring.gpg] https://apt.buildkite.com/buildkite-agent stable main' > /etc/apt/sources.list.d/buildkite-agent.list",
        "apt-get update",
        "apt-get install -y buildkite-agent",
      ].join(" && "),
      { timeoutSeconds: 120 },
    );

    // Docker extras: pull images and create containers to keep them
    logger.info("Setting up Docker images...");
    const dockerImages = ["postgres:16", "redis:7", "node:20"];
    for (const image of dockerImages) {
      try {
        await boat.runCommand(sandboxId, `docker pull ${image}`, { timeoutSeconds: 60 });
        await boat.runCommand(
          sandboxId,
          `docker create --name keep-${image.replace(/[^a-z0-9]/gi, "-")} ${image}`,
          { timeoutSeconds: 30 },
        );
        logger.info(`Docker image ready: ${image}`);
      } catch (err) {
        logger.warn(`Failed to pull image ${image}`, { error: String(err) });
      }
    }

    // Install user packages from setup script if provided
    const setupScript = process.env.BOATKITE_SETUP_SCRIPT;
    if (setupScript) {
      logger.info("Running user setup script...");
      await boat.runCommand(sandboxId, setupScript, { timeoutSeconds: 300 });
    }

    // Save snapshot
    logger.info(`Saving snapshot: ${snapshotName}`);
    await boat.saveSnapshot(sandboxId, snapshotName);

    // Wait for snapshot to be ready
    attempts = 0;
    while (attempts < 120) {
      const snap = await boat.getSavedSnapshot(snapshotName);
      if (snap.status === "ready") {
        break;
      }
      if (snap.status === "failed") {
        throw new Error(`Snapshot failed: ${snap.status}`);
      }
      await sleep(5000);
      attempts++;
    }

    logger.info(`Snapshot ready: ${snapshotName}`);

    // Delete sandbox
    await boat.deleteSandbox(sandboxId);
    logger.info("Sandbox deleted, snapshot saved");
  } catch (err) {
    logger.error("Snapshot creation failed", { error: String(err) });
    process.exit(1);
  }
}
