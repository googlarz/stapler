# Requirements: Stapler Feature Milestone v2

**Defined:** 2026-04-13
**Core Value:** Agents running on Ollama should have the same first-class experience as Claude agents — same tools, same memory injection, same real-time feedback.

## v1 Requirements

### Ollama Tools

- [ ] **OLLAMA-01**: Ollama agent can call `paperclip_delete_memory` to remove one of its own memories by ID
- [ ] **OLLAMA-02**: Ollama agent can call `paperclip_create_goal` to create a new company goal with title, description, and acceptance criteria
- [ ] **OLLAMA-03**: Ollama agent can call `paperclip_update_goal` to update a goal's status, description, or acceptance criteria by ID

### Memory

- [ ] **MEMORY-01**: Ollama adapter reads `context.agentMemoriesForInjection` and prepends a `## Relevant memories` section to its system prompt (matching existing Claude adapter behavior)
- [ ] **MEMORY-02**: Company-level shared memory API exists (`POST/GET /api/companies/:id/memories`) — memories readable by all agents in a company, writable by any agent
- [ ] **MEMORY-03**: Ollama adapter exposes `paperclip_list_company_memories` tool to query shared company memories

### Streaming

- [ ] **STREAM-01**: Ollama adapter streams tokens to run output in real-time (Ollama `stream: true`) — output appears progressively, not all-at-once after completion

### Goals UI

- [ ] **GOALS-01**: Goal detail page shows a progress bar derived from linked issues (count of done issues / total linked issues)

### Budget

- [ ] **BUDGET-01**: Agent run list and run detail shows estimated USD cost for Claude runs, calculated from stored input/output token counts using Anthropic pricing constants

### Agent Templates

- [ ] **AGENTS-01**: Default AGENTS.md template generated for new agents includes documentation of all Stapler-specific tools: memory tools, goal tools, and any tools beyond the upstream paperclip baseline

### Propose Tasks

- [ ] **PROPOSE-01**: Propose Tasks dialog allows selecting multiple proposals via checkboxes and creating all selected proposals as issues in a single action

### Benchmarking

- [ ] **BENCH-01**: A benchmarking page (or modal) allows comparing installed Ollama models by running a fixed sample prompt against each and displaying response time and output for comparison

## v2 Requirements

### Memory

- **MEMORY-V2-01**: Memory auto-injection for Codex/process/http adapters (harder due to subprocess CLI)
- **MEMORY-V2-02**: Memory expiry / TTL — memories auto-expire after configurable days

### Budget

- **BUDGET-V2-01**: Budget alerts — notify (in-app or email) when company Claude spend exceeds threshold
- **BUDGET-V2-02**: Per-agent budget caps — agent runs blocked if projected cost exceeds limit

### Benchmarking

- **BENCH-V2-01**: Save benchmark results to DB for historical comparison
- **BENCH-V2-02**: Auto-select "best" model for a task type based on prior benchmark data

## Out of Scope

| Feature | Reason |
|---------|--------|
| Gemini / OpenAI adapter enhancements | Different adapter lifecycle; not used in our setup |
| Multi-tenant SaaS (billing, orgs) | Personal/team tool — not a hosted product |
| Mobile app | Web-first platform; mobile deferred indefinitely |
| Real-time cost for Ollama | Ollama is free/local — no billing signal available |
| Codex adapter memory injection | Subprocess CLI makes system prompt injection non-trivial; defer per-adapter |
| WebSocket-based streaming | Reuse existing SSE infrastructure instead |

## Traceability

*Populated by roadmapper agent.*

| Requirement | Phase | Status |
|-------------|-------|--------|
| OLLAMA-01 | — | Pending |
| OLLAMA-02 | — | Pending |
| OLLAMA-03 | — | Pending |
| MEMORY-01 | — | Pending |
| MEMORY-02 | — | Pending |
| MEMORY-03 | — | Pending |
| STREAM-01 | — | Pending |
| GOALS-01 | — | Pending |
| BUDGET-01 | — | Pending |
| AGENTS-01 | — | Pending |
| PROPOSE-01 | — | Pending |
| BENCH-01 | — | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 12 ⚠️

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 after initial definition*
