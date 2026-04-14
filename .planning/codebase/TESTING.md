# Testing Patterns

**Analysis Date:** 2026-04-13

## Test Framework

**Runner:**
- Vitest 3.0.5
- Config: `ui/vitest.config.ts`, `cli/vitest.config.ts`
- Root config: workspace uses `vitest` command at monorepo level

**Assertion Library:**
- Vitest built-in expect API (same as Jest)

**Run Commands:**
```bash
pnpm test                    # Run all tests (watch mode)
pnpm test:run               # Run all tests (single run)
pnpm run preflight:workspace-links && vitest  # Full test with workspace link check
vitest --config ui/vitest.config.ts           # Run UI tests specifically
```

**Coverage:**
- Not currently tracked in default config
- No `--coverage` flag observed in scripts

## Test File Organization

**Location:**
- UI: co-located with source files (e.g., `ui/src/components/IssueChatThread.test.tsx`)
- CLI: centralized in `cli/src/__tests__/` directory with nested structure matching source (e.g., `cli/src/__tests__/common.test.ts`)
- ~265 test files across codebase

**Naming:**
- `.test.ts` for TypeScript/utility tests
- `.test.tsx` for React component tests
- Matches source filename exactly

**Structure:**
```
cli/src/__tests__/
├── agent-jwt-env.test.ts
├── company.test.ts
├── company-import-export-e2e.test.ts
└── helpers/                          # Shared test utilities

ui/src/
├── components/
│   ├── IssueChatThread.tsx
│   ├── IssueChatThread.test.tsx
│   ├── CommentThread.tsx
│   └── CommentThread.test.tsx
├── adapters/
│   ├── registry.ts
│   └── registry.test.ts
└── context/
    ├── LiveUpdatesProvider.tsx
    └── LiveUpdatesProvider.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("feature name", () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it("should do X when Y", () => {
    // Arrange
    // Act
    // Assert
  });

  it("should handle error case", () => {
    expect(() => badFunction()).toThrow();
  });
});
```

**Patterns:**
- Setup/teardown: `beforeEach`/`afterEach` for state reset, temp files, timers
- Test names: descriptive "should X when Y" format
- Inline comments separating Arrange/Act/Assert rare; structure kept clean

**Example from `cli/src/__tests__/common.test.ts`:**
```typescript
describe("resolveCommandContext", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STAPLER_API_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses profile defaults when options/env are not provided", () => {
    const contextPath = createTempPath("context.json");
    writeContext({ /* ... */ }, contextPath);
    const resolved = resolveCommandContext({ context: contextPath }, { requireCompany: true });
    expect(resolved.api.apiBase).toBe("http://127.0.0.1:9999");
  });
});
```

## Mocking

**Framework:** `vi` from vitest

**Patterns:**
```typescript
// Module mocking
vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Function mocking
const markdownEditorFocusMock = vi.fn();

// Hoisted mocks (above describes for use in vi.mock)
const { threadMessagesMock } = vi.hoisted(() => ({
  threadMessagesMock: vi.fn(() => <div data-testid="thread-messages" />),
}));
```

**What to Mock:**
- External component dependencies (UI libraries, third-party components)
- API calls (via `useQuery`, fetch)
- System APIs (navigator.clipboard, document methods)
- Child components in isolation tests
- Async operations (promises, timers)

**What NOT to Mock:**
- Hooks being tested directly
- Core component logic under test
- Utility functions (generally test directly)
- Validation logic

**Example from `ui/src/components/CommentThread.test.tsx`:**
```typescript
vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Setup navigation and system APIs
Object.assign(navigator, {
  clipboard: {
    writeText: writeTextMock,
  },
});
Object.defineProperty(window, "isSecureContext", {
  value: true,
  configurable: true,
});
```

## Fixtures and Factories

**Test Data:**
- Simple inline objects for test data (e.g., `Agent`, `Approval` fixtures)
- Helper functions for creating valid objects (e.g., `createTempPath()`)
- Reusable defaults at top of test files

**Example from `ui/src/adapters/registry.test.ts`:**
```typescript
const externalUIAdapter: UIAdapterModule = {
  type: "external_test",
  label: "External Test",
  parseStdoutLine: () => [],
  ConfigFields: () => null,
  buildAdapterConfig: () => ({}),
};

describe("ui adapter registry", () => {
  it("registers adapters", () => {
    registerUIAdapter(externalUIAdapter);
    expect(findUIAdapter("external_test")).toBe(externalUIAdapter);
  });
});
```

