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
| Ollama adapter with agentic tool calling | ✅ | ❌ |
| Onboarding wizard with mission-driven setup | ✅ | ❌ |
| Goals with acceptance criteria + target dates | ✅ | ❌ |
| Automatic goal verification loop | ✅ | ❌ |
| Editable goal parent, description, delete | ✅ | ❌ |
| Issue list query validation (400 on bad params) | ✅ | ❌ |

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

Agents get 12 Paperclip tools out of the box:

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
| `paperclip_list_goals` | List company goals |

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
