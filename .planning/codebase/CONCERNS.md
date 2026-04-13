# Codebase Concerns

**Analysis Date:** 2026-04-13

## Tech Debt

**Widespread type assertion hacks:**
- Issue: Excessive `as any` and `as unknown` casts bypassing type safety
- Files: `server/src/index.ts` (lines 469, 497, 501, 521, 524, 559, 578-579), `server/src/middleware/logger.ts` (lines 60, 61, 76, 86-87), `server/src/middleware/error-handler.ts` (lines 22, 31), `server/src/__tests__/*` (numerous test files)
- Impact: Reduces type safety guarantees; makes refactoring risky; hides real type errors behind `any` walls
- Fix approach: Proper type annotations for database objects, Express request/response extensions. Create typed wrappers for `db as any` casts in initialization code (`server/src/index.ts`). Add TypeScript augmentation for `req.actor` type instead of casting to `any` in middleware.

**Memory service incomplete - precursor to upstream PR #3403:**
- Issue: Agent memory service is temporary replacement; full memory system with pluggable providers, multi-scope records, and auto-extraction exists in upstream PR #3403
- Files: `server/src/services/agent-memories.ts` (lines 1-17 document the future replacement)
- Impact: Current keyword-search-only approach lacks semantic understanding; when upstream lands, must absorb 5 new tables, migrate data, drop service and update all routes
- Fix approach: Track upstream PR #3403 landing; plan migration of `agent_memories` rows → `memory_local_records` with scopeAgentId; migrate routes to new API; remove this service entirely

**`as any` in database initialization:**
- Issue: Multiple critical services cast database objects to `any` instead of maintaining type safety
- Files: `server/src/index.ts` lines 469, 497, 501, 521, 524, 559, 564, 578-579
- Impact: Loses ability to refactor db schema safely; hidden coupling between init code and service signatures
- Fix approach: Create properly-typed db wrapper during initialization; avoid casting database object itself

**Ollama adapter hardcoded defaults:**
- Issue: Adapter uses hardcoded `http://localhost:11434` and model `llama3.2` with limited fallback handling
- Files: `packages/adapters/ollama-local/src/index.ts` (lines 5, 4)
- Impact: Breaks if Ollama runs on non-standard port/host; no graceful degradation when Ollama unavailable; single model assumption limits flexibility
- Fix approach: Ensure `baseUrl` and `model` are fully configurable via agent config; add pre-flight health check before run; document error recovery paths

**Hardcoded localhost/127.0.0.1 across codebase:**
- Issue: Multiple hardcoded localhost bindings and development-specific URLs
- Files: `server/src/middleware/board-mutation-guard.ts` (lines 5-6: "http://localhost:3100", "http://127.0.0.1:3100"), `server/src/adapters/codex-models.ts` (OPENAI_MODELS_ENDPOINT), CLI onboarding defaults
- Impact: Non-obvious what is prod/dev; easy to miss when promoting config to production; CORS/auth guards may allow unintended hosts
- Fix approach: Extract all localhost/127.0.0.1 addresses to environment-based configuration; validate against allowlist during startup; document required origins for each deployment mode

---

## Known Bugs

**Heartbeat run orphan detection incomplete:**
- Symptoms: Detached processes continue running after their heartbeat records expire; process groups may linger without cleanup
- Files: `server/src/services/heartbeat.ts` (lines 2746 `reapOrphanedRuns`, process group termination logic)
- Trigger: Long-running adapter execution (timeouts) + restart/crash during cleanup phase
- Workaround: Manual `ps` audit and kill orphan processes; timeout-based cleanup via `HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT`
- Fix approach: Implement cross-run process group tracking with guaranteed cleanup on boot; add metrics for orphan detection rate

