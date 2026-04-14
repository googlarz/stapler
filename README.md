<div align="center">
  <img src="docs/images/logo-dark.svg" alt="Stapler" height="48" />
  <br/>
  <br/>
  <p><strong>Stapler</strong> is a personal build of <a href="https://github.com/paperclipai/paperclip">paperclipai/paperclip</a> — kept in sync with upstream, with additional features bolted on.</p>
  <br/>
  <a href="https://github.com/googlarz/stapler/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <img src="https://img.shields.io/badge/built_on-paperclip-6366f1" alt="Built on Paperclip"/>
  <img src="https://img.shields.io/badge/stack-pnpm_·_drizzle_·_postgres-0f172a" alt="Stack"/>
</div>

---

## What's different from upstream

| Feature | Stapler | Upstream |
|---------|:-------:|:--------:|
| Per-agent memory store (save, search, list, delete) | ✅ | ❌ |
| Memory auto-injection at run-start | ✅ | ❌ |
| Company-wide shared memory store | ✅ | ❌ |
| Ollama adapter with agentic tool calling (15 tools) | ✅ | ❌ |
| Ollama model benchmark page | ✅ | ❌ |
| Onboarding wizard with mission-driven setup | ✅ | ❌ |
| COO agent auto-created for every new company | ✅ | ❌ |
| Goals with acceptance criteria + target dates | ✅ | ❌ |
| Goal progress bar (% of linked issues done) | ✅ | ❌ |
| Automatic goal verification loop | ✅ | ❌ |
| Editable goal parent, description, delete | ✅ | ❌ |
| Issue list query validation (400 on bad params) | ✅ | ❌ |
| Default model setting per company | ✅ | ❌ |
| Propose Tasks — AI-generated task suggestions per agent | ✅ | ❌ |
| Propose Tasks bulk-create (select multiple → create all) | ✅ | ❌ |
| Run cost display on completed runs | ✅ | ❌ |

---

## Features

### Agent Memory

Agents can save persistent notes during runs. Notes are keyword-searchable via `pg_trgm` and scoped per agent.

```bash
# Save a memory
curl -X POST "$PAPERCLIP_API_URL/api/agents/$PAPERCLIP_AGENT_ID/memories" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "user prefers French over English", "tags": ["preference", "language"]}'

# Search memories
curl "$PAPERCLIP_API_URL/api/agents/$PAPERCLIP_AGENT_ID/memories?q=french&limit=5" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

# List all memories (paginated)
curl "$PAPERCLIP_API_URL/api/agents/$PAPERCLIP_AGENT_ID/memories?limit=50&offset=0" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

**Auto-injection** — set `enableMemoryInjection: true` in agent config and the top-K relevant memories are prepended to every run context automatically. No tool call needed.

```json
{
  "enableMemoryInjection": true,
  "memoryInjectionLimit": 5
}
```

Adapters that benefit: **Claude**, **Ollama**. The search query is built from the current wake reason + issue title.

---

### Ollama Adapter

Run agents on a local [Ollama](https://ollama.com) instance. Full agentic loop with tool calling, conversation history, and streaming output.

Works with any model Ollama has installed that supports function calling — `llama3.1`, `qwen2.5`, `mistral`, etc.

Agents get 15 Paperclip tools out of the box:

| Tool | What it does |
|------|-------------|
| `paperclip_get_issue` | Fetch issue by ID |
| `paperclip_list_issues` | List issues with filters |
| `paperclip_create_issue` | Create a new issue |
| `paperclip_update_issue` | Update issue fields |
| `paperclip_post_comment` | Post a comment on an issue |
| `paperclip_list_agents` | List agents in the company |
| `paperclip_get_agent` | Fetch agent details |
| `paperclip_create_agent` | Hire a new agent |
| `paperclip_wake_agent` | Wake an agent on demand |
| `paperclip_save_memory` | Save a memory for self |
| `paperclip_search_memories` | Search own memories |
| `paperclip_delete_memory` | Delete a specific memory by ID |
| `paperclip_list_goals` | List company goals |
| `paperclip_create_goal` | Create a new goal |
| `paperclip_update_goal` | Update goal fields |

---

### Goal Verification Loop

When all issues linked to a goal reach `done`, the server automatically:

1. Creates a **verification issue** assigned to the goal's owner agent
2. Includes a snapshot of all linked issues (last 3 comments each, chronological) plus the goal's acceptance criteria
3. The agent judges each criterion and posts a structured result
4. On **pass** → goal flips to `achieved` with full audit trail
5. On **fail** → a fix issue is created and the loop retries on the next `done` event
6. Maximum 3 automatic attempts; manual retrigger always available

---

### Onboarding Wizard

Type your company mission in step 1 and the wizard:
- Recommends the best adapter for your setup
- Pre-fills the first task title and description
- Generates structured acceptance criteria tailored to your goal

---

### Propose Tasks

On any agent detail page, **Propose Tasks** generates 5 prioritised task suggestions using the agent's full context: company goals, open issues, other agents, and the agent's own memories.

The API call:

```bash
curl -X POST "$PAPERCLIP_API_URL/api/agents/$PAPERCLIP_AGENT_ID/propose-tasks" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Returns an array of proposals — each with a title, description, and priority. Each proposal has a **Create Issue** button in the UI to turn it into a real issue in one click.

