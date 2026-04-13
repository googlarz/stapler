# Codebase Structure

**Analysis Date:** 2026-04-13

## Directory Layout

```
stapler/
├── .agents/                    # Agent configuration stubs
├── .claude/                    # Claude-specific project config
├── .github/                    # CI/CD workflows, issue templates
├── .planning/                  # GSD planning outputs (this file)
├── cli/                        # Command-line interface (pnpm paperclipai ...)
├── doc/                        # Architecture decision records, design docs
├── docker/                     # Docker build configs for different modes
├── docs/                       # User documentation (setup guides, feature docs)
├── evals/                      # Evaluation scripts for agent performance testing
├── packages/                   # Monorepo shared packages
│   ├── adapters/              # Per-LLM adapter packages (claude-local/, ollama-local/, cursor-local/, etc.)
│   ├── adapter-utils/         # Shared adapter types, session management, billing, logging
│   ├── db/                    # Drizzle ORM schema, migrations, database client
│   ├── mcp-server/            # MCP (Model Context Protocol) server integration
│   ├── plugins/               # Plugin SDK and plugin system types
│   ├── shared/                # Shared TypeScript types, validation schemas (agent, issue, company, etc.)
├── releases/                  # Release management, versioning
├── report/                    # Generated reports (budget, cost, performance)
├── scripts/                   # Build, test, dev, deploy scripts
├── server/                    # Express API server (Node.js backend)
│   └── src/
│       ├── adapters/          # Adapter registry, HTTP/process runners, environment testing
│       ├── auth/              # Better-auth integration, session handling
│       ├── middleware/        # Express middleware (auth, logging, validation, error handling)
│       ├── realtime/          # WebSocket server for live updates
│       ├── routes/            # Express route handlers (28+ route files)
│       ├── secrets/           # Secret provider implementations (local encrypted, external vault stubs)
│       ├── services/          # Business logic services (78+ service modules)
│       ├── storage/           # File storage abstraction (local disk, S3)
│       ├── types/             # TypeScript type declarations (Express extensions)
│       ├── app.ts             # Express app factory with middleware/route setup
│       ├── index.ts           # Server entry point with database and scheduler init
│       └── config.ts          # Configuration loading from environment
├── skills/                    # Built-in agent skills (readonly)
├── tests/                     # Integration and e2e test suites
├── ui/                        # React SPA frontend
│   └── src/
│       ├── adapters/          # Per-adapter UI config components (claude-local, ollama-local, etc.)
│       ├── api/               # API client modules (agents.ts, issues.ts, companies.ts, etc.)
│       ├── components/        # Reusable React components (120+ components)
│       ├── context/           # React context providers (Company, Dialog, Theme, Toast, Editor, etc.)
│       ├── hooks/             # Custom React hooks (useQuery wrapping, data fetching)
│       ├── lib/               # Utilities (router, queryKeys, formatters, timeAgo, etc.)
│       ├── pages/             # Page components (Dashboard, Agents, Issues, Projects, etc.)
│       ├── plugins/           # Plugin system bridge (launcher slots, event emitter)
│       ├── App.tsx            # Root component with route definitions
│       ├── main.tsx           # React DOM mount point
│       └── index.css          # Tailwind CSS styles
├── pnpm-workspace.yaml        # Monorepo workspace configuration
├── package.json               # Root package dependencies
├── tsconfig.json              # TypeScript root configuration
├── vitest.config.ts           # Test runner configuration (shared)
├── Dockerfile                 # Production Docker image
├── .env.example               # Environment variable template
├── README.md                  # Quick start and feature overview
└── CONTRIBUTING.md            # Contribution guidelines
```

## Directory Purposes

