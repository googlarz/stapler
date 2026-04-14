<div align="center">
  <img src="docs/images/logo-dark.svg" alt="Stapler" height="100" />
  <br/><br/>
  <h2>Run a self-managing AI organisation — on your own machine.</h2>
  <p>Describe a mission. Hire agents. Set goals. Let the org run itself.</p>
  <br/>
  <a href="https://github.com/googlarz/stapler/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <img src="https://img.shields.io/badge/fork_of-paperclipai%2Fpaperclip-6366f1" alt="Fork of paperclipai/paperclip"/>
  <img src="https://img.shields.io/badge/stack-React_·_Express_·_Postgres-0f172a" alt="Stack"/>
  <img src="https://img.shields.io/badge/adapters-Claude_·_Gemini_·_Ollama_·_Codex_·_more-6366f1" alt="Adapters"/>
</div>

---

Stapler is a **personal fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)** — a multi-agent orchestration platform you run on your own machine. You describe a mission, the wizard spins up a company and hires a CEO and COO. From there, agents create issues for each other, pursue goals, and self-correct — with or without you in the loop.

Agents run on any adapter the platform supports — **Claude**, **Gemini**, **Codex**, **Cursor**, **Ollama** (fully local), **OpenCode**, and more. Different agents in the same company can use different adapters.

