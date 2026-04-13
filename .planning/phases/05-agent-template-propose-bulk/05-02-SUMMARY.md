---
phase: 05-agent-template-propose-bulk
plan: "02"
subsystem: ui
tags: [propose-tasks, bulk-create, issues, dialog]
dependency_graph:
  requires: []
  provides: [bulk-create-proposals-ui]
  affects: [AgentDetail.tsx]
tech_stack:
  added: []
  patterns: [Promise.all parallel create, Set-based selection state]
key_files:
  created: []
  modified:
    - ui/src/pages/AgentDetail.tsx
decisions:
  - Guard `!agent` added to handleBulkCreate to satisfy TypeScript (agent is possibly undefined in component scope)
metrics:
  duration: "~8 minutes"
  completed: "2026-04-13"
  tasks_completed: 1
  files_modified: 1
---

# Phase 05 Plan 02: Propose Tasks Bulk Create Summary

**One-liner:** Checkbox selection + "Create selected (N)" button wired to parallel `issuesApi.create()` calls in the Propose Tasks dialog.

## What Was Built

Added bulk-creation UI to the Propose Tasks dialog in `AgentDetail.tsx`:

- `selectedProposals: Set<number>` and `bulkCreating: boolean` state alongside existing propose state
- `handleBulkCreate` async handler using `Promise.all` to call `issuesApi.create()` in parallel for each checked proposal, then closes dialog and resets state
- Per-card checkbox (native `<input type="checkbox">`) in card header row, left of title, toggling the proposal index in `selectedProposals`
- "Create selected (N)" `<Button>` below the proposals list, disabled when none selected or while creating, with a `Loader2` spinner during creation
- `selectedProposals` reset on dialog open (`handleProposeTasks`) and on new proposals generated (`handleGenerateProposals`)
- Existing per-card "Create Issue" button preserved untouched

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `!agent` guard to handleBulkCreate**
- **Found during:** TypeScript compilation check
- **Issue:** `agent` is typed as `AgentDetailRecord | undefined` in component scope; accessing `agent.id` inside the callback caused TS error TS18048
- **Fix:** Added `|| !agent` to the early-return guard at top of `handleBulkCreate`
- **Files modified:** `ui/src/pages/AgentDetail.tsx`
- **Commit:** a4603e82

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | feat(05-02): add checkbox selection and bulk-create to Propose Tasks dialog | a4603e82 |

## Self-Check: PASSED

- `ui/src/pages/AgentDetail.tsx` modified with all required additions
- `selectedProposals`, `bulkCreating`, `handleBulkCreate` all present (verified via grep)
- TypeScript compiles without errors (tsc --noEmit: no output)
- Commit a4603e82 exists in git log
