# Technology Stack

**Analysis Date:** 2026-04-13

## Languages

**Primary:**
- TypeScript 5.7.3 - All source code (server, UI, CLI, packages)
- Node.js 20+ - Runtime requirement

**Secondary:**
- CSS (via Tailwind CSS 4.0.7) - UI styling
- SQL - Database migrations and queries

## Runtime

**Environment:**
- Node.js 20 or higher (specified in `package.json` engines)

**Package Manager:**
- pnpm 9.15.4
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

**Backend:**
- Express 5.1.0 - HTTP server and routing
  - Location: `server/src/app.ts`
- Better Auth 1.4.18 - Authentication framework with Drizzle adapter
  - Location: `server/src/auth/better-auth.ts`

**Frontend:**
- React 19.2.4 - UI component framework
  - Location: `ui/src/`
- Vite 6.1.0 - Build tool and dev server
  - Config: `ui/vite.config.ts`
- TailwindCSS 4.0.7 - Utility-first CSS framework
  - Config: `tailwind.config.ts`

**ORM/Database:**
- Drizzle ORM 0.38.4 - Type-safe SQL query builder
  - Location: `packages/db/src/`
  - Config: `packages/db/drizzle.config.ts`

**Testing:**
- Vitest 3.0.5+ - Unit and integration test runner
  - Config: `vitest.config.ts`
  - CLI: `pnpm test`, `pnpm test:run`
- Playwright 1.58.2 - End-to-end testing
  - E2E Config: `tests/e2e/playwright.config.ts`
  - Release smoke tests: `tests/release-smoke/playwright.config.ts`

**Build & Dev:**
- TypeScript 5.7.3 - Type checking and compilation
- tsx 4.21.0 - TypeScript Node.js runtime
- esbuild 0.27.3 - Fast bundler (used for CLI builds)
- Rollup 4.60.1 - Module bundler (with TypeScript plugin)
- Vite 7.3.1 - (alternate version in some packages)

## Key Dependencies

**Critical Infrastructure:**
- postgres 3.4.5 - PostgreSQL client for direct connections
- embedded-postgres 18.1.0-beta.16 - Embedded PostgreSQL instance (patched)
  - Patch: `patches/embedded-postgres@18.1.0-beta.16.patch`
  - Used for zero-configuration database setup

**Storage & File Handling:**
- @aws-sdk/client-s3 3.888.0 - S3 file storage support
- sharp 0.34.5 - Image processing and resizing
- multer 2.1.1 - Multipart form data handling

**Authentication & Security:**
- better-auth 1.4.18 - Session and auth management
- bcrypt (via better-auth) - Password hashing
- dotenv 17.0.1 - Environment variable loading
- zod 3.24.2 - Schema validation (runtime type checking)

**Validation & Schemas:**
- ajv 8.18.0 - JSON Schema validation
- ajv-formats 3.0.1 - Extended format support for ajv

**Real-time Communication:**
- ws 8.19.0 - WebSocket server and client
- @types/ws 8.18.1 - TypeScript definitions for ws

**Logging & Observability:**
- pino 9.14.0 - High-performance logging
- pino-http 10.5.0 - HTTP request logging middleware
- pino-pretty 13.1.3 - Pretty-print pino logs

**UI Components & Markdown:**
- @assistant-ui/react 0.12.23 - AI assistant UI components
- @mdxeditor/editor 3.52.4 - MDX editor component
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.1 - GitHub-flavored markdown support
- lexical 0.35.0 - Headless text editor (Rich Text Editor foundation)
- @lexical/link 0.35.0 - Lexical link plugin

**UI Utilities & Styling:**
- @dnd-kit/core 6.3.1 - Drag-and-drop foundation
- @dnd-kit/sortable 10.0.0 - Sortable components
- @dnd-kit/utilities 3.2.2 - DnD utilities
- radix-ui 1.4.3 - Unstyled accessible UI components
- @radix-ui/react-slot 1.2.4 - Slot composition primitive
- class-variance-authority 0.7.1 - Variant pattern library
- clsx 2.1.1 - Classname utility
- tailwind-merge 3.4.1 - Merge Tailwind classes intelligently
- lucide-react 0.574.0 - Icon library
- cmdk 1.1.1 - Command menu component

