---
phase: 03-company-shared-memories
plan: "02"
subsystem: api
tags: [express, typescript, rest-api, authorization]

requires:
  - phase: 03-01
    provides: companyMemoryService with save and list operations, MemoryContentTooLargeError

provides:
  - "POST /api/companies/:companyId/memories — create a shared company memory"
  - "GET /api/companies/:companyId/memories — list shared company memories with tag/pagination filters"
  - "companyMemoryRoutes exported from routes barrel (index.ts)"

affects:
  - 03-03
  - any HTTP client or Ollama tool calling company memory endpoints

tech-stack:
  added: []
  patterns:
    - "Route function factory: companyMemoryRoutes(db) returns Express Router"
    - "assertCompanyAccess guard applied before any service call"
    - "Manual query param validation with integer range checks (no zod schema for query)"

key-files:
  created:
    - server/src/routes/company-memories.ts
  modified:
    - server/src/routes/index.ts
    - server/src/app.ts

key-decisions:
  - "Manual query-param validation used instead of zod schema — matches simplicity of route, avoids schema file overhead"
  - "POST returns 201 with the saved memory object directly (not wrapped in deduped flag like agent-memories)"
  - "createdByAgentId extracted from actor.agentId (undefined for board callers)"

patterns-established:
  - "Company route scoping: /companies/:companyId/* with assertCompanyAccess as first guard"
  - "413 on MemoryContentTooLargeError, 400 on invalid query/body, 201 on successful create"

requirements-completed:
  - MEMORY-02

duration: 8min
completed: "2026-04-13"
---

# Phase 03 Plan 02: Company Memory Routes Summary

**Express REST endpoints for company-scoped shared memories — GET and POST under `/api/companies/:companyId/memories` with company-level authorization**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-13T21:20:00Z
- **Completed:** 2026-04-13T21:28:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `server/src/routes/company-memories.ts` exposing GET and POST handlers with authz, query validation, and error handling
- Wired `companyMemoryRoutes` into the Express `api` router in `app.ts` alongside `agentMemoryRoutes`
- Re-exported `companyMemoryRoutes` from the routes barrel (`routes/index.ts`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Company memory routes** - `2367e657` (feat)
2. **Task 2: Wire routes into Express app** - `4f4a1eef` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `server/src/routes/company-memories.ts` — GET and POST handlers for `/companies/:companyId/memories`
- `server/src/routes/index.ts` — Added `companyMemoryRoutes` re-export
- `server/src/app.ts` — Imported and mounted `companyMemoryRoutes(db)` in API router

## Decisions Made

- Manual query-param validation (not zod schema) — keeps route self-contained, integer range checks explicit
- POST returns the memory object at 201 (no `deduped` wrapper) — company memories use ON CONFLICT DO NOTHING so dedup is transparent
- `createdByAgentId` sourced from `actor.agentId` (undefined for board callers, string for agent key callers)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `plugins.ts` and `plugin-sdk` imports (missing package, unrelated to this plan). Confirmed zero errors in new/modified files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both REST endpoints are live and protected by `assertCompanyAccess`
- 03-03 (Ollama tool integration) can now call `POST /api/companies/:companyId/memories` and `GET /api/companies/:companyId/memories`

---
*Phase: 03-company-shared-memories*
*Completed: 2026-04-13*
