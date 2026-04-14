---
phase: 03-company-shared-memories
plan: 01
subsystem: database
tags: [postgres, drizzle, drizzle-orm, migrations, sha256, memory, company-memories]

# Dependency graph
requires:
  - phase: 01-ollama-tools-memory-injection
    provides: agent_memories table and agentMemoryService pattern used as template
provides:
  - company_memories PostgreSQL table with gin_trgm, unique-hash, and created_at indexes
  - companyMemories Drizzle schema exported from packages/db
  - companyMemoryService with save (dedup by SHA-256) and list (tag filter, pagination)
affects:
  - 03-02 (company memory routes — depends on this service and schema)
  - 03-03 (Ollama tool integration — calls companyMemoryService)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ON CONFLICT DO NOTHING + fallback SELECT for idempotent upsert (vs ON CONFLICT DO UPDATE used by agentMemoryService)
    - MemoryContentTooLargeError re-exported from agent-memories.ts to avoid duplication
    - normalizeTags lowercases tags in company service (agent service does not)

key-files:
  created:
    - packages/db/src/migrations/0061_company_memories.sql
    - packages/db/src/schema/company_memories.ts
    - server/src/services/company-memories.ts
  modified:
    - packages/db/src/migrations/meta/_journal.json
    - packages/db/src/schema/index.ts
    - server/src/services/index.ts

key-decisions:
  - "ON CONFLICT DO NOTHING (not DO UPDATE) for company memories — no updated_at bump on re-insert; simpler and avoids race with advisory lock"
  - "MemoryContentTooLargeError imported from agent-memories.ts rather than re-declared — single source of truth"
  - "normalizeTags lowercases company tags (company-wide scope makes lowercase normalization more important than per-agent)"

patterns-established:
  - "Company memory schema mirrors agent_memories but drops agentId FK and scope columns — cleaner company-scoped semantics"
  - "Service barrel (services/index.ts) is the single export surface — no direct imports from service files in routes"

requirements-completed:
  - MEMORY-02
  - MEMORY-03

# Metrics
duration: 15min
completed: 2026-04-13
---

# Phase 03 Plan 01: Company Shared Memories — Data Layer Summary

**company_memories table with Drizzle schema, gin_trgm search index, SHA-256 dedup, and companyMemoryService exposing save/list scoped to companyId**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-13T21:00:00Z
- **Completed:** 2026-04-13T21:15:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created 0061_company_memories.sql DDL with all required indexes (unique company+hash, gin_trgm for search, company+created_at for ordered listing)
- Added Drizzle pgTable definition and exported from schema barrel (packages/db/src/schema/index.ts)
- Implemented companyMemoryService with save (SHA-256 dedup, content-size enforcement, ON CONFLICT DO NOTHING) and list (tag AND-filter via JSONB @>, clamped pagination)

## Task Commits

1. **Task 1: DB migration and Drizzle schema for company_memories** - `2e3d6999` (feat)
2. **Task 2: Company memories service** - `bf3c1e92` (feat)

## Files Created/Modified

- `packages/db/src/migrations/0061_company_memories.sql` - DDL for company_memories table with indexes
- `packages/db/src/migrations/meta/_journal.json` - Added idx 61 entry
- `packages/db/src/schema/company_memories.ts` - Drizzle table definition, exports companyMemories
- `packages/db/src/schema/index.ts` - Added companyMemories re-export
- `server/src/services/company-memories.ts` - companyMemoryService factory with save/list
- `server/src/services/index.ts` - Added companyMemoryService export

## Decisions Made

- Used ON CONFLICT DO NOTHING (not DO UPDATE) for save — simpler, no need to bump updated_at on re-insert for company-scoped memories. Falls back to SELECT on conflict to return the existing row.
- Re-exported MemoryContentTooLargeError from agent-memories.ts rather than re-declaring it — avoids two separate error classes that would break `instanceof` checks.
- Tags are lowercased in normalizeTags for company service (agent service does not lowercase) — company-wide tags benefit from stricter normalization.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- company_memories table DDL is ready for `pg migrate` run
- Drizzle schema is exported and available to routes and tools via `@stapler/db`
- companyMemoryService is available in the services barrel for use by routes (plan 03-02) and the Ollama paperclip_remember_company tool (plan 03-03)

---
*Phase: 03-company-shared-memories*
*Completed: 2026-04-13*
