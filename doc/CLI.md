# CLI Reference

Paperclip CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm stapler --help
```

First-time local bootstrap + run:

```sh
pnpm stapler run
```

Choose local instance:

```sh
pnpm stapler run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `paperclipai onboard` and `paperclipai configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `paperclipai run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `STAPLER_DEPLOYMENT_MODE`
- `paperclipai run` and `paperclipai doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm stapler allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm paperclipai env-lab up
pnpm paperclipai env-lab doctor
pnpm paperclipai env-lab status --json
pnpm paperclipai env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.paperclip`:

```sh
pnpm stapler run --data-dir ./tmp/paperclip-dev
pnpm stapler issue list --data-dir ./tmp/paperclip-dev
```

## Context Profiles

Store local defaults in `~/.paperclip/context.json`:

```sh
pnpm stapler context set --api-base http://localhost:3100 --company-id <company-id>
pnpm stapler context show
pnpm stapler context list
pnpm stapler context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm stapler context set --api-key-env-var-name STAPLER_API_KEY
export STAPLER_API_KEY=...
```

## Company Commands

```sh
pnpm stapler company list
pnpm stapler company get <company-id>
pnpm stapler company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm stapler company delete PAP --yes --confirm PAP
pnpm stapler company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `STAPLER_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `STAPLER_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm stapler issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm stapler issue get <issue-id-or-identifier>
pnpm stapler issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm stapler issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm stapler issue comment <issue-id> --body "..." [--reopen]
pnpm stapler issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm stapler issue release <issue-id>
```

## Agent Commands

```sh
pnpm stapler agent list --company-id <company-id>
pnpm stapler agent get <agent-id>
pnpm stapler agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Paperclip agent:

- creates a new long-lived agent API key
- installs missing Paperclip skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `STAPLER_API_URL`, `STAPLER_COMPANY_ID`, `STAPLER_AGENT_ID`, and `STAPLER_API_KEY`

Example for shortname-based local setup:

```sh
pnpm stapler agent local-cli codexcoder --company-id <company-id>
pnpm stapler agent local-cli claudecoder --company-id <company-id>
```

## Approval Commands

```sh
pnpm stapler approval list --company-id <company-id> [--status pending]
pnpm stapler approval get <approval-id>
pnpm stapler approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm stapler approval approve <approval-id> [--decision-note "..."]
pnpm stapler approval reject <approval-id> [--decision-note "..."]
pnpm stapler approval request-revision <approval-id> [--decision-note "..."]
pnpm stapler approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm stapler approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm stapler activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm stapler dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm stapler heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.paperclip/instances/default`:

- config: `~/.paperclip/instances/default/config.json`
- embedded db: `~/.paperclip/instances/default/db`
- logs: `~/.paperclip/instances/default/logs`
- storage: `~/.paperclip/instances/default/data/storage`
- secrets key: `~/.paperclip/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
STAPLER_HOME=/custom/home STAPLER_INSTANCE_ID=dev pnpm stapler run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm stapler configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
