---
phase: 02-ollama-streaming
plan: "01"
subsystem: api
tags: [ollama, streaming, ndjson, token-streaming, tool-calling]

# Dependency graph
requires:
  - phase: 01-ollama-tools-memory-injection
    provides: Ollama adapter with tool calling (Path A) and streaming (Path B)
provides:
  - Per-token streaming in Path A final text response via streaming sub-request
  - Partial output durability confirmed and documented in Path A streaming sub-request
affects: [ui-live-run-transcripts, ollama-adapter-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: [streaming sub-request after tool-calling loop, try/finally reader.cancel() pattern]

key-files:
  created: []
  modified:
    - packages/adapters/ollama-local/src/server/execute.ts

key-decisions:
  - "Path A final response uses stream:true sub-request (no tools param) to emit per-token chunks; tool-calling iterations stay stream:false"
  - "Fallback to single-chunk emit if streaming sub-request fails (resilience)"
  - "Durability of partial output relies on onLog side-effect persistence, not explicit flush in execute.ts"

patterns-established:
  - "Streaming sub-request pattern: fetch stream:true with getReader() + TextDecoder + buffer split on newline"
  - "try/finally with reader.cancel().catch(() => {}) wrapping all streaming reads"

requirements-completed: [STREAM-01]

# Metrics
duration: 1min
completed: 2026-04-13
---

# Phase 02 Plan 01: Ollama Streaming Summary

**Ollama Path A now streams final text token-by-token via a stream:true sub-request after tool-call iterations complete, matching Path B behavior**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-13T20:53:35Z
- **Completed:** 2026-04-13T20:54:39Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Path A (agentic tool loop) final text response now uses a streaming sub-request (`stream: true`) that emits per-token `onLog` chunks via NDJSON `getReader()` loop
- Fallback to single-chunk emit preserved if the streaming sub-request fails or returns no body
- Partial output durability confirmed via audit: each `onLog` call persists chunks immediately via run-log-store before any AbortController can fire; comment added to document this invariant
- `try/finally` with `reader.cancel().catch(() => {})` present in new streaming sub-request, matching existing Path B pattern
- `timedOut` guard at function exit still returns before building success result, preventing partial content from leaking into success responses

## Task Commits

Each task was committed atomically:

1. **Task 1: Stream the final text response in the tool-calling path (Path A)** - `bb3ca38d` (feat)
2. **Task 2: Verify partial output is flushed on interruption** - (audit only, no additional code changes; comment and try/finally implemented in Task 1 commit)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `packages/adapters/ollama-local/src/server/execute.ts` - Path A final response now emits per-token chunks via streaming sub-request; durability comment and reader.cancel() try/finally added

## Decisions Made

- Path A tool-calling iterations keep `stream: false` (required — Ollama only returns `tool_calls` in non-streaming mode). Only the final iteration uses `stream: true`.
- No tools param in streaming sub-request (Ollama streaming doesn't support tools; final response is always plain text).
- `promptEvalCount`/`evalCount` accumulated by adding streaming response stats to non-streaming stats from tool iterations.

## Deviations from Plan

None - plan executed exactly as written. Task 2 was a pure audit with no code changes required; the comment and try/finally were co-implemented in Task 1 as part of the streaming sub-request.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- STREAM-01 satisfied: both Path A and Path B emit per-token `onLog` chunks in real time
- UI pipeline (heartbeat.ts → publishLiveEvent → useLiveRunTranscripts → parseOllamaStdoutLine) is unchanged and already handles `type:chunk` lines
- Ready for Phase 3 (Company Shared Memories)

---
*Phase: 02-ollama-streaming*
*Completed: 2026-04-13*
