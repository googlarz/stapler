---
phase: 03-company-shared-memories
plan: "03"
subsystem: api
tags: [ollama, tools, company-memories, typescript]

requires:
  - phase: 03-01
    provides: company_memories DB table, companyMemoryService, GET /api/companies/:companyId/memories endpoint

provides:
  - Ollama tool definition for paperclip_list_company_memories in STAPLER_TOOLS array
  - executePaperclipTool case that calls GET /api/companies/:companyId/memories with clamped limit

affects:
  - ollama-adapter execution
  - any plan that adds more company-memory tools (e.g. save/delete)

tech-stack:
  added: []
  patterns:
    - "Company-scoped tool pattern: fetch from /api/companies/:companyId/<resource> with clamped numeric limit"

key-files:
  created: []
  modified:
    - packages/adapters/ollama-local/src/server/tools.ts

key-decisions:
  - "limit clamped to 1-200 with default 50 (generous but bounded — consistent with list_issues pattern)"

patterns-established:
  - "List tool pattern: add definition to STAPLER_TOOLS, add matching case to executePaperclipTool switch"

requirements-completed:
  - MEMORY-03

duration: 5min
completed: 2026-04-13
---

# Phase 03 Plan 03: Company Shared Memories — Ollama Tool Summary

**Ollama `paperclip_list_company_memories` tool wired end-to-end: STAPLER_TOOLS definition + executePaperclipTool case calling GET /api/companies/:companyId/memories**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-13T21:20:00Z
- **Completed:** 2026-04-13T21:25:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `paperclip_list_company_memories` entry to STAPLER_TOOLS with clear LLM-facing description and optional `limit` parameter
- Added executor `case` in `executePaperclipTool` that clamps limit to 1–200 (default 50) and GETs `/api/companies/:companyId/memories`
- TypeScript compiles cleanly with no errors

## Task Commits

1. **Task 1: Add paperclip_list_company_memories tool definition and executor** - `c489efbb` (feat)

**Plan metadata:** _(docs commit below)_

## Files Created/Modified

- `packages/adapters/ollama-local/src/server/tools.ts` — added tool definition and switch case (27 lines added)

## Decisions Made

- Clamped limit to 1–200 range (matching plan spec); default 50 (matches plan, more generous than list_issues default of 20 since memories are lightweight)
- Followed actual `paperclipFetch(url, options)` signature in the file rather than the plan's pseudocode signature — no deviation in intent, just aligned to real API

## Deviations from Plan

None — plan executed exactly as written. The `paperclipFetch` call signature in the plan was illustrative pseudocode; actual implementation matched the real function signature already present in the file.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `paperclip_list_company_memories` is now available to all Ollama agents
- A future plan could add `paperclip_save_company_memory` and `paperclip_delete_company_memory` to complete the CRUD surface

---
*Phase: 03-company-shared-memories*
*Completed: 2026-04-13*