**Location:**
- Inline in test file if simple
- CLI tests: shared fixtures in `cli/src/__tests__/helpers/` if reused
- UI tests: mostly inline due to co-location

## React Component Testing

**Environment:**
- jsdom specified at top of component test files
- `// @vitest-environment jsdom` pragma required for DOM tests

**Setup:**
```typescript
// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { act } from "react";

describe("Component", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      );
    });
    expect(container.querySelector("[data-testid='x']")).toBeTruthy();
  });
});
```

**Async Testing:**
- `act()` wrapper required for state updates and effects
- Fake timers via `vi.useFakeTimers()` for time-dependent tests
- System time set: `vi.setSystemTime(new Date(...))`
- Real timers restored: `vi.useRealTimers()`

**Example from `ui/src/components/CommentThread.test.tsx`:**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("renders historical runs as timeline rows", () => {
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <CommentThread {...props} />
      </MemoryRouter>
    );
  });
});
```

**Error Testing:**
```typescript
it("logs error on render failure", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // ... trigger error
  expect(consoleErrorSpy).toHaveBeenCalled();
  consoleErrorSpy.mockRestore();
});
```

## Unit Test Examples

**API/Schema Validation (cli/src/__tests__/adapter-types.test.ts):**
```typescript
describe("dynamic adapter type validation schemas", () => {
  it("accepts external adapter types in create/update agent schemas", () => {
    expect(
      createAgentSchema.parse({
        name: "External Agent",
        adapterType: "external_adapter",
      }).adapterType,
    ).toBe("external_adapter");
  });

  it("rejects blank adapter types", () => {
    expect(() =>
      createAgentSchema.parse({
        name: "Blank Adapter",
        adapterType: "   ",
      }),
    ).toThrow();
  });
});
```

**Utility Function Tests:**
```typescript
describe("adapter metadata", () => {
  it("treats registered external adapters as enabled by default", () => {
    expect(isEnabledAdapterType("external_test")).toBe(true);
  });

  it("keeps intentionally withheld built-in adapters marked as coming soon", () => {
    expect(isEnabledAdapterType("process")).toBe(false);
  });
});
```

## Configuration Details

**Vitest UI Config (`ui/vitest.config.ts`):**
```typescript
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs"),
    },
  },
  test: {
    environment: "node",  // Note: overridden by @vitest-environment jsdom in component tests
  },
});
```

**Vitest CLI Config (`cli/vitest.config.ts`):**
```typescript
export default defineConfig({
  test: {
    environment: "node",
  },
});
```

**Root Workspace Test Command:**
```bash
pnpm test              # Runs vitest with workspace config
pnpm test:run          # Single run (CI mode)
```

## Coverage Approach

**Current State:** No explicit coverage targets or reporting configured in default setup

**Observed Coverage Patterns:**
- 265+ test files across codebase suggests significant coverage
- UI components tested via co-located `.test.tsx` files
- CLI commands tested via `__tests__/` suite
- Tests are source-control committed (not generated)

**To Add Coverage:**
```bash
vitest --coverage  # Would require @vitest/coverage-* package
```

## Test Types

**Unit Tests:**
- Pure functions: validators, utilities, formatters
- Scope: single function/module
- Approach: synchronous tests with mocked dependencies
- Examples: `adapter-types.test.ts`, `metadata.test.ts`

**Integration Tests:**
- Component + mocked child components
- API client + mocked fetch
- State management flows
- Examples: `CommentThread.test.tsx`, `common.test.ts` (command context resolution)

**E2E Tests:**
- Separate test suite: `tests/e2e/playwright.config.ts`
- Run via `pnpm test:e2e` (Playwright-based, not vitest)
- Not part of main test suite

## Common Patterns in Tests

**Temporary File Handling (CLI):**
```typescript
function createTempPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-"));
  return path.join(dir, name);
}

it("test", () => {
  const path = createTempPath("config.json");
  writeContext({...}, path);
  const result = resolveCommandContext({ context: path }, {});
  // assertions
});
```

**Environment Isolation:**
```typescript
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SECRET_VAR;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});
```

**Spy/Mock Restoration:**
```typescript
const spy = vi.spyOn(api, "method");
// test
spy.mockRestore();  // Important for isolation
```

---

*Testing analysis: 2026-04-13*