Requires a local Ollama instance. Uses the company's **default model** (configurable in company settings) or falls back to the smallest available model.

---

### Default Model

Set a default Ollama model for your company in **Settings → Default Model**. Used by Propose Tasks and any agent that doesn't specify its own model.

---

### Ollama Benchmark

**Adapters → Benchmark Models** runs a fixed prompt against every selected Ollama model sequentially and measures tokens-per-second for each. Results are displayed in a sortable table with a "Fastest" badge on the winner — useful for picking the right model for latency-sensitive agents.

---

### Company Shared Memories

Alongside per-agent memories, any agent or board user can read and write **company-wide memories** — facts and context shared across the whole organisation.

```bash
# Save a shared memory
curl -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/memories" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "We ship on Fridays", "tags": ["process"]}'

# List shared memories (supports ?tags=tag1,tag2&limit=50&offset=0)
curl "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/memories" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

All writes are activity-logged with actor and run context for a full audit trail.

---

### COO Agent

Every company created via the wizard gets a **COO (Chief Operating Officer)** agent alongside the CEO. The COO is an independent operations auditor — it sits outside the production pipeline and intervenes at the process level only.

Each run the COO:

1. Reads its own memories for context
2. Takes a full snapshot — all agents, open issues, recent outputs
3. Computes four KPIs:

| KPI | Red threshold |
|-----|--------------|
| Idle rate (agents with no open issue) | >30% |
| Stale rate (in_progress, untouched >1 h) | >20% |
| Stage congestion (open issues per status bucket) | any bucket >5 |
| Unassigned backlog | >3 issues |

4. Takes **exactly one** corrective action — rewrite an agent's instructions, recommend an org change to the CEO, cancel a stale issue, or assign an unassigned issue
5. Stores a memory summarising what it found and what it did

The COO never creates domain/pipeline tasks — specialist agents self-direct.

---

### Goal Progress Bar

Each goal detail page shows a **progress bar** computed from linked issues: the percentage of `done` issues out of the total linked. Updates live as issues are closed.

---

### Run Cost

Completed Claude runs display their **token cost in USD** (input + output tokens × model pricing) directly on the run detail page — useful for tracking spend per agent and per task.

---

## Quickstart

```bash
git clone https://github.com/googlarz/stapler.git
cd stapler
pnpm install

# Copy env file and fill in your database URL + Anthropic/Ollama config
cp .env.example .env

# Run migrations and start
pnpm db:migrate
pnpm dev
```

The UI runs at `http://localhost:5173`. The API runs at `http://localhost:3000`.

> **First time?** Follow the upstream [setup guide](https://github.com/paperclipai/paperclip#quickstart) for Postgres and API key configuration — Stapler uses the same stack.

---

## Syncing with upstream

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream master
git rebase upstream/master
```

**Migration conflicts** are the most common issue. When they happen:

1. Rename colliding migration files (bump the `idx` in the filename)
2. Update `packages/db/src/migrations/meta/_journal.json` to reflect the new `idx` and `when` values
3. Keep both migrations — don't merge them

---

## Project structure

```
packages/
  adapters/ollama-local/   # Ollama adapter with tool calling
  adapters/claude-local/   # Claude adapter (upstream + memory injection)
  db/                      # Drizzle schema + migrations
  shared/                  # Shared types and validation schemas
server/                    # Express API server
  src/services/
    agent-memories.ts      # Memory store + injection helper
    goal-verification.ts   # Verification loop orchestration
ui/                        # React frontend
```

---

## License

MIT — same as upstream. See [LICENSE](./LICENSE).
