# External Integrations

**Analysis Date:** 2026-04-13

## APIs & External Services

**LLM Providers (via Adapters):**

All LLM integrations are abstracted through adapter packages located in `packages/adapters/`. Each adapter implements:
- Server-side integration (`./server` export)
- UI components (`./ui` export)
- CLI interface (`./cli` export)

- **Claude (Anthropic)** - `@stapler/adapter-claude-local`
  - SDK/Client: Anthropic SDK (configured by adapter)
  - Auth: API key environment variable (managed by adapter)
  - Location: `packages/adapters/claude-local/src/`

- **Gemini (Google)** - `@stapler/adapter-gemini-local`
  - SDK/Client: Google Generative AI SDK
  - Auth: API key (managed by adapter)
  - Location: `packages/adapters/gemini-local/src/`

- **Ollama (Local LLMs)** - `@stapler/adapter-ollama-local`
  - SDK/Client: HTTP client to Ollama local server
  - Auth: None (local service)
  - Endpoint: `http://localhost:11434` (configurable)
  - Location: `packages/adapters/ollama-local/src/`

- **Pi (Inflection AI)** - `@stapler/adapter-pi-local`
  - SDK/Client: Pi API client
  - Auth: API key
  - Location: `packages/adapters/pi-local/src/`

- **OpenCode** - `@stapler/adapter-opencode-local`
  - SDK/Client: Custom OpenCode client
  - Location: `packages/adapters/opencode-local/src/`

- **Codex** - `@stapler/adapter-codex-local`
  - SDK/Client: Custom Codex client
  - Location: `packages/adapters/codex-local/src/`

- **Cursor** - `@stapler/adapter-cursor-local`
  - SDK/Client: Cursor IDE integration
  - Location: `packages/adapters/cursor-local/src/`

- **OpenClaw Gateway** - `@stapler/adapter-openclaw-gateway`
  - SDK/Client: WebSocket gateway client (ws 8.19.0)
  - Auth: Optional gateway authentication
  - Protocol: WebSocket with message-based communication
  - Location: `packages/adapters/openclaw-gateway/src/`
  - Uses: `ws@8.19.0` for WebSocket handling

**Third-party Integrations:**

- **Hermes Adapter** - `hermes-paperclip-adapter@0.2.0`
  - Purpose: Integration with Hermes-based agent orchestration
  - Used in: `server/src/` and `ui/src/`

## Data Storage

**Databases:**

- **PostgreSQL** (primary)
  - Connection: `DATABASE_URL` env var or embedded instance
  - Client: drizzle-orm 0.38.4 with postgres 3.4.5
  - Adapter: Drizzle ORM with native PostgreSQL adapter
  - Hosted: Embedded PostgreSQL (embedded-postgres 18.1.0-beta.16) or external PostgreSQL instance
  - Location: `packages/db/src/`

- **Embedded PostgreSQL** (default for zero-config)
  - Package: `embedded-postgres@18.1.0-beta.16` (patched)
  - Auto-initialization: Yes, on server startup
  - Data directory: `~/.paperclip/postgres/` (configurable)
  - Migrations: Auto-applied on startup
  - Location: `server/src/index.ts` (initialization logic)
  - Note: Uses patched version from `patches/embedded-postgres@18.1.0-beta.16.patch`

**File Storage:**

- **Local Filesystem** (default)
  - Base directory: `~/.paperclip/storage/` (configurable via `STAPLER_STORAGE_LOCAL_DIR`)
  - Config: `STAPLER_STORAGE_PROVIDER=local_disk`
  - Client: Node.js fs module (native)
  - Usage: Stores user files, uploads, generated assets