**Data Fetching:**
- @tanstack/react-query 5.90.21 - Server state management and caching

**Diagram & Visualization:**
- mermaid 11.12.0 - Diagram generation from text

**Routing:**
- react-router-dom 7.1.5 - Client-side routing

**Adapter-specific:**
- hermes-paperclip-adapter 0.2.0 - Adapter for Hermes-based agents (in server and ui packages)

**Dev Dependencies:**
- @types/node 24.6.0+ - Node.js type definitions (varies by package)
- @types/react 19.2.14 - React type definitions
- @types/react-dom 19.0.3 - React DOM type definitions
- @types/express 5.0.0 - Express type definitions
- cross-env 10.1.0 - Cross-platform env var setting

## Configuration

**Environment:**
- Loads from `.env` (working directory) and `~/.paperclip/.env` (home directory)
- Configuration can be overridden via environment variables
- Required for production: `BETTER_AUTH_SECRET` (or `PAPERCLIP_AGENT_JWT_SECRET`)

**Critical Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (optional if using embedded)
- `PORT` - Server port (default: 3100)
- `SERVE_UI` - Whether to serve the bundled UI (default: false)
- `BETTER_AUTH_SECRET` - Authentication secret (required for authenticated mode)
- `PAPERCLIP_STORAGE_PROVIDER` - Storage backend (local_disk or s3)
- `PAPERCLIP_STORAGE_LOCAL_DIR` - Local storage directory
- `PAPERCLIP_STORAGE_S3_BUCKET` - S3 bucket name
- `PAPERCLIP_STORAGE_S3_REGION` - S3 region
- `PAPERCLIP_SECRETS_PROVIDER` - Secrets storage (local_encrypted or others)
- `PAPERCLIP_SECRETS_MASTER_KEY_FILE` - Path to secrets encryption key

**Build Configuration:**
- TypeScript: `tsconfig.json` at root and in key packages
  - Root: `tsconfig.json`
  - Server: `server/tsconfig.json`
  - UI: `ui/tsconfig.json`
  - Database: `packages/db/tsconfig.json`
  - CLI: `cli/tsconfig.json`
- Workspace: `pnpm-workspace.yaml`

## Monorepo Structure

**Root Package Manager Config:**
- `pnpm-workspace.yaml` - Defines workspace packages

**Workspace Packages:**
- `packages/*` - Shared packages and adapters
- `packages/adapters/*` - LLM adapter implementations
- `packages/plugins/*` - Plugin system packages
- `packages/plugins/examples/*` - Example plugins
- `server/` - Main backend server
- `ui/` - Frontend React application
- `cli/` - Command-line interface

**Adapter Packages:**
- `@paperclipai/adapter-claude-local` - Anthropic Claude integration
- `@paperclipai/adapter-gemini-local` - Google Gemini integration
- `@paperclipai/adapter-ollama-local` - Ollama (local LLM) integration
- `@paperclipai/adapter-pi-local` - Pi AI integration
- `@paperclipai/adapter-opencode-local` - OpenCode integration
- `@paperclipai/adapter-codex-local` - Codex integration
- `@paperclipai/adapter-cursor-local` - Cursor integration
- `@paperclipai/adapter-openclaw-gateway` - OpenClaw Gateway integration
- `@paperclipai/adapter-utils` - Shared adapter utilities

**Core Packages:**
- `@paperclipai/db` - Database schemas, migrations, and initialization
- `@paperclipai/shared` - Shared types and utilities
- `@paperclipai/server` - Express server
- `@paperclipai/ui` - React frontend
- `@paperclipai/plugin-sdk` - Plugin development SDK

## Platform Requirements

**Development:**
- Node.js 20+
- pnpm 9.15.4+
- TypeScript 5.7.3+
- macOS/Linux/Windows (with cross-env for cross-platform commands)

**Production:**
- Node.js 20+ runtime
- PostgreSQL 12+ (or embedded-postgres for zero-config)
- AWS S3 (optional, for S3 storage backend)
- Internet connection for external adapter APIs (Claude, Gemini, etc.)

**Browser Support (UI):**
- Modern browsers supporting ES2020+ (Vite default)
- WebSocket support required for real-time features

---

*Stack analysis: 2026-04-13*