**packages/adapters/**
- Purpose: Pluggable LLM adapter implementations
- Each adapter is a separate package with `/src/{server,ui,shared,cli}`
- Adapters: `claude-local`, `ollama-local`, `cursor-local`, `gemini-local`, `opencode-local`, `pi-local`, `codex-local` (plus external: `hermes-paperclip-adapter`)
- Server exports: `execute`, `testEnvironment`, `sessionCodec`, skill sync functions
- UI exports: Config field components, model pickers, stdout parsers

**packages/adapter-utils/**
- Purpose: Shared types and utilities for all adapters
- Contains: Session compaction policies, billing inference, log redaction, common types
- Used by: All adapters, heartbeat service, cost service

**packages/db/**
- Purpose: Drizzle ORM schema and migrations
- Structure: `src/schema/` with 50+ table definition files, `src/migrations/` with numbered migration SQL
- Exports: Schema tables, database client factory, migration utilities
- Key tables: `agents`, `issues`, `projects`, `companies`, `heartbeat_runs`, `agent_memories`, `goals`, `execution_workspaces`, etc.

**packages/shared/**
- Purpose: Shared TypeScript types across server and UI
- Contains: Validation schemas (Zod), type definitions for domain models, constants, enums
- Examples: `Agent`, `Issue`, `Goal`, `ExecutionWorkspace`, `AdapterRuntimeConfig` types

**server/src/routes/**
- Purpose: Express route handlers organized by domain
- 28+ route files: `agents.ts` (93KB), `issues.ts` (108KB), `companies.ts`, `projects.ts`, `goals.ts`, `approvals.ts`, `costs.ts`, `adapters.ts`, `plugins.ts`, etc.
- Pattern: Each file exports a router factory function (e.g., `agentRoutes(db, services)`)
- Mounted in: `server/src/app.ts` at their respective paths

**server/src/services/**
- Purpose: Business logic, orchestration, data persistence
- 78+ service modules covering: agents, issues, projects, goals, budgets, costs, heartbeat execution, plugin lifecycle, company portability, skill syncing, access control, etc.
- Largest: `heartbeat.ts` (172KB), `feedback.ts` (71KB), `issues.ts` (89KB), `company-portability.ts` (171KB)
- Pattern: Service factory functions exported; stateless (all state in DB)

**server/src/adapters/**
- Purpose: Abstract LLM execution backend
- Files: `registry.ts` (adapter loader), `types.ts` (interface definitions), `utils.ts` (shared helpers)
- Subdirs: `http/`, `process/` (generic runners), `plugin-loader.ts` (external adapter loading)
- Registry pattern: All adapters imported, stored in map, selected by type during run

**ui/src/pages/**
- Purpose: Page-level route components
- 49+ pages: Dashboard, Agents, AgentDetail, Issues, IssueDetail, Projects, ProjectDetail, Goals, Approvals, Costs, Activity, PluginManager, AdapterManager, InstanceSettings, etc.
- Pattern: Each page fetches data via TanStack Query, renders components, handles mutations

**ui/src/components/**
- Purpose: Reusable UI building blocks
- 120+ components: Buttons, inputs, modals, tables, status indicators, cards, charts, sidebars
- Organized by: Forms, Lists, Detail views, Settings, Modals, Cards

**ui/src/context/**
- Purpose: React context providers for global state
- Contexts: CompanyContext (selected company), DialogContext (modals), ThemeContext, ToastContext, EditorAutocompleteContext, LiveUpdatesProvider, BreadcrumbContext, SidebarContext, GeneralSettingsContext, PanelContext
- Pattern: Each context exported as hook (e.g., `useCompany()`, `useDialog()`)

## Key File Locations

**Entry Points:**
- `server/src/index.ts`: Server startup, database init, heartbeat scheduler
- `ui/src/main.tsx`: React DOM mount, context setup
- `cli/src/index.ts`: CLI command router

**Configuration:**
- `server/src/config.ts`: Load and validate environment variables, return config object
- `.env.example`: Template of all required/optional variables
- `packages/db/drizzle.config.ts`: Drizzle migration config
- `ui/vite.config.ts`, `ui/vitest.config.ts`: Build and test config

**Core Logic:**
- `server/src/services/heartbeat.ts`: Agent execution loop, orchestrator for adapters, result persistence
- `server/src/services/agents.ts`: Agent CRUD, configuration, state management
- `server/src/services/issues.ts`: Issue lifecycle, comments, execution policy
- `server/src/services/goal-verification.ts`: Verification loop orchestration
- `server/src/services/plugin-tool-dispatcher.ts`: Route tool calls to handlers
- `packages/adapters/*/src/server/execute.ts`: Per-adapter execution implementation

**Testing:**
- `**/*.test.ts`, `**/*.spec.ts`: Vitest test files throughout codebase
- `tests/`: Integration and e2e tests
- `evals/`: Agent evaluation scripts
- `vitest.config.ts`: Shared test config

**Database:**
- `packages/db/src/schema/`: 50+ table definition files (one table per file)
- `packages/db/src/migrations/`: SQL migration files (numbered, applied in order)
- `packages/db/src/client.ts`: Drizzle ORM client factory
- `packages/db/src/index.ts`: Public API exports

## Naming Conventions

**Files:**
- Route files: `{plural-domain}.ts` (e.g., `agents.ts`, `issues.ts`, `projects.ts`)
- Service files: `{domain}-service.ts` or `{domain}.ts` (e.g., `heartbeat.ts`, `agent-memories.ts`)
- Schema files: `{plural_table_name}.ts` in `packages/db/src/schema/`
- Test files: `{name}.test.ts` or `{name}.spec.ts` co-located with source
- Context files: `{Domain}Context.tsx` in `ui/src/context/`
- Page files: `{PascalCase}.tsx` in `ui/src/pages/`
- Components: `{PascalCase}.tsx` in `ui/src/components/`
- API modules: `{camelCase}.ts` in `ui/src/api/`

**Directories:**
- Domains use plural names (adapters, agents, issues, projects, services)
- Schema files grouped under `src/schema/` with one table per file
- Per-adapter packages follow pattern: `packages/adapters/{adapter-name}-local/`
- Route and service files grouped by domain in their directories

**Functions & Variables:**
- Services exported as factory functions: `export function agentService(db: Db): AgentService { ... }`
- API client methods: `agentsApi.list()`, `agentsApi.create()`, `agentsApi.update()`
- React hooks: `useCompany()`, `useDialog()`, `useQuery()` (TanStack Query)
- Database operations use Drizzle ORM: `db.select(...).from(agents).where(...)`

**Types & Enums:**
- Database models: `Agent`, `Issue`, `Goal`, `Company` (singular, from `@paperclipai/shared`)
- Service return types: `{ id, name, ... }` extending domain model
- Enums for status: `IssueStatus`, `RunStatus`, `GoalStatus` (PascalCase with suffix)

## Where to Add New Code

**New Feature Endpoint:**
1. Add database table if needed: Create `packages/db/src/schema/{table_name}.ts`
2. Create migration: `pnpm db:generate` auto-creates from schema
3. Add route handler: `server/src/routes/{domain}.ts` with POST/GET/PUT/DELETE handlers
4. Add service: `server/src/services/{domain}.ts` for business logic
5. Add API client: `ui/src/api/{domain}.ts` with request methods
6. Add page/component: `ui/src/pages/{Domain}.tsx` or `ui/src/components/{Component}.tsx`
7. Add route to App.tsx: Import page, add `<Route path="..." element={<Page/>}/>` to Routes

**New Adapter:**
1. Create package: `packages/adapters/{name}-local/`
2. Copy structure from existing adapter (e.g., `packages/adapters/claude-local/`)
3. Implement required exports: `execute`, `testEnvironment`, `sessionCodec`, `listModels`
4. Register in: `server/src/adapters/registry.ts` (import and add to adapter modules)
5. Add UI components: `ui/src/adapters/{name}/` with config fields and parsers

**New Service:**
1. Create file: `server/src/services/{domain}.ts`
2. Export factory function: `export function {domain}Service(db: Db): {Domain}Service { ... }`
3. Import and instantiate in: `server/src/services/index.ts`
4. Use in routes via injected service instance

**New Context (UI State):**
1. Create file: `ui/src/context/{Domain}Context.tsx`
2. Define context with `React.createContext<Type>()`
3. Create provider component with `useReducer` or useState
4. Export hook: `export function use{Domain}() { ... }`
5. Wrap App/Layout in provider

## Special Directories

**plugins/** (Socket-based extensibility)
- Purpose: Plugin SDK types and plugin system implementation
- Files: `plugin-*.ts` in `server/src/services/` handle lifecycle, job scheduling, state, tool dispatch
- Plugin entry points: Host services expose APIs; plugins run in workers; job coordinator synchronizes

**skills/** (Built-in agent tools)
- Purpose: Default tools available to all agents (readonly)
- Generated from source; synced to adapters at startup
- NOT the place for new features; use plugin system for custom tools

**migrations/** (Irreversible database changes)
- Purpose: Drizzle ORM migration files; applied sequentially in order
- Pattern: `YYYYMMDDHHMM_description.sql` numbered by creation time
- Never edit old migrations; always create new ones for schema changes

**node_modules/** (Generated dependencies)
- Purpose: pnpm installs all workspace packages here
- Committed in: `pnpm-lock.yaml` (not node_modules itself)
- Regenerate: `pnpm install`

**releases/** (Deployment artifacts)
- Purpose: Built Docker images, release notes, version tags
- Generated by: CI/CD pipeline on tag

---

*Structure analysis: 2026-04-13*
