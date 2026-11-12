# Research: boatkite

## Boat

### Sizes
- small: 2 vCPU, 4 GB RAM, 51 GB disk, $0.018/h
- default: 4 vCPU, 8 GB RAM, 51 GB disk, $0.036/h
- large: 8 vCPU, 16 GB RAM, 111 GB disk, $0.072/h
- xlarge: 16 vCPU, 32 GB RAM, 251 GB disk, $0.200/h (needs $100/mo plan)

### Plans
- $20/mo: 100 at once, starts 12/min, 60/h, 200/day
- $100/mo: 300 at once, starts 30/min, 210/h, 840/day
- $500/mo: 1000 at once, starts 65/min, 420/h, 1680/day
- $2000/mo: 2000 at once, starts 90/min, 600/h, 2400/day

### API
- Base URL: https://boat.dev/api/v1
- Auth: Bearer boat_... API key
- POST /sandboxes - create sandbox
- POST /sandboxes/{id}/commands - run command
- POST /sandboxes/{id}/stop - stop
- DELETE /sandboxes/{id} - delete (needs X-Ascii-Confirm-Delete header)
- POST /saved-snapshots - save snapshot
- GET /limits - check limits
- Idempotency-Key header for safe retries
- 429 rate_limited with Retry-After header
- Sandbox states: provisioning, ready, idle, running, archiving, archived, error, cancelled

### SDK
- @boatdev/sdk for TypeScript
- Methods: create, get, stop, deleteSandbox, command, commandStatus, etc.
- Helper: waitUntilReady, runCommand, streamCommand

### Snapshots
- Saved snapshots: 10 free per $20/mo plan
- Only Docker images used by containers are kept
- Must use docker create --name keep-<x> <image> to preserve Docker images

### Environments
- Per-sandbox env vars via create request (max 100 vars, 64KB)
- noEnv: true gives sandbox no secrets
- Environment variables injected on top of account environment

### Webhooks
- 6 events: sandbox.ready, sandbox.hydrated, sandbox.error, sandbox.archived, sandbox.degraded, sandbox.recovered
- HMAC-SHA256 signature verification

## Buildkite

### Agent
- Self-hosted agent polls Buildkite over HTTPS
- --acquire-job <job-id>: start agent, run only that job, disconnect after
- --disconnect-after-job: disconnect after one job
- --tags "queue=<name>": assign to queue
- --token: agent token
- --queue: queue to listen to
- Agent tokens: long-lived, created per cluster
- Job acquisition tokens: short-lived, for stack-managed ephemeral agents

### APIs
- REST API: https://api.buildkite.com/v2
- GraphQL API: https://graphql.buildkite.com/v1
- Agent API: used by agent-stack-k8s controller
- job.scheduled webhook event
- job.finished webhook event
- Buildkite agent metrics endpoint used by buildkite-agent-metrics

### Queues
- Agents assigned to queue via --tags "queue=<name>"
- Pipeline steps target queue via agents: { queue: <name> }
- Default queue if not specified

## Key Findings

1. **--acquire-job is confirmed**: The docs explicitly state it allows starting an agent to run only a specific job, disconnecting after it's finished. This is exactly what boatkite needs.

2. **Boat create sandbox**: POST /sandboxes accepts `from` (saved snapshot name), `type`, `ttlSeconds`, `env`, `noEnv`, `labels`, `name`, `setupScript`, `files`. We should use `noEnv: true` to prevent secrets leaking into job VMs.

3. **Docker images in snapshots**: Must use `docker create --name keep-<x> <image>` to preserve Docker images. A plain `docker pull` is lost.

4. **429 handling**: Boat returns Retry-After header. Start limits use rolling windows (minute/hour/day). Paid starts from wallet above limits.

5. **Idempotency**: POST /sandboxes supports Idempotency-Key header for safe retries.

6. **Buildkite job tokens**: Job tokens expire when job finishes. BUILDKITE_AGENT_ACCESS_TOKEN env var. Job tokens inherit source agent token permissions.

7. **Boat environments**: Use `noEnv: true` to ensure no secrets leak. Per-sandbox env vars can be set via create request.

8. **Sandbox naming**: We can use the `name` field to set `bk-<pipeline>-<job-id>` for easy identification.

9. **Webhook events**: Buildkite sends job.scheduled and job.finished. Boat sends sandbox lifecycle events.

10. **agent-stack-k8s**: Uses Agent REST API (not GraphQL since v0.28.0). Creates Kubernetes jobs with containers for agent, checkout, and user steps.