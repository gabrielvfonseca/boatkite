# Boatkite

**Autoscaler that runs Buildkite jobs on boat.dev VMs.**

boatkite watches your Buildkite queues for waiting jobs and runs each one on a fresh, full Linux VM from [boat.dev](https://boat.dev). Each job gets its own VM with Docker, root access, and `/dev/kvm` — billed per second, deleted when the job ends.

Think of it like Buildkite's `runs-on: boat`, but for self-hosted Buildkite agents.

## Why?

Buildkite's hosted runners are great, but sometimes you need:
- A full VM per job (Docker, Docker Compose, nested virtualization)
- Per-second billing (no minimums)
- Root access and full control
- EU regions

boat.dev gives you all of that. boatkite connects the two.

## Quickstart

### 1. Prerequisites

- A [boat.dev](https://boat.dev) account with an API key
- A Buildkite account with an agent token
- Node.js 20+

### 2. Install

```bash
npm link && boatkite init
```

This will prompt for your API keys and create a `boatkite.config.json`.

### 3. Create a snapshot

```bash
boatkite snapshot
```

This creates a Boat sandbox with `buildkite-agent` and Docker installed, then saves it as a snapshot.

### 4. Run

```bash
boatkite run
```

boatkite will now watch your queue and start VMs for waiting jobs.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `boatApiKey` | Boat API key (boat_...) | Required |
| `buildkiteToken` | Buildkite API token (scaler's own REST client) | Required |
| `agentToken` | Buildkite agent token (passed to job VMs) | Required |
| `buildkiteOrg` | Buildkite organization slug | Required |
| `queue` | Buildkite queue to watch | `default` |
| `maxVms` | Maximum concurrent VMs | `5` |
| `maxJobMinutes` | Maximum job duration | `60` |
| `pollIntervalMs` | Poll interval in ms | `10000` |
| `webhookPort` | Webhook listener port | `8080` |
| `boatSnapshot` | Default snapshot name | `boatkite` |
| `defaultSize` | Default VM size | `default` |

### Agent Tags

You can control VM size and snapshot per job using agent tags:

```yaml
steps:
  - label: "Big build"
    command: "make build"
    agents:
      queue: "boat"
      boat-size: "large"      # small, default, large, xlarge
      boat-snapshot: "my-base" # custom snapshot
```

## Security

- The Boat API key stays in the scaler only — never copied into job VMs
- Two-token split: `buildkiteToken` (API) is used by the scaler's REST client and never enters job VMs; `agentToken` (scoped agent token) is what each job VM receives so its `buildkite-agent` can register
- `noEnv: true` is set on all sandboxes — no Boat secrets leak into CI
- All tokens are masked in logs

**Warning**: Anyone who can push to your pipeline can run code on these VMs. Protect your pipeline like you would any self-hosted CI.

## Limits

- Linux x86_64 only
- EU regions only
- Boat start limits apply (12/min, 60/h, 200/day on $20 plan)
- Max size: 16 vCPU / 32 GB

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT

## Disclaimer

This is an unofficial project. Not affiliated with boat.dev or Buildkite.
