#!/usr/bin/env node
/**
 * Versioning entrypoint for the changesets release workflow.
 *
 * `changeset version` bumps package.json, updates CHANGELOG.md, and writes
 * the version commit. This script then creates a matching GitHub Release so
 * the version tag points at the already-pushed, version-bumped commit.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Bump versions and generate the changelog first, so the tag matches the
// newly-bumped version (not the pre-bump one).
execSync("npx changeset version", { stdio: "inherit", cwd: root });

const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const tag = `v${version}`;
const title = `boatkite ${tag}`;

// Create a pre-referenced release pointing at the version commit we just made.
execSync(`gh release create ${tag} --title ${JSON.stringify(title)} --verify-tag`, {
  stdio: "inherit",
  cwd: root,
});
