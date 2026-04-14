---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm stapler issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm stapler issue get <issue-id-or-identifier>

# Create issue
pnpm stapler issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm stapler issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm stapler issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm stapler issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm stapler issue release <issue-id>
```

## Company Commands

```sh
pnpm stapler company list
pnpm stapler company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm stapler company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm stapler company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm stapler company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm stapler agent list
pnpm stapler agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm stapler approval list [--status pending]

# Get approval
pnpm stapler approval get <approval-id>

# Create approval
pnpm stapler approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm stapler approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm stapler approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm stapler approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm stapler approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm stapler approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm stapler activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm stapler dashboard get
```

## Heartbeat

```sh
pnpm stapler heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
