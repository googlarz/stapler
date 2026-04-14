---
phase: 01-ollama-tools-memory-injection
plan: 01
subsystem: api
tags: [ollama, tools, memory, goals, typescript]

# Dependency graph
requires: []
provides:
  - paperclip_delete_memory tool (schema + DELETE /api/agents/:id/memories/:memId handler)
  - paperclip_create_goal tool (schema + POST /api/companies/:id/goals handler)
  - paperclip_update_goal tool (schema + PATCH /api/companies/:id/goals/:goalId handler)
  - MEMORY-01 confirmed: agentMemoriesForInjection already wired in execute.ts
affects: [02-ollama-streaming, 03-company-shared-memories]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tool parity: Ollama adapter mirrors Claude adapter tool surface via STAPLER_TOOLS array + executePaperclipTool switch"

key-files:
  created: []
  modified:
    - packages/adapters/ollama-local/src/server/tools.ts

key-decisions:
  - "MEMORY-01 (agentMemoriesForInjection injection in execute.ts) was already implemented — no changes required to execute.ts"
  - "paperclip_update_goal uses partial PATCH pattern: only fields present in args are included in updates body"

patterns-established:
  - "New Ollama tools follow two-step pattern: add OllamaTool schema to STAPLER_TOOLS array, then add case branch to executePaperclipTool switch"

requirements-completed: [OLLAMA-01, OLLAMA-02, OLLAMA-03, MEMORY-01]

# Metrics
duration: 10min
completed: 2026-04-13
---

# Phase 1 Plan 01: Ollama Tools + Memory Injection Summary

**Three missing Ollama tool definitions added (delete_memory, create_goal, update_goal) bringing STAPLER_TOOLS to 15 entries with full memory and goal management parity with Claude adapter**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-13T00:00:00Z
- **Completed:** 2026-04-13T00:10:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `paperclip_delete_memory` tool — DELETE /api/agents/:agentId/memories/:memoryId
- Added `paperclip_create_goal` tool — POST /api/companies/:companyId/goals (title required, description + acceptanceCriteria optional)
- Added `paperclip_update_goal` tool — PATCH /api/companies/:companyId/goals/:goalId (partial updates, status enum enforced)
- Confirmed MEMORY-01 already complete: `agentMemoriesForInjection` injection block in execute.ts (lines ~180-187) present and unmodified
- TypeScript build passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add paperclip_delete_memory, paperclip_create_goal, paperclip_update_goal tools** - `63775f08` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `packages/adapters/ollama-local/src/server/tools.ts` - Added 3 tool schemas to STAPLER_TOOLS (now 15 total) and 3 handler cases to executePaperclipTool switch

## Decisions Made
- MEMORY-01 was already implemented in execute.ts — confirmed present and left unmodified, no separate task needed
- paperclip_update_goal uses partial update pattern: only args fields present in the call are included in the PATCH body

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Package name in pnpm filter required correction: `@stapler/adapter-ollama-local` (not `@stapler/ollama-local`). Build succeeded immediately after using the correct name.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Ollama tool surface now matches Claude adapter for memory and goal management
- MEMORY-01 confirmed complete — memory injection requires no further work
- Ready for Phase 1 Plan 02 (streaming / next planned work)

---
*Phase: 01-ollama-tools-memory-injection*
*Completed: 2026-04-13*
