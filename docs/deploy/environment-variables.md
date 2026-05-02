---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Paperclip uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `STAPLER_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `STAPLER_BIND_HOST` | (unset) | Required when `STAPLER_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `STAPLER_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `STAPLER_HOME` | `~/.paperclip` | Base directory for all Paperclip data |
| `STAPLER_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `STAPLER_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `STAPLER_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `STAPLER_API_URL` | (auto-derived) | Paperclip API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `STAPLER_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `STAPLER_SECRETS_MASTER_KEY_FILE` | `~/.paperclip/.../secrets/master.key` | Path to key file |
| `STAPLER_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `STAPLER_AGENT_ID` | Agent's unique ID |
| `STAPLER_COMPANY_ID` | Company ID |
| `STAPLER_API_URL` | Paperclip API base URL (inherits the server-level value; see Server Configuration above) |
| `STAPLER_API_KEY` | Short-lived JWT for API auth |
| `STAPLER_RUN_ID` | Current heartbeat run ID |
| `STAPLER_TASK_ID` | Issue that triggered this wake |
| `STAPLER_WAKE_REASON` | Wake trigger reason |
| `STAPLER_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `STAPLER_APPROVAL_ID` | Resolved approval ID |
| `STAPLER_APPROVAL_STATUS` | Approval decision |
| `STAPLER_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