**Race condition in memory count on concurrent saves:**
- Symptoms: Agent memory count exceeds `PAPERCLIP_MEMORY_MAX_PER_AGENT` after concurrent inserts
- Files: `server/src/services/agent-memories.ts` (lines 164-237)
- Trigger: Two rapid parallel saves to same agent before either prune completes
- Workaround: `pg_advisory_xact_lock` serializes saves within a transaction (currently implemented), but lock is only per-transaction
- Current fix: Uses advisory lock correctly (lines 170-172); verified safe in tests

**Off-by-one prune edge case (FIXED in recent PR):**
- Symptoms: When deleting memory rows due to cap overflow, incorrect count on timestamp collisions
- Files: `server/src/services/agent-memories.ts` (lines 222-233)
- Trigger: Multiple memories created within same microsecond + overflow at exactly that boundary
- Status: FIXED by PR #3289 (commit 3893420c) — now excludes newly-inserted row in WHERE clause (`ne(agentMemories.id, memoryRow.id)`)

---

## Security Considerations

**API key handling & token storage:**
- Risk: API keys stored as SHA256 hashes in database; tokens passed in `Authorization: Bearer` header over HTTPS
- Files: `server/src/middleware/auth.ts` (lines 12-14 hash function, lines 104-150 token validation), `server/src/services/board-auth.ts` (key storage)
- Current mitigation:
  - Token never logged (redaction in logger middleware)
  - Hash prevents plaintext storage
  - Agent JWT tokens use RS256 signing with key rotation
  - Advisory lock prevents concurrent auth state corruption
- Recommendations:
  - Implement token rate limiting per key
  - Add token expiry/rotation policy
  - Log failed auth attempts for anomaly detection
  - Consider adding HMAC verification on token format before hash lookup

**Cross-agent memory isolation:**
- Risk: Agent X token could access/delete Agent Y's memories
- Files: `server/src/services/agent-memories.ts` (line 329 `remove`), `server/src/routes/agent-memories.ts` (route guards)
- Current mitigation:
  - `remove(id, agentId)` requires both id AND agentId match (service-layer scoping)
  - `assertAgentIdentity` middleware (lines 16-17 of PR description) prevents URL manipulation bypass
  - Auth middleware resolves `req.actor.agentId` from token DB row, not URL
