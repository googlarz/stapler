# Architecture

**Analysis Date:** 2026-04-13

## Pattern Overview

**Overall:** Monorepo with client-server separation using Express API + React SPA, featuring an agent execution loop orchestrated by a heartbeat service that coordinates with pluggable LLM adapters.

**Key Characteristics:**
- Async-first agent execution model driven by database-backed heartbeat scheduler
- Pluggable adapter architecture for LLM backends (Claude, Ollama, Cursor, Gemini, etc.)
- Layered service architecture separating routes, services, and data access
- Real-time WebSocket event propagation for live UI updates
- Multi-tenant company isolation with RBAC and resource quotas

## Layers

**HTTP API Layer:**
- Purpose: Express.js routes handling REST API requests, validation, and response formatting
- Location: `server/src/routes/` (28+ route files)
- Contains: Route handlers for agents, issues, projects, companies, goals, approvals, etc.
- Depends on: Service layer, database, authentication middleware
- Used by: React UI via `ui/src/api/` client modules, external CLI/tools

**Service Layer:**
- Purpose: Business logic, orchestration, database operations, external integrations
- Location: `server/src/services/` (78+ service modules)
- Contains: `heartbeat.ts` (agent execution), `agents.ts`, `issues.ts`, `goals.ts`, `company-skills.ts`, cost tracking, budgeting, plugin lifecycle, etc.
- Depends on: Data access (Drizzle ORM), adapters, configuration, other services
- Used by: Routes, heartbeat scheduler, plugin system, cron jobs

**Adapter Layer:**
- Purpose: Abstract LLM execution behind a common interface supporting multiple providers
- Location: `server/src/adapters/` + `packages/adapters/` (per-adapter packages)
- Contains: Adapter registry, HTTP/process execution adapters, per-LLM implementations (Claude, Ollama, Cursor, Gemini, OpenCode, PI, Hermes)
- Depends on: Adapter utilities (`packages/adapter-utils`), runtime configuration
- Used by: Heartbeat service for executing agents, environment testing

**Data Access Layer:**
- Purpose: Database schema and ORM queries via Drizzle
- Location: `packages/db/src/` (schema/ subdirs with 50+ table definitions)
- Contains: Schema files for agents, issues, projects, companies, heartbeat runs, sessions, memories, etc.; migration system
- Depends on: PostgreSQL (external or embedded)
- Used by: All services and routes

**Real-time Layer:**
- Purpose: WebSocket server for live issue/agent updates without polling
- Location: `server/src/realtime/live-events-ws.ts`
- Contains: WebSocket connection management, event broadcasting, message routing
- Depends on: Service layer (publishLiveEvent), database subscriptions
- Used by: React UI for dashboard streaming updates

**Frontend Layer:**
- Purpose: React single-page application with page-based routing and component composition
- Location: `ui/src/` (pages, components, context, hooks, adapters)
- Contains: Page components (Dashboard, Agents, Issues, Projects, Goals, Approvals), shared components, context providers (Company, Dialog, Toast, Editor, Theme, etc.), TanStack Query for data fetching
- Depends on: API client layer, router, contexts, UI component library
- Used by: Browser clients

**Plugin System Layer:**
- Purpose: Extensibility for custom agent tools, workflows, and UI extensions
- Location: `server/src/services/plugin-*.ts`, `packages/plugins/`
- Contains: Plugin loader, job scheduler, state store, lifecycle manager, event bus, tool dispatcher, configuration validator
- Depends on: Service layer, database, adapter utilities
- Used by: Agents (access to tools), custom workflows, UI slot extensions

## Data Flow

**Agent Execution (Happy Path):**

1. **Wake Trigger** (issue creation/comment, timer, webhook, manual) → Database
2. **Heartbeat Tick** (`server/src/index.ts` line 589-620) polls `heartbeat.tickTimers()` every N seconds
3. **Heartbeat Service** (`server/src/services/heartbeat.ts`) finds queued runs, enforces budget, loads execution workspace
4. **Adapter Selection** (`getServerAdapter()`) resolves runtime config, picks matching adapter
5. **Adapter Execute** (e.g., `packages/adapters/claude-local/src/server/execute.ts`) calls LLM with context, tools, streaming output
6. **Tool Execution** Agent tool calls (create issue, list agents, save memory, etc.) routed via `plugin-tool-dispatcher.ts`
7. **Result Persistence** Run logs stored to `run-log-store.ts`, event rows inserted to `heartbeat_run_events`
8. **Live Update** `publishLiveEvent()` broadcasts to connected WebSocket clients
9. **Post-Execution** Goal verification, cost tracking, budget enforcement, memory auto-save

**UI→API Communication:**

1. React component calls `api.get(path)` / `api.post(path, body)` from `ui/src/api/client.ts`
2. Request routed to Express handler in `server/src/routes/`
3. Route validates input via middleware (`validate.ts`), checks auth, calls service layer
4. Service returns typed response
5. React component receives via TanStack Query, updates UI state

**Real-time Dashboard Updates:**

1. Service layer calls `publishLiveEvent(event)` on change (e.g., issue created, heartbeat run completed)
2. Event published to WebSocket clients subscribed to relevant company
3. Browser receives WebSocket message with delta
4. React component updates state without full refetch

**State Management:**

- **Database**: Source of truth; all writes go through services
- **In-Memory**: Adapter processes, agent locks, plugin state stores, running process tracking
- **React Query**: Client-side cache with stale-while-revalidate, manual invalidation on mutations
- **WebSocket**: Real-time subscription channels (company-scoped)
- **Local Storage**: UI preferences (theme, sidebar collapse, last inbox tab)

## Key Abstractions

