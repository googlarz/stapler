---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `paperclipai run`

One-command bootstrap and start:

```sh
pnpm stapler run
```

Does:

1. Auto-onboards if config is missing
2. Runs `paperclipai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm stapler run --instance dev
```

## `paperclipai onboard`

Interactive first-time setup:

```sh
pnpm stapler onboard
```

If Paperclip is already configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm stapler onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm stapler onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Paperclip with that setup.

## `paperclipai doctor`

Health checks with optional auto-repair:

```sh
pnpm stapler doctor
pnpm stapler doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `paperclipai configure`

Update configuration sections:

```sh
pnpm stapler configure --section server
pnpm stapler configure --section secrets
pnpm stapler configure --section storage
```

## `paperclipai env`

Show resolved environment configuration:

```sh
pnpm stapler env
```

This now includes bind-oriented deployment settings such as `STAPLER_BIND` and `STAPLER_BIND_HOST` when configured.

## `paperclipai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm stapler allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Logs | `~/.paperclip/instances/default/logs` |
| Storage | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |

Override with:

```sh
STAPLER_HOME=/custom/home STAPLER_INSTANCE_ID=dev pnpm stapler run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm stapler run --data-dir ./tmp/paperclip-dev
pnpm stapler doctor --data-dir ./tmp/paperclip-dev
```
