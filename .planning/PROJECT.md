# Stapler — Feature Milestone v2

## What This Is

Stapler is a personal fork of `paperclipai/paperclip` — an AI agent orchestration platform where agents execute tasks, write memories, manage goals, and collaborate through issues. This milestone adds 9 targeted features across Ollama tooling, memory, goals, streaming, and UI to make Stapler a more capable and polished standalone product before release to `googlarz/stapler`.

## Core Value

Agents running on Ollama should have the same first-class experience as Claude agents — same tools, same memory injection, same real-time feedback.

## Requirements

### Validated

- ✓ Per-agent memory store (save, search, list, delete via API) — existing
- ✓ Memory auto-injection at run-start for Claude adapter — existing
- ✓ Ollama adapter with agentic tool calling (12 tools) — existing
- ✓ Onboarding wizard with mission-driven setup — existing
- ✓ Goals with acceptance criteria + target dates — existing
- ✓ Automatic goal verification loop — existing
- ✓ Editable goal parent, description, delete — existing (fixed this session)
- ✓ Issue list query validation (400 on bad params) — existing
- ✓ Default model setting per company — existing
- ✓ Propose Tasks with Ollama model picker — existing (added this session)
- ✓ Upstream paperclip commits rebased (cookie redaction, date serialization, plugin dispatcher, process env injection) — existing (merged this session)

### Active

- [ ] **OLLAMA-01**: Ollama adapter exposes `paperclip_delete_memory` tool (agents can remove their own memories)
- [ ] **OLLAMA-02**: Ollama adapter exposes `paperclip_create_goal` tool (agents can create company goals)
- [ ] **OLLAMA-03**: Ollama adapter exposes `paperclip_update_goal` tool (agents can update goal status/description)
- [ ] **MEMORY-01**: Memory auto-injection works for Ollama adapter (top-K relevant memories in system prompt at wakeup)
- [ ] **AGENTS-01**: Default AGENTS.md template in server mentions all Stapler-specific tools (memory, goals) so new agents know what's available
- [ ] **STREAM-01**: Ollama adapter streams tokens to run output in real-time (no waiting for full response)
- [ ] **GOALS-01**: Goal detail page shows progress bar derived from linked issues (done/total ratio)
- [ ] **BUDGET-01**: Agent run list and detail shows estimated cost for Claude runs (based on token counts)
- [ ] **MEMORY-02**: Company-level shared memories API + UI (readable by all agents in company, writable by any agent)
- [ ] **PROPOSE-01**: Propose Tasks dialog allows selecting multiple proposals and creating all as issues in one action
- [ ] **BENCH-01**: Ollama model benchmarking page — compare installed models on speed and output quality with a sample prompt

### Out of Scope

- Gemini / OpenAI adapter enhancements — different adapter lifecycle, not our focus
- Multi-tenant SaaS features (billing, org management) — personal/team tool
- Mobile app — not in scope for this platform
- Codex/process adapter memory injection — subprocess CLI makes system prompt injection harder; can add later per-adapter
- Real-time cost for Ollama runs — Ollama is free/local, no billing signal available

## Context

- **Codebase**: TypeScript monorepo at `~/Claude Code/Dev/stapler`. pnpm workspaces. Express API (`server/`), React UI (`ui/`), Drizzle+Postgres DB (`packages/db/`), adapters (`packages/adapters/`).
- **Adapter pattern**: Each adapter (`claude-local`, `ollama-local`) implements `execute(opts)`. The heartbeat service calls `adapter.execute()` after workspace setup. Context is passed via `opts.context`.
- **Ollama tools**: Defined in `packages/adapters/ollama-local/src/server/tools.ts` — 12 tools currently. Each tool maps to a Paperclip API call.
- **Memory injection**: Claude adapter (`packages/adapters/claude-local/`) already reads `opts.context.agentMemoriesForInjection`. Ollama needs the same treatment. The heartbeat already runs `maybeLoadMemoriesForInjection()` before `execute()`.
- **Streaming**: Ollama API supports streaming via `stream: true`. Currently the adapter awaits the full response. The run output (SSE or WebSocket) needs to receive tokens incrementally.
- **Goals**: Server has full CRUD for goals. UI has `GoalDetail.tsx` and `GoalProperties.tsx`. Progress bar can be derived from `GET /api/companies/:id/issues?goalId=X`.
- **Budget**: Claude API returns `usage` with `input_tokens` + `output_tokens`. Pricing constants needed. Agent run records need to store token counts for display.
- **Shared memories**: Current memory schema is `agentId`-scoped. Company memories need a new table or nullable `agentId` with `companyId` scope.
- **Target**: Build → `pnpm typecheck` + `pnpm vitest run` → `/codex:review` → `/codex:adversarial-review` → push to `googlarz/stapler`.

## Constraints

- **Stack**: TypeScript only — no new languages or runtimes
- **DB**: Drizzle ORM + PostgreSQL — new features needing persistence require a migration
- **Compatibility**: Must not break existing Odysseia agents running against this server
- **Budget**: No new external services — everything runs locally or via Anthropic API
- **Testing**: `pnpm typecheck` must stay clean after every change; vitest must pass

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Inject memories at heartbeat level (server-side), not in each adapter | Centralized — works for all adapters, including ones we don't own | — Pending |
| Ollama streaming via SSE to existing run output endpoint | Reuse existing real-time infrastructure rather than adding WebSocket | — Pending |
| Company memories as separate table (not nullable agentId) | Cleaner schema semantics — avoids nullable FK ambiguity | — Pending |
| Release gated on codex review + adversarial review | Quality bar before public push to googlarz/stapler | — Pending |

---
*Last updated: 2026-04-13 after project initialization*
