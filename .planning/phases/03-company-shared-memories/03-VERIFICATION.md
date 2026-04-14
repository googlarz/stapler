---
phase: 03-company-shared-memories
verified: 2026-04-13T00:00:00Z
status: passed
score: 4/4 success criteria verified
---

# Phase 3: Company Shared Memories Verification Report

**Phase Goal:** Any agent in a company can read and write company-level memories that persist independently of any single agent
**Verified:** 2026-04-13
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/companies/:id/memories creates a shared memory accessible by all agents | VERIFIED | `server/src/routes/company-memories.ts` line 55: `router.post("/companies/:companyId/memories", ...)` calls `svc.save(...)` which inserts into `company_memories` table scoped to `companyId` only, not agent |
| 2 | GET /api/companies/:id/memories returns all company-level memories (distinct from agent memories) | VERIFIED | `server/src/routes/company-memories.ts` line 15: `router.get("/companies/:companyId/memories", ...)` calls `svc.list({ companyId, ... })` which queries `company_memories` table, fully separate from `agent_memories` |
| 3 | An Ollama agent can call `paperclip_list_company_memories` and receive the current shared memories list | VERIFIED | Tool defined in `STAPLER_TOOLS` array (line 350-367 of tools.ts); executed at line 619-625 via GET to `/api/companies/:companyId/memories?limit=N`; result is returned directly to the model |
| 4 | A memory written by agent A is returned when agent B queries company memories in the same company | VERIFIED | Service scopes exclusively on `companyId` (no agent filter on reads); `save` stores `createdByAgentId` for attribution only — all agents in same company share the same pool |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/db/src/migrations/0061_company_memories.sql` | VERIFIED | Table `company_memories` with `company_id` FK, `content`, `content_hash`, `created_by_agent_id` (nullable), indexes on `(company_id, created_at)` and unique `(company_id, content_hash)` |
| `packages/db/src/schema/company_memories.ts` | VERIFIED | Full Drizzle schema matching migration; exported from `packages/db/src/schema/index.ts` |
| `server/src/services/company-memories.ts` | VERIFIED | `save` (dedup via sha256 + ON CONFLICT DO NOTHING) and `list` (tag filter + pagination) fully implemented, 172 lines of substantive logic |
| `server/src/routes/company-memories.ts` | VERIFIED | GET and POST handlers with input validation, auth check via `assertCompanyAccess`, error handling for `MemoryContentTooLargeError` |
| `server/src/app.ts` | VERIFIED | `companyMemoryRoutes(db)` imported at line 17 and mounted at line 166 |
| `packages/adapters/ollama-local/src/server/tools.ts` | VERIFIED | `paperclip_list_company_memories` tool in `STAPLER_TOOLS` array and handled in `executePaperclipTool` switch at line 619-625 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `companyMemoryRoutes` | `app.ts` | `api.use(companyMemoryRoutes(db))` | WIRED | Line 166 of app.ts |
| `companyMemoryService` | `routes/company-memories.ts` | imported from `services/index.js` | WIRED | Line 3 and 13 of route file |
| `companyMemories` schema | `services/company-memories.ts` | imported from `@stapler/db` | WIRED | Line 18 of service file |
| `paperclip_list_company_memories` tool | `executePaperclipTool` | switch case at line 619 | WIRED | Calls GET `/api/companies/:companyId/memories` |
| `companyMemories` | `db/schema/index.ts` | `export { companyMemories }` | WIRED | Line 8 of schema index |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| MEMORY-02 | Company-scoped shared memories API | SATISFIED | POST + GET routes on `/companies/:companyId/memories` backed by dedicated `company_memories` table |
| MEMORY-03 | Ollama agent can access company memories via tool | SATISFIED | `paperclip_list_company_memories` tool defined and wired to company memories API endpoint |

### Anti-Patterns Found

None. No TODOs, placeholders, stub returns, or empty handlers found in phase files.

### Human Verification Required

None required for automated checks. The following is advisory:

1. **Cross-agent visibility at runtime** — Start two Ollama agents in the same company; have agent A POST a memory and have agent B call `paperclip_list_company_memories`. Confirm the memory appears. This validates the dedup logic and shared pool behavior at the network level.

### Gaps Summary

No gaps. All four success criteria are fully implemented and wired end-to-end. The company memories feature is completely distinct from agent memories (separate table, separate service, separate routes), memories are scoped by `companyId` only, and the Ollama tool correctly calls the company endpoint using the agent's `companyId` context variable.

---

_Verified: 2026-04-13_
_Verifier: Claude (gsd-verifier)_