- **AWS S3** (optional)
  - Package: `@aws-sdk/client-s3@3.888.0`
  - Config:
    - `STAPLER_STORAGE_PROVIDER=s3`
    - `STAPLER_STORAGE_S3_BUCKET` - Bucket name
    - `STAPLER_STORAGE_S3_REGION` - AWS region
    - `STAPLER_STORAGE_S3_ENDPOINT` - Optional custom endpoint
    - `STAPLER_STORAGE_S3_PREFIX` - Key prefix
    - `STAPLER_STORAGE_S3_FORCE_PATH_STYLE` - Force path-style URLs
  - Service creation: `server/src/storage/index.ts` (createStorageServiceFromConfig)

**Caching:**

- **In-memory caching** - Via Node.js Map structures (application-level)
- **Database query caching** - Via @tanstack/react-query (frontend)
  - Config: React Query configured in UI app

## Authentication & Identity

**Auth Provider:**

- **Better Auth** (self-managed)
  - Package: `better-auth@1.4.18`
  - Implementation: Drizzle adapter with PostgreSQL backend
  - Session storage: Database tables (authSessions, authUsers, authAccounts, authVerifications)
  - Location: `server/src/auth/better-auth.ts`
  - Secret requirement: `BETTER_AUTH_SECRET` or `STAPLER_AGENT_JWT_SECRET` (minimum 32 characters recommended)
  - Trusted origins: Configured via `STAPLER_PUBLIC_URL` or `STAPLER_AUTH_PUBLIC_BASE_URL`
  - Trusted hostnames: Via `STAPLER_ALLOWED_HOSTNAMES` (comma-separated)

**Session Management:**

- JWT tokens via Better Auth
- Session validation middleware: `server/src/middleware/auth.ts`
- Cookie-based sessions for browser clients
- Custom bearer token support for API clients

## Secrets Management

**Storage:**

- **Local Encrypted** (default)
  - Provider: `STAPLER_SECRETS_PROVIDER=local_encrypted`
  - Key file: `~/.paperclip/secrets.key` (generated if missing)
  - Config key: `STAPLER_SECRETS_MASTER_KEY_FILE`
  - Encryption: AES-256 (managed by secrets service)
  - Location: `server/src/services/` (secrets service)

- **Strict Mode** (optional)
  - Config: `STAPLER_SECRETS_STRICT_MODE=true`
  - Behavior: Rejects any plaintext secrets

## Monitoring & Observability

**Error Tracking:**
- None detected - Application uses in-app error handling

**Logging:**

- **Pino Logger** (primary)
  - Package: `pino@9.14.0`
  - HTTP logging: `pino-http@10.4.0` - Middleware for Express
  - Pretty-printing: `pino-pretty@13.1.3` - Development console output
  - Location: `server/src/middleware/logger.ts`
  - Configuration: `LOG_LEVEL` env var (default: info)

- **Console Logging** (fallback)
  - Used in CLI and some services for direct output
  - Location: `cli/src/` commands

**Telemetry:**

- Basic telemetry support (optional, disabled by default)
- Configuration: `STAPLER_TELEMETRY_ENABLED` env var
- Location: `server/src/telemetry.ts`

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js application
- Can run on any platform supporting Node.js 20+
- Docker deployment possible (no official Dockerfile in codebase, but Express 5 compatible)

**CI Pipeline:**
- GitHub Actions (inferred from release scripts)
- Scripts location: `scripts/`
  - `scripts/release.sh` - Release automation
  - `scripts/build-npm.sh` - NPM package building
  - `scripts/create-github-release.sh` - GitHub release creation
  - `scripts/rollback-latest.sh` - Rollback support

**Release Channels:**
- Canary: `pnpm release:canary`
- Stable: `pnpm release:stable`
- NPM publishing via automated scripts

## Environment Configuration

**Critical Environment Variables:**

- `DATABASE_URL` - PostgreSQL connection string (optional if using embedded)
- `PORT` - Server port (default: 3100)
- `SERVE_UI` - Serve bundled UI from server (default: false)
- `BETTER_AUTH_SECRET` - Session auth secret (required for authenticated mode)
- `STAPLER_AGENT_JWT_SECRET` - Fallback auth secret

**Storage Configuration:**

