# Stapler

My personal build of [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Kept in sync with upstream, with a few extra features on top.

---

## Recent upstream changes (also in Stapler)

- **fix(logger):** redact cookies from server log
- **fix:** serialize Date to ISO string in comment cursor query
- **fix(plugins):** pass pluginDbId through tool registration; forward `issue.comment_added` events with full body
- **fix(process-adapter):** inject run ID and auth token as env defaults; preserve injected run env precedence

---

## What you actually get over upstream

- **Agents can save and search memories during runs.** Per-agent keyword-searchable notes backed by `pg_trgm`. HTTP API at `/agents/:agentId/memories` that every adapter can reach via `PAPERCLIP_API_KEY`. Four MCP tools for adapters that support MCP natively. A read-only "Memories" tab on the agent detail page.

- **Memories are automatically injected at run-start.** Set `enableMemoryInjection: true` in agent config and the server fetches the top-K relevant memories before calling `execute()` — no tool call needed. Works with both Claude and Ollama adapters.

- **Run agents on a local Ollama instance.** Full agentic loop with tool calling, conversation history, and streaming. Pick any model Ollama has installed.

- **Onboarding wizard suggests the best setup for your goal.** Type your company mission in step 1 and the wizard recommends an adapter, pre-fills the first task title, and generates a structured task description tailored to what you're trying to build.

- **Goals have acceptance criteria and target dates.** Editable criteria list per goal, progress bar driven by linked issues (cancelled excluded), with an inline editor that doesn't clobber keystrokes mid-edit.

- **Goals get automatically verified when their linked issues all reach `done`.** The server creates a verification issue assigned to the goal's owner agent, who judges each criterion and posts a structured result. On pass, the goal flips to `achieved` with a full audit trail. Max 3 attempts, manual retrigger as an escape hatch.

- **Goal properties are fully editable after creation.** Change the parent goal, clear the description, or delete a goal — all from the properties panel.

- **Query parameter validation on the issues list endpoint.** No more silent DB errors on `assigneeAgentId=undefined` — clean 400 with a structured error instead.

---

## Quickstart

Same as upstream. See the [Paperclip docs](https://github.com/paperclipai/paperclip#quickstart).

```bash
git clone https://github.com/googlarz/stapler.git
cd stapler
pnpm install
pnpm dev
```

Agent memory quickstart:

```bash
# Save a memory (as an authenticated agent)
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -X POST "$PAPERCLIP_API_URL/agents/$PAPERCLIP_AGENT_ID/memories" \
  -d '{"content":"user prefers French over English","tags":["preference","language"]}'

# Search memories in a later run
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/agents/$PAPERCLIP_AGENT_ID/memories?q=french&limit=5"
```

See `skills/paperclip/SKILL.md` for the full agent-facing API contract.

---

## Syncing with upstream

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream master
git rebase upstream/master
```

Migration conflicts (`packages/db/src/migrations/`) are the most common — rename any colliding migration files and bump the journal `idx`.

---

## License

MIT, same as upstream. See [LICENSE](./LICENSE).
