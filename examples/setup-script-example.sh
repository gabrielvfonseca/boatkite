#!/usr/bin/env bash
# Example setup script for `boatkite snapshot`.
#
# Run:  BOATKITE_SETUP_SCRIPT=./examples/setup-script-example.sh boatkite snapshot
#
# This script runs *inside* the sandbox before the snapshot is saved.
# Anything you install here is baked into the snapshot and available
# in every VM created from it.

set -euo pipefail

echo "=== Installing extra tools ==="

# Example: install a specific Node version manager
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Example: install Go
export GO_VERSION=1.23.4
curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
tar -C /usr/local -xzf /tmp/go.tar.gz
rm /tmp/go.tar.gz

# Example: install a system package
apt-get install -y make gcc

# Example: pre-pull additional Docker images
# These get baked into the snapshot as stopped containers.
docker pull golang:1.23
docker create --name keep-golang golang:1.23

docker pull python:3.12
docker create --name keep-python python:3.12

echo "=== Setup complete ==="