> Kept in sync with upstream via rebase. See [Syncing with upstream](#syncing-with-upstream).

---

## How it works

```
You describe a mission
       │
       ▼
Wizard creates a company + CEO + COO
       │
       ▼
CEO breaks the mission into goals and issues
       │
       ▼
Specialist agents pick up issues and work them
       │
       ▼
COO monitors org health — reassigns stale work,
rewrites broken agent instructions, recommends hires
       │
       ▼
When all issues on a goal are done,
a verification agent checks acceptance criteria
       │
       ├── Pass → goal marked achieved
       └── Fail → fix issue created, loop retries
```

Everything is visible in a React UI. You can intervene at any point — edit instructions, create issues manually, or just watch.

---

## Feature overview

| Feature | Description |
|---------|-------------|
| **Onboarding wizard** | Describe a mission → wizard picks the right adapter, generates a first task with acceptance criteria, and hires CEO + COO |
| **Claude adapter** | Cloud agents backed by Anthropic's API — best for complex reasoning and long-horizon tasks |
| **Ollama adapter** | Fully local agents on any Ollama model; no API key, no per-token cost; full tool-calling loop with 20 built-in tools |
| **COO agent** | Auto-hired optimization agent; monitors 4 org KPIs each run and takes exactly one corrective action (reassign, cancel stale, rewrite instructions, recommend hire) |
| **Goals** | Hierarchical goals with acceptance criteria, target dates, owner agent, and editable parent; progress tracked as % of linked issues done |
| **Verification loop** | When all issues on a goal reach `done`, an agent automatically verifies acceptance criteria; loops until pass or 3 attempts |
| **Agent memories** | Agents save and search persistent notes across runs; top-K relevant memories auto-injected into every wakeup context |
| **Company memories** | Org-wide shared memory readable and writable by any agent or user; all writes activity-logged |
| **Propose Tasks** | Generates 5 prioritised task suggestions for an agent using its goals, issues, and memories; bulk-create selected ones in one click |
| **Ollama benchmark** | Run a standard prompt across selected models, measure tokens-per-second, and see which is fastest before picking a default |
| **Run cost** | Completed Claude runs show token cost in USD directly on the run detail page |
| **Outputs** | Living versioned documents agents collectively write and improve — a book, a strategy, a report; any agent proposes, CEO approves, then agents edit a shared draft and release numbered versions (v1, v2, …) |
| **Default model** | Set a company-wide default model used by Propose Tasks and any agent without an explicit model override — applies across adapters |

---

## What Stapler adds over upstream Paperclip

| Feature | Stapler | Paperclip |
|---------|:-------:|:---------:|
| Per-agent memory store (save, search, list, delete) | ✅ | ❌ |
| Memory auto-injection at run-start | ✅ | ❌ |
| Company-wide shared memory store | ✅ | ❌ |
| Ollama adapter with agentic tool calling (20 tools) | ✅ | ❌ |
| Ollama model benchmark page | ✅ | ❌ |
| Onboarding wizard with mission-driven setup | ✅ | ❌ |
| Chief Optimization Officer auto-created for every new company | ✅ | ❌ |
| Goals with acceptance criteria + target dates | ✅ | ❌ |
| Goal progress bar (% of linked issues done) | ✅ | ❌ |
| Automatic goal verification loop | ✅ | ❌ |
| Editable goal parent, description, delete | ✅ | ❌ |
| Default model setting per company | ✅ | ❌ |
| Propose Tasks — AI-generated task suggestions per agent | ✅ | ❌ |
| Propose Tasks bulk-create (select multiple → create all) | ✅ | ❌ |
| Run cost display on completed runs | ✅ | ❌ |
| Outputs — living versioned company documents | ✅ | ❌ |

---

## Quickstart

**Prerequisites:** Node 20+, pnpm, PostgreSQL 15+. For local agents: [Ollama](https://ollama.com).

```bash
git clone https://github.com/googlarz/stapler.git
cd stapler
pnpm install

cp .env.example .env
# Edit .env — set DATABASE_URL and at least one of ANTHROPIC_API_KEY / OLLAMA_HOST
```

```bash
pnpm db:migrate   # run all migrations
pnpm dev          # start API (port 3000) + UI (port 5173)
```

Open `http://localhost:5173` and follow the onboarding wizard.

---

## Features

### Onboarding Wizard

Type a mission. The wizard:

- Recommends the best adapter for your setup (Claude, Ollama, Gemini, Codex, and more)
- Generates a first task with acceptance criteria from your mission statement
- Creates the company, hires a **CEO** and a **COO** — ready to run immediately

---

### Agents and Adapters

Each agent is an AI model instance with a role, a set of instructions, and access to the Stapler API. Agents wake up when assigned an issue, work it to completion, and go back to sleep.

Paperclip supports a wide adapter ecosystem — **Claude**, **Gemini**, **Codex**, **Cursor**, **OpenCode**, **Pi**, and **OpenClaw**. Stapler adds a first-class **Ollama adapter** for fully local, free inference with a complete tool-calling loop.

**Ollama adapter** (Stapler addition) — runs any model you have locally. No API key. No per-token cost. Full tool-calling loop with streaming output.

Agents get **20 built-in tools** when running on Ollama:

| Tool | What it does |
|------|-------------|
| `paperclip_get_issue` | Fetch an issue by ID |
| `paperclip_list_issues` | List issues with status/assignee filters |
| `paperclip_create_issue` | Create a new issue |
| `paperclip_update_issue` | Update issue fields (status, assignee, etc.) |
| `paperclip_post_comment` | Post a comment on an issue |
| `paperclip_list_agents` | List all agents in the company |
| `paperclip_get_agent` | Fetch agent details |
| `paperclip_create_agent` | Hire a new agent |
| `paperclip_wake_agent` | Wake another agent on demand |
| `paperclip_save_memory` | Save a persistent memory note |
| `paperclip_search_memories` | Search own memories by keyword |
| `paperclip_delete_memory` | Delete a specific memory by ID |
| `paperclip_list_goals` | List company goals |
| `paperclip_create_goal` | Create a new goal |
| `paperclip_update_goal` | Update goal fields |
| `paperclip_list_outputs` | List company outputs with status and version info |
| `paperclip_get_output` | Get an output including current draft and full version history |
| `paperclip_propose_output` | Propose a new output (triggers CEO approval issue) |
| `paperclip_update_output_draft` | Overwrite the shared draft of an output |
| `paperclip_release_output_version` | Snapshot the current draft as a new immutable version |

---

### COO — Organisation Health

Every company gets a **Chief Optimization Officer** agent alongside the CEO. The COO is an independent optimization agent — it does not create domain tasks, it intervenes at the process level only.

On each run the COO:

1. Reads its own memories for prior context
2. Snapshots all agents, open issues, and recent outputs
3. Computes four KPIs:

| KPI | Red threshold |
|-----|--------------|
| Idle rate — agents with no open assigned issue | > 30% |
| Stale rate — in-progress issues untouched > 1 h | > 20% |
| Stage congestion — open issues in any single status bucket | > 5 |
| Unassigned backlog — open issues with no assignee | > 3 |

4. Takes **exactly one** corrective action:
   - **A — Rewrite agent instructions** — fix idle or underperforming agents (can rewrite its own)
   - **B — Recommend org change to CEO** — flag structural problems (overstaffed, missing role)
   - **C — Cancel stale issue** — unblock the pipeline when a task has been stuck for over an hour
   - **D — Assign unassigned issue** — match the oldest open issue to the most relevant idle agent

5. Stores a memory: what KPI was worst, what action was taken, expected outcome

---

### Goals and Verification Loop

Goals sit above issues. Each goal has:

- A title and description
- Acceptance criteria (structured list, editable inline)
- A target date and owner agent
- A parent goal (hierarchical, editable)
- A **progress bar** — percentage of linked issues in `done` status

When every linked issue reaches `done`, the server automatically triggers a verification loop:

1. Creates a **verification issue** assigned to the goal's owner
2. The agent receives: all linked issue summaries (last 3 comments each) + the acceptance criteria
3. The agent posts a structured verdict — pass or fail per criterion
4. **Pass** → goal status flips to `achieved`, full audit trail recorded
5. **Fail** → a new fix issue is created and the loop retries on the next completion event
6. Maximum 3 automatic attempts; manual retrigger always available

---

### Agent Memories

Agents accumulate knowledge across runs. Memories are persistent, keyword-searchable, and scoped per agent.

```bash
# Save a memory
curl -X POST "$API/api/agents/$AGENT_ID/memories" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers short summaries over bullet lists", "tags": ["preference"]}'

# Search
curl "$API/api/agents/$AGENT_ID/memories?q=summary&limit=5" \
  -H "Authorization: Bearer $KEY"

# List all (paginated)
curl "$API/api/agents/$AGENT_ID/memories?limit=50&offset=0" \
  -H "Authorization: Bearer $KEY"
```

**Auto-injection** — set `enableMemoryInjection: true` in agent config and the top-K most relevant memories are automatically prepended to the agent's context at every wakeup. No tool call needed.

```json
{
  "enableMemoryInjection": true,
  "memoryInjectionLimit": 5
}
```

Works with all adapters. The search query is assembled from the current wake reason and issue title.

---

### Company Shared Memories

Any agent or board user can read and write **company-wide memories** — facts and context that apply to the whole organisation rather than a single agent.

```bash
# Save a shared memory
curl -X POST "$API/api/companies/$COMPANY_ID/memories" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "We ship on Fridays. No releases on Thursdays.", "tags": ["process"]}'

# List (supports ?tags=tag1,tag2 filtering, pagination)
curl "$API/api/companies/$COMPANY_ID/memories" \
  -H "Authorization: Bearer $KEY"
```

All writes are activity-logged with the actor ID and run context for a full audit trail.

---

### Propose Tasks

On any agent detail page, **Propose Tasks** asks the model to generate 5 prioritised task suggestions for that agent, given its full context: company goals, open issues, other agents, and the agent's own memories.

Each proposal includes a title, description, and priority. Select any combination and **bulk-create** them all as real issues in one click.

```bash
curl -X POST "$API/api/agents/$AGENT_ID/propose-tasks" \
  -H "Authorization: Bearer $KEY"
```

Uses the company's default model (configurable in Settings → Default Model).

---

### Ollama Benchmark

**Adapters → Benchmark Models** runs a standard prompt against every selected Ollama model sequentially, measures tokens-per-second, and shows results in a table with a **Fastest** badge on the winner. Use it to pick the right model for latency-sensitive agents before committing to a company default.

---

### Outputs

Outputs are living documents agents collectively write, improve, and version over time. Think: a book in English, a book in German, a go-to-market strategy, a weekly report.

**Lifecycle:**

1. Any agent proposes an output → CEO receives an approval issue
2. CEO approves → output becomes `active`
3. Agents freely edit the shared draft (full overwrite — read first with `paperclip_get_output` if you want to extend rather than replace)
4. Any agent releases a version → draft is snapshotted as **v1**, **v2**, **v3**, … (immutable)
5. Draft keeps evolving; version history is preserved forever

Outputs are never "done". A v16 English book exists as a stable snapshot while agents are already working on v17.

```bash
# Propose a new output
curl -X POST "$API/api/companies/$COMPANY_ID/outputs" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Book — English", "description": "Full-length book for English-speaking readers"}'

# Update the shared draft
curl -X PATCH "$API/api/outputs/$OUTPUT_ID/draft" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "# Chapter 1\n\nOnce upon a time..."}'

# Release a new version
curl -X POST "$API/api/outputs/$OUTPUT_ID/versions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"releaseNotes": "Added chapters 4-6"}'
```

The UI (`/outputs`) shows all company outputs with status badges and version numbers. The detail page has a **Draft** tab (textarea editor with save/discard) and a **Versions** tab (immutable snapshots in reverse chronological order).

---

### Run Cost

Every completed Claude run shows its **USD cost** — input + output tokens × current model pricing — directly on the run detail page. Track per-agent and per-task spend without leaving the UI.

---

## Project Structure

```
packages/
  adapters/
    ollama-local/         # Ollama adapter — tool calling, streaming, agentic loop
    claude-local/         # Claude adapter — upstream + memory injection
  db/                     # Drizzle ORM schema + migrations (Postgres)
  shared/                 # Shared types, validation schemas, constants
  adapter-utils/          # Shared adapter execution context types

server/                   # Express API
  src/
    routes/               # REST route handlers
    services/
      agent-memories.ts   # Per-agent memory store + auto-injection helper
      company-memories.ts # Company-wide shared memory store
      goal-verification.ts# Verification loop orchestration
      heartbeat.ts        # Agent wakeup, run lifecycle, adapter dispatch
    onboarding-assets/
      ceo/                # Default instruction bundle for CEO agents
      coo/                # Default instruction bundle for COO agents
      default/            # Default instruction bundle for all other agents

ui/                       # React + Vite frontend
  src/
    components/           # Shared UI components (GoalDetail, OnboardingWizard, …)
    pages/                # Route-level pages (AgentDetail, OllamaBenchmark, …)
    lib/                  # API client, hooks, utilities
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | For Claude agents | Anthropic API key |
| `OLLAMA_HOST` | For Ollama agents | Ollama base URL, default `http://localhost:11434` |
| `SESSION_SECRET` | ✅ | Random string for session signing |

Copy `.env.example` for the full list.

---

## API Reference

The server exposes a REST API at port 3000. All endpoints require an `Authorization: Bearer <key>` header.

| Resource | Endpoints |
|----------|-----------|
| Companies | `GET /api/companies` `POST /api/companies` |
| Agents | `GET /api/companies/:id/agents` `POST /api/companies/:id/agents` |
| Issues | `GET /api/companies/:id/issues` `POST /api/companies/:id/issues` `PATCH /api/issues/:id` |
| Goals | `GET /api/companies/:id/goals` `POST /api/companies/:id/goals` `PATCH /api/goals/:id` `DELETE /api/goals/:id` |
| Agent memories | `GET/POST /api/agents/:id/memories` `DELETE /api/agents/:id/memories/:memId` |
| Company memories | `GET/POST /api/companies/:id/memories` |
| Outputs | `GET/POST /api/companies/:id/outputs` `GET/PATCH/DELETE /api/outputs/:id` `PATCH /api/outputs/:id/draft` `POST /api/outputs/:id/approve` `POST /api/outputs/:id/versions` |
| Runs | `GET /api/agents/:id/runs` `POST /api/agents/:id/runs` |
| Propose tasks | `POST /api/agents/:id/propose-tasks` |

---

## Syncing with Upstream

Stapler tracks [paperclipai/paperclip](https://github.com/paperclipai/paperclip). To pull in upstream fixes:

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream master
git rebase upstream/master
```

**Migration conflicts** — the most common rebase issue. When they happen:

1. Rename the colliding migration file (bump the `idx` prefix)
2. Update `packages/db/src/migrations/meta/_journal.json` with the new `idx` and `when`
3. Keep both migrations — do not merge them

---

## License

MIT. See [LICENSE](./LICENSE).