**ServerAdapterModule:**
- Purpose: Define execution interface for a single LLM adapter type
- Examples: `packages/adapters/claude-local/src/server/index.ts`, `packages/adapters/ollama-local/src/server/index.ts`
- Pattern: Each adapter exports `execute`, `testEnvironment`, `sessionCodec`, `listModels`, skill sync functions
- Usage: Registry (`server/src/adapters/registry.ts`) loads all modules; heartbeat service invokes selected adapter's execute

**AdapterExecutionContext:**
- Purpose: Bundle all runtime inputs for adapter execute: agent config, project workspace, execution workspace, secrets, memories, run metadata
- Defined: `packages/adapter-utils/src/types.ts`
- Used by: Heartbeat service to build invocation context before calling adapter

**ExecutionWorkspace:**
- Purpose: Isolated runtime environment (file paths, env vars, runtime services) where agent code runs
- Examples: Default agent workspace (user homedir), managed project workspace (per-project git clone)
- Implemented in: `server/src/services/workspace-runtime.ts`
- Lifetime: Created per-run, cleaned up on completion (artifact removal)

**PluginToolDispatcher:**
- Purpose: Route agent tool calls to correct implementation (native tools vs. plugin-provided tools)
- Location: `server/src/services/plugin-tool-dispatcher.ts`
- Pattern: Tool call payload → handler lookup → execution with result validation

**HeartbeatRun:**
- Purpose: Atomic record of single agent execution attempt
- Schema: `packages/db/src/schema/heartbeat_runs.ts`
- Fields: agent, issue, status (queued/running/done/failed), startedAt, finishedAt, result JSON, cost
- Lifecycle: Created on wake; updated during execution; finalized with result + error handling

**AgentMemory:**
- Purpose: Persistent, searchable notes scoped to agent for cross-run context
- Schema: `packages/db/src/schema/agent_memories.ts`
- Features: Full-text search via `pg_trgm`, tags, optional auto-injection into run context
- Lifecycle: Created/updated/deleted via API; searched during run if `enableMemoryInjection: true` in agent config

**Goal:**
- Purpose: Multi-step objective with acceptance criteria, linked issues, ownership
- Schema: `packages/db/src/schema/goals.ts`
- Linked to: Issues (goal_id constraint), verification loop (automatic when all linked issues done)
- Lifecycle: Created via UI; auto-verification triggered on issue done; status transitions (open → in_progress → achieved/abandoned)

## Entry Points

**Server Main:**
- Location: `server/src/index.ts`
- Triggers: `pnpm dev`, Docker container startup, CLI binary invocation
- Responsibilities: Database initialization, embedded Postgres setup, config loading, Express app creation, heartbeat scheduler startup, WebSocket setup, shutdown handlers

**Express App Factory:**
- Location: `server/src/app.ts` (`createApp()` function)
- Triggers: Called by index.ts with database and configuration
- Responsibilities: Route mounting, middleware setup (auth, logging, error handling), plugin system initialization, UI serving configuration

**Heartbeat Scheduler:**
- Location: `server/src/index.ts` (lines 577-621)
- Triggers: Runs on `config.heartbeatSchedulerIntervalMs` (default 5s) if enabled
- Responsibilities: Tick timers, enqueue scheduled runs, reap orphaned runs, coordinate with routine scheduler

**React Entry:**
- Location: `ui/src/main.tsx`
- Triggers: Browser loads `/index.html`
- Responsibilities: Mount React app, initialize contexts, router setup, plugin system bridge

**API Routes:**
- Location: `server/src/routes/index.ts` (imports all route modules)
- Each route file exports function mounted in `createApp()`
- Examples: `agentRoutes`, `issueRoutes`, `projectRoutes` mounted at `/api/agents`, `/api/issues`, `/api/projects`

## Error Handling

**Strategy:** Layered error catching with structured logging and user-friendly HTTP responses

**Patterns:**

- **Route Level:** Try-catch with error code mapping in route handlers; throw `HttpError` with status/message
- **Service Level:** Throw domain errors (conflict, notFound, validation); allow unexpected errors to bubble
- **Middleware:** `errorHandler` middleware catches all errors, logs structured data (context, stack), returns JSON response
- **Adapter Level:** Adapter execute catches LLM errors, timeouts, encoding issues; returns `{ status: "failed", error, log }` in result
- **Database:** Drizzle ORM errors caught, logged with query context; transaction rollback on error

**Common Errors:**
- `HttpError` (status, message, context) in `server/src/errors.ts`
- Validation errors from `middleware/validate.ts`
- Adapter environment check failures reported as environment test results

## Cross-Cutting Concerns

**Logging:** `server/src/middleware/logger.ts` using pino; HTTP logger, structured fields, error logging with context

**Validation:** `middleware/validate.ts` uses `@hapi/joi` for route schemas; catches invalid input before services; returns 400 with error details

**Authentication:** 
- Local trusted mode: Board user injected into request; no auth checks
- Authenticated mode: Better-auth session validation; JWT tokens; per-company membership checks in routes

**Authorization:** 
- Company scoping: All operations filtered by `companyId` from auth context
- Budget enforcement: `budgetService` checks spend limits before run execution
- Quota windows: Adapter-specific rate limits checked per agent per provider

**Cost Tracking:** `costService` calculates run cost via adapter usage metadata; aggregated to agent/company/issue; `costRoutes` exposes spend analytics

**Secrets Management:** `secretService` resolves adapter config secrets from external vault or encrypted local store; secrets never logged; env binding at runtime

**Rate Limiting:** Per-company, per-adapter quotas enforced in `AdapterQuotaWindow`; exceeding quota fails run with budget error

---

*Architecture analysis: 2026-04-13*
