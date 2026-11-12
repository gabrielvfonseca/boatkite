#!/usr/bin/env node
/**
 * boatkite CLI
 */

import { Command } from "commander";
import { cleanupCommand } from "./commands/cleanup.js";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("boatkite")
  .description("Autoscaler that runs Buildkite jobs on boat.dev VMs")
  .version("0.1.0");

program
  .command("run")
  .description("Run the scaler")
  .option("-c, --config <path>", "Config file path")
  .action(runCommand);

program.command("init").description("Interactive setup").action(initCommand);

program
  .command("status")
  .description("Show running sandboxes, waiting jobs, recent jobs")
  .action(statusCommand);

program
  .command("cleanup")
  .description("Delete orphaned bk-* sandboxes")
  .option("-c, --config <path>", "Config file path")
  .action(cleanupCommand);

program
  .command("snapshot")
  .description("Create a Boat snapshot with buildkite-agent installed")
  .option("-c, --config <path>", "Config file path")
  .option("-n, --name <name>", "Snapshot name", "boatkite")
  .action(snapshotCommand);

program.parse();
