---
phase: 05-agent-template-propose-bulk
plan: "01"
subsystem: api
tags: [agents, onboarding, documentation, tools]

requires: []
provides:
  - Default AGENTS.md template with all 8 Stapler tools documented (names, descriptions, params)
affects: [agent-creation, onboarding]

tech-stack:
  added: []
  patterns:
    - "Tool documentation in AGENTS.md: ### `tool_name` heading, one-sentence description, **Params:** line"

key-files:
  created: []
  modified:
    - server/src/onboarding-assets/default/AGENTS.md

key-decisions:
  - "Appended Stapler Tools section after existing preamble — preamble left unchanged per plan spec"
  - "Each tool formatted as H3 code-span heading + description + bold Params line for scanability"

patterns-established:
  - "Tool docs pattern: ### `tool_name` / one-sentence description / **Params:** `param` (type)"

requirements-completed: [AGENTS-01]

duration: 3min
completed: 2026-04-13
---

# Phase 05 Plan 01: Agent Template — Stapler Tools Documentation Summary

**Default AGENTS.md enriched with all 8 Stapler tool entries (memory + goals) so new agents discover tools without reading source code**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-13T21:20:44Z
- **Completed:** 2026-04-13T21:23:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `## Stapler Tools` section to `server/src/onboarding-assets/default/AGENTS.md`
- Documented all 8 Stapler-specific tools: `paperclip_save_memory`, `paperclip_search_memories`, `paperclip_list_memories`, `paperclip_delete_memory`, `paperclip_list_company_memories`, `paperclip_create_goal`, `paperclip_update_goal`, `paperclip_list_goals`
- Preserved existing 4-line preamble unchanged

## Task Commits

1. **Task 1: Add Stapler Tools section to default AGENTS.md** - `35cfefe5` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `server/src/onboarding-assets/default/AGENTS.md` — Added 36-line Stapler Tools section with all 8 tools

## Decisions Made

- Appended tools section after existing preamble rather than replacing any content — preserves current agent behavior while adding discoverability.
- Used H3 code-span headings (`### \`tool_name\``) for consistent formatting and easy scanning.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Default AGENTS.md now provides tool documentation to every new agent at creation time.
- The `loadDefaultAgentInstructionsBundle` path in `server/src/services/default-agent-instructions.ts` picks up this file unchanged — no code changes needed.

---
*Phase: 05-agent-template-propose-bulk*
*Completed: 2026-04-13*