- `STAPLER_STORAGE_PROVIDER` - "local_disk" or "s3" (default: local_disk)
- `STAPLER_STORAGE_LOCAL_DIR` - Local storage base directory
- `STAPLER_STORAGE_S3_BUCKET` - S3 bucket name
- `STAPLER_STORAGE_S3_REGION` - S3 region
- `STAPLER_STORAGE_S3_ENDPOINT` - Custom S3 endpoint (optional)
- `STAPLER_STORAGE_S3_PREFIX` - Key prefix in bucket
- `STAPLER_STORAGE_S3_FORCE_PATH_STYLE` - Force S3 path-style URLs

**Secrets Configuration:**

- `STAPLER_SECRETS_PROVIDER` - "local_encrypted" (default) or other providers
- `STAPLER_SECRETS_STRICT_MODE` - Enforce encrypted secrets only (default: false)
- `STAPLER_SECRETS_MASTER_KEY_FILE` - Path to encryption key

**Database Configuration:**

- `STAPLER_DATABASE_MODE` - "embedded-postgres" (default) or "postgres"
- Embedded Postgres:
  - `STAPLER_EMBEDDED_POSTGRES_DATA_DIR` - Data directory
  - `STAPLER_EMBEDDED_POSTGRES_PORT` - Port (default: varies)
  - `STAPLER_MIGRATION_AUTO_APPLY` - Auto-apply migrations on startup (default: true)
  - `STAPLER_MIGRATION_PROMPT` - Prompt for migration confirmation (default: ask)

**Networking Configuration:**

- `STAPLER_PUBLIC_URL` - Public-facing server URL
- `STAPLER_AUTH_PUBLIC_BASE_URL` - Auth-specific public URL
- `STAPLER_ALLOWED_HOSTNAMES` - Comma-separated allowed hostnames
- `STAPLER_BIND_MODE` - Binding strategy (localhost, tailnet, explicit)
- `STAPLER_TAILNET_BIND_HOST` - Tailscale bind address (if using tailnet mode)

**Feature Flags:**

- `STAPLER_HEARTBEAT_ENABLED` - Enable scheduled heartbeat service
- `STAPLER_COMPANY_DELETION_ENABLED` - Allow company deletion
- `STAPLER_TELEMETRY_ENABLED` - Enable telemetry (default: false)

**Feedback & Tracing:**

- `STAPLER_FEEDBACK_EXPORT_BACKEND_URL` - External feedback service endpoint
- `STAPLER_FEEDBACK_EXPORT_BACKEND_TOKEN` - Feedback service authentication token

**Secrets location:**
- Environment variables (`.env` or `~/.paperclip/.env`)
- Encrypted secrets stored in `~/.paperclip/` directory
- No secrets should be committed to version control

## Webhooks & Callbacks

**Incoming:**
- None detected in codebase

**Outgoing:**
- Feedback export to external backend (if configured)
  - Endpoint: `STAPLER_FEEDBACK_EXPORT_BACKEND_URL`
  - Token: `STAPLER_FEEDBACK_EXPORT_BACKEND_TOKEN`
- Database backup uploads (if S3 storage configured)

**Real-time Communication:**

- **WebSocket Server**
  - Package: `ws@8.19.0`
  - Server: `server/src/realtime/live-events-ws.ts`
  - Purpose: Live event streaming and real-time collaboration
  - Protocol: Custom event-based messaging
  - Features: Multi-board event broadcasting, user presence

## Database Schema & Models

**Core Tables:**
- `authUsers` - User accounts
- `authSessions` - Session records
- `authAccounts` - External account links (OAuth)
- `authVerifications` - Email/identity verification
- `companies` - Organization/workspace records
- `companyMemberships` - User-to-company relationships
- `instanceUserRoles` - User role assignments

**Generated Schema:**
- Drizzle ORM generates types from schema definition
- Location: `packages/db/src/` (schema definition)
- Generated files: Auto-generated type definitions

---

*Integration audit: 2026-04-13*