- Status: SECURE — verified by cross-agent test (PR #3289)

**Environment variable exposure in logs:**
- Risk: Sensitive values (API keys, DB URLs) accidentally logged via `logger.error({ err }, ...)`
- Files: `server/src/middleware/logger.ts` (lines 60-87), `server/src/middleware/error-handler.ts`
- Current mitigation: Redaction middleware sanitizes logs; `scripts/migrate-inline-env-secrets.ts` enforces secret refs
- Recommendations:
  - Audit all error serialization to exclude `process.env`
  - Consider structured logging with schema validation

**Local deployment implicit trust:**
- Risk: `deployment_mode: local_trusted` grants instance-admin access without credential verification
- Files: `server/src/middleware/auth.ts` (lines 25-26)
- Impact: Safe for localhost-only development; dangerous if exposed publicly
- Fix approach: Validate deployment mode cannot be set to `local_trusted` in non-local environments (check bind host during startup)

**Ollama adapter tool execution:**
- Risk: Ollama models cannot execute tools/shell commands, but documentation could be misunderstood
- Files: `packages/adapters/ollama-local/src/index.ts` (lines 32-36 explicitly document limitations)
- Current mitigation: Clear documentation that Ollama lacks code-execution capabilities
- Recommendations: Consider adapter-capability matrix in UI to prevent misconfiguration

---

## Performance Bottlenecks

**Heartbeat service file size & complexity:**
- Problem: Massive monolithic service at 4,872 lines
- Files: `server/src/services/heartbeat.ts`
- Cause: All heartbeat orchestration logic (enqueueing, execution, logging, cleanup, state management) in single file
- Improvement path:
  - Extract session management → separate file
  - Extract workspace preparation → `workspace-setup.ts`
  - Extract execution orchestration → `execution-orchestrator.ts`
  - Extract logging/event publishing → `heartbeat-logging.ts`
  - Keep public API surface in index export

**Memory service similarity threshold inefficiency:**
- Problem: Trigram similarity search on all rows requires full table scan + similarity() function call per row
- Files: `server/src/services/agent-memories.ts` (lines 253-284 `search`)
- Cause: `pg_trgm` similarity is O(n) without vector embeddings; GIN index helps but not for relevance ranking
- Improvement path:
  - Implement pgvector-backed semantic search (gated on proving pgvector availability in embedded-postgres)
  - Keep trgm as fallback for short queries
  - Add query result caching for repeated searches

**Database transaction lock on save:**
- Problem: `pg_advisory_xact_lock` serializes all concurrent saves for same agent
- Files: `server/src/services/agent-memories.ts` (lines 170-172)
- Cause: Necessary to prevent over-cap eviction race, but blocks parallel saves
- Impact: Negligible for 500-row per-agent cap; becomes issue if cap significantly increased
- Improvement path: Implement batch save endpoint for bulk inserts; consider lock-free count estimation

---

## Fragile Areas

**Execution workspace strategy & git worktree handling:**
- Files: `server/src/services/heartbeat.ts` (lines 207-267 workspace preparation), `server/src/services/execution-workspaces.ts`, `server/src/services/workspace-runtime.ts`
- Why fragile:
  - Multiple fallback strategies (repo checkout, git worktree, managed workspace) with conditional logic
  - Race conditions possible between workspace prep and execution start
  - File system operations not atomic; partial checkouts possible on crash
- Safe modification:
  - Always backup current branch before attempting worktree operations
  - Test checkout and worktree paths independently before integration
  - Add idempotency checks for `git clone` and `git checkout` operations
- Test coverage: Gaps in concurrent workspace preparation scenarios

**Plugin worker communication:**
- Files: `server/src/services/plugin-worker-manager.ts` (1,344 lines), `server/src/services/plugin-host-services.ts` (1,147 lines)
- Why fragile:
  - IPC/subprocess message serialization complex (`serializeMessage` cast to `any` line 421)
  - Worker lifecycle not fully isolated; parent crash can leave workers orphaned
  - Message queue could overflow under high agent concurrency
- Safe modification: Test worker spawn/cleanup under agent concurrency load; add timeout guards on message waits
- Test coverage: Limited integration tests for worker failures

**Company portability & data export:**
- Files: `server/src/services/company-portability.ts` (4,414 lines)
- Why fragile: Large complex migration logic with multiple table dependencies; export format could diverge from schema
- Safe modification: Run full portability suite after schema changes; validate exported data format against schema
- Test coverage: 2,355 lines of tests but mostly happy-path

---

## Scaling Limits

**Agent memory storage per agent:**
- Current capacity: 500 memories × 4 KB max content = 2 MB/agent soft limit
- Limit: Trigram search degrades with large per-agent corpora; admin API could hit timeouts on prune queries
- Scaling path:
  1. Increase `PAPERCLIP_MEMORY_MAX_PER_AGENT` gradually; monitor query latency
  2. Implement vector embeddings for O(1) search (PR after pgvector availability proven)
  3. Consider memory partitioning by scope (company/project/issue) in upstream #3403

**Concurrent heartbeat execution:**
- Current capacity: Default 1 concurrent run per agent; configurable via `HEARTBEAT_MAX_CONCURRENT_RUNS_MAX` = 10
- Limit: Each run holds advisory lock on agent during execution; higher concurrency = lock contention
- Scaling path:
  - Profile lock wait times under peak load
  - Implement priority queue for high-value runs (e.g., manual invocations)
  - Consider sharding agents across multiple heartbeat workers

**Database connection pool:**
- Current capacity: Inherited from `pg` client pool; default varies by deployment mode
- Limit: Concurrent heartbeat + memory operations could saturate pool during peak loads
- Scaling path:
  - Add pool metrics to observability dashboard
  - Implement query timeout enforcement
  - Consider read replicas for search operations

---

## Dependencies at Risk

**embedded-postgres version pinning:**
- Risk: Embedded-postgres `@18.1.0-beta.16` lacks `pgvector` extension; blocks semantic search for memories
- Impact: Semantic memory search deferred; unsupported in current dev environment
- Migration plan:
  - Track upgrade path for embedded-postgres to stable release
  - Verify pgvector included in distributed extension set
  - Implement version detection at startup; warn if pgvector unavailable

**Ollama model availability:**
- Risk: If Ollama not running or requested model not pulled, adapter fails silently or returns generic error
- Impact: Agent runs fail with cryptic messages; no pre-flight validation
- Fix: Add health check endpoint in ollama adapter; validate model availability before run starts

---

## Missing Critical Features

**Monitoring & observability for memory service:**
- Problem: No metrics for memory search latency, cache hit rate, or prune frequency
- Blocks: Ability to detect performance degradation early; capacity planning difficult
- Recommendation: Add counters for save/search/delete operations; track p95 similarity query latency

**Graceful degradation when Ollama unavailable:**
- Problem: Ollama adapter fails entire run if service not accessible
- Blocks: Robust local deployment scenarios with fallback providers
- Recommendation: Add pre-flight connectivity check; suggest fallback adapter in error message

**Memory extraction automation:**
- Problem: Current system requires explicit saves by adapter; no auto-extraction from run outputs
- Blocks: Hands-off memory capture that upstream #3403 will provide
- Status: Deferred to upstream PR

---

## Test Coverage Gaps

**Heartbeat execution under network failure:**
- What's not tested: Adapter execution when git clone times out, worktree creation fails, or workspace prep partially succeeds
- Files: `server/src/services/heartbeat.ts` (execution path), `server/src/services/workspace-runtime.ts`
- Risk: Silent failures or hung processes if network issues during workspace setup
- Priority: High — affects deployment reliability

**Memory search with edge-case queries:**
- What's not tested: Empty trigram matches (e.g., query = "!!!!!"), very long memory content (near 4 KB), bulk operations near cap boundary
- Files: `server/src/services/agent-memories.ts`
- Risk: Unexpected behavior or OOM on pathological inputs
- Priority: Medium — mainly affects robustness

**Plugin worker lifecycle under agent crashes:**
- What's not tested: Worker cleanup when parent agent is terminated mid-execution, orphaned worker processes after sudden shutdown
- Files: `server/src/services/plugin-worker-manager.ts`
- Risk: Resource leaks; lingering worker processes consume memory/CPU
- Priority: High — affects long-running deployments

**Cross-agent authorization bypass:**
- What's not tested: Agent JWT token reuse attempts, invalid token formats against route guards
- Files: `server/src/routes/agent-memories.ts`, `server/src/middleware/auth.ts`
- Risk: Low (PR #3289 adds cross-agent test) but should be expanded to all agent routes
- Priority: Medium — systematic auth fuzzing needed

---

## Type Safety Issues

**Loose object typing in context/config:**
- Problem: Context and config parameters typed as `Record<string, unknown>` instead of concrete types
- Files: `server/src/services/agent-memories.ts` (lines 365-366 agent parameter), `server/src/services/heartbeat.ts` (numerous context snapshots)
- Impact: Easy to misaccess properties; refactoring contexts requires manual updates
- Fix: Define concrete ContextSnapshot and AdapterConfig types; validate at boundaries

---

## Documentation Gaps

**Ollama adapter limitations not prominently featured:**
- Problem: "No tool use / code-execution capabilities" documented but could be more prominent for new users
- Files: `packages/adapters/ollama-local/src/index.ts` (lines 32-36)
- Recommendation: Add warning banner in agent config UI for Ollama adapter selection

---

*Concerns audit: 2026-04-13*
