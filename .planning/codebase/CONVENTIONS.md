# Coding Conventions

**Analysis Date:** 2026-04-13

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `IssueChatThread.tsx`, `CommentThread.tsx`)
- Tests: co-located with source, suffix `.test.ts` or `.test.tsx` (e.g., `IssueChatThread.test.tsx`)
- Utilities/helpers: camelCase (e.g., `utils.ts`, `queryKeys.ts`, `inbox.ts`)
- Directories: kebab-case for multi-word dirs (e.g., `components/`, `ui/src/pages/`, `__tests__/`)

**Functions:**
- camelCase for all functions and methods (e.g., `formatDateTime`, `buildInboxDismissedAtByKey`, `resolveCommandContext`)
- Utility functions often prefixed with action verbs: `format*`, `build*`, `resolve*`, `create*`, `list*`, `load*`, `save*`
- Custom React hooks: `use*` convention (e.g., `useInboxBadge`, `useLiveRunTranscripts`, `useDismissedInboxAlerts`)

**Variables:**
- camelCase for all variables (e.g., `companyId`, `dismissedAlerts`, `queryClient`)
- Boolean predicates: `is*`, `has*`, `can*` (e.g., `isEnabledAdapterType`, `hasOutputForRun`)
- Map/Set variables often named with descriptive suffixes: `dismissedAtByKey`, `feedbackVoteByTargetId`
- React state: standard `useState` pattern with `const [state, setState] = useState(...)` 

**Types:**
- PascalCase for interfaces and types (e.g., `IssueChatMessageContext`, `UIAdapterModule`, `CompanyImportOptions`)
- Interfaces used for object shapes; `type` aliases for unions, tuples, and complex types
- Generic type parameters: single letter (e.g., `<T>`) or descriptive (e.g., `<TData>`)

## Code Style

**Formatting:**
- No explicit linter/formatter config detected in root. Code follows TypeScript 5.7+ conventions
- Indentation: 2 spaces (observed in source files)
- Line length: no hard limit enforced; pragmatic wrapping observed
- Semicolons: always present (TypeScript default)

**Linting:**
- No global `.eslintrc` or `.prettierrc` found at root
- UI package uses Tailwind CSS with TypeScript strict mode
- Imports are ordered (external packages first, then internal modules, then relative)

## Import Organization

**Order:**
1. Node.js built-in modules (e.g., `import fs from "node:fs"`)
2. Third-party packages (e.g., `import { useState } from "react"`)
3. Internal workspace packages (e.g., `import type { Agent } from "@stapler/shared"`)
4. Relative imports from same package (e.g., `import { useDialog } from "../context/DialogContext"`)

**Path Aliases:**
- UI: `@/*` resolves to `./src/` (e.g., `import { Button } from "@/components/ui/button"`)
- CLI: No path aliases used; relative paths
- Shared: Standard imports with package name (e.g., `import { ... } from "@stapler/shared"`)

## Error Handling

**Patterns:**
- Custom error classes for specific error types: `ApiRequestError`, `ApiConnectionError` (in `cli/src/client/http.ts`)
- Error classes extend `Error` and include relevant context (status, message, details, URL, method)
- Try-catch blocks used for async operations; error type checking with `instanceof Error`
- Error messages formatted for user consumption (e.g., in check commands)
- Graceful degradation: catch blocks often return empty arrays or defaults on recoverable errors (e.g., `return []` for 401/403 in queries)

**Type narrowing in error handling:**
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  // Use message safely
}
```

**React error boundaries:** One error boundary found in `IssueChatThread.tsx` using class component with `componentDidCatch`

## Logging

**Framework:** console for UI; console and process output for CLI

**Patterns:**
- `console.error()` for errors (e.g., in plugin loader, failed requests)
- `console.warn()` for warnings with context prefixes (e.g., `[plugin-loader]`, `[adapter-ui-loader]`)
- `console.info()` for informational logs with context prefix
- No centralized logging service; console-based throughout
- CLI outputs user-facing messages via `@clack/prompts` (p.success, p.error, p.log)

**Example from `ui/src/adapters/dynamic-loader.ts`:**
```typescript
console.info(`[adapter-ui-loader] Loaded dynamic UI parser for "${adapterType}"`);
console.warn(`[adapter-ui-loader] Failed to load UI parser for "${adapterType}":`, err);
```

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic
- Business logic with context (e.g., "WSL2 /mnt/ drives don't support inotify — fall back to polling")
- TODO/FIXME for known issues (not extensively used)
- Type annotations preferred over comments for intent

**JSDoc/TSDoc:**
- Minimal usage observed
- Function signatures often include inline type comments for complex params
- React component props documented via TypeScript interfaces

## Function Design

**Size:** Functions typically 20–60 lines for utility functions, hooks often 30–100+ lines

**Parameters:**
- Named parameters in objects for >2 parameters (e.g., `{ companyId, apiKey, ...opts }`)
- Optional parameters with defaults in function signatures
- Type annotations always present (strict mode enabled)

**Return Values:**
- Explicit return types on function signatures
- React hooks return tuples (state/setter pairs) or objects with named properties
- Async functions return `Promise<T>` with explicit type parameter

**Example from `useInboxBadge`:**
```typescript
export function useInboxBadge(companyId: string | null | undefined) {
  // ... setup
  return useMemo(
    () => computeInboxBadgeData({ ... }),
    [approvals, joinRequests, dashboard, ...]
  );
}
```

## Module Design

**Exports:**
- Named exports preferred for utilities and components
- Default exports for React components (optional, both patterns used)
- Re-exports via barrel files (e.g., index.ts) for organizing API surface

**Barrel Files:**
- `ui/src/` has no explicit barrel; components imported individually
- CLI uses index.ts files to re-export public APIs

## React Patterns

**Component Structure:**
- Functional components with hooks (no class components except error boundaries)
- Props destructuring in function signatures
- Props interfaces defined above components (e.g., `IssueChatMessageContext`)

**State Management:**
- React Query (`@tanstack/react-query`) for server state
- Context API for UI state (`DialogContext`, `ThemeContext`, `CompanyContext`)
- Local useState for transient UI state
- Custom hooks for state logic reuse

**React Query Usage:**
```typescript
const { data: items = [] } = useQuery({
  queryKey: queryKeys.items(companyId!),
  queryFn: () => itemsApi.list(companyId!),
  enabled: !!companyId,
});

const mutation = useMutation({
  mutationFn: (newItem) => itemsApi.create(newItem),
  onMutate: async (newItem) => { /* optimistic update */ },
  onError: (error, variables, context) => { /* rollback */ },
  onSettled: () => { /* invalidate */ },
});
```

**Key patterns:**
- Conditional query enabling with `enabled: !!variable`
- Optimistic updates with `onMutate` + `queryClient.setQueryData`
- Proper cleanup/rollback in `onError` and `onSettled`

## Validation

**Zod schemas** used throughout (`packages/shared/src/config-schema.ts`):
- Config validation: `z.object()` with `.parse()` or `.safeParse()`
- Enum validation: `z.enum([...])` for string literals
- Optional/default values: `.optional()`, `.default()`
- Nested schemas: composed via `.merge()` or `.extend()`

**Example:**
```typescript
export const llmConfigSchema = z.object({
  provider: z.enum(["claude", "openai"]),
  apiKey: z.string().optional(),
});
```

---

*Convention analysis: 2026-04-13*
