# Upgrade 5 Most Underdeveloped Areas of Mutly

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. TDD: write failing test → implement → pass → commit. Each upgrade is an independent work unit — parallel execution is safe.

**Goal:** Transform Mutly's 5 weakest areas into production-grade subsystems, inspired by OpenCode's GSD SDK patterns (typed event bus, phase-aware context engine, tool scoping, markdown-aware context truncation, cost-tracked sessions).

**Architecture (cross-cutting patterns from OpenCode SDK):**
- **Event-driven observability** — typed `GSDEventStream` pattern (OpenCode's `event-stream.js`) extended to emit OpenTelemetry spans/metrics alongside audit events
- **Phase-aware tool scoping** — OpenCode's `tool-scoping.js` per-phase tool allow/deny lists mapped to Mutly's `toolRegistry`
- **Markdown-aware context truncation** — OpenCode's `context-truncation.js` for large planning files, applied to Mutly's context engine
- **Cost-budgeted research gate** — OpenCode's `research-gate.js` budget check before expensive LLM calls
- **Config-driven phase runner** — OpenCode's `phase-runner.js` state machine pattern applied to Mutly's build pipeline

**Tech Stack:** TypeScript, Node.js, vitest, @opentelemetry/*, Inngest, Google GenAI, pino

---

## Upgrade 1: Vector/Semantic Search Engine (RAG Pipeline)

**Problem:** `server/vectorEngine.ts` is 26 lines of pure math utilities (`dotProduct`, `magnitude`, `cosineSimilarity`). The actual embedding generation is embedded inline in `agentDaemon.ts` (~1100+ lines), making it impossible to test, reuse, or optimize independently. There's no vector store, no semantic cache, no chunking strategy.

**OpenCode Inspiration:** OpenCode's `context-engine.js` resolves per-phase file manifests with truncation strategies. Similarly, Mutly needs a proper VectorEngine that manages embeddings, stores, and retrieval as first-class abstractions.

**Files to create/modify:**
- `server/vectorEngine.ts` → Rewrite: add embedding service, chunking, store, search, semantic cache
- `server/vectorEngine.test.ts` → New: unit + integration tests
- `server/agentDaemon.ts` → Refactor: extract inline embedding calls to new VectorEngine

**Implementation plan:**

### 1.1 VectorEngine Core (server/vectorEngine.ts — rewrite)

- [ ] **Design the VectorEngine interface:**
  - `embed(text: string): Promise<number[]>` — single text embedding via Google GenAI
  - `embedChunks(texts: string[]): Promise<EmbeddingChunk[]>` — batch embedding
  - `chunkDocument(text: string, options?: ChunkOptions): string[]` — configurable chunking
  - `search(query: string, topK?: number): Promise<SearchResult[]>` — cosine similarity search
  - `store(meta: FileEmbeddingMeta): Promise<void>` — persist to embeddings.json
  - `load(): Promise<FileEmbeddingMeta[]>` — load from store

- [ ] **Implement chunking strategy:**
  - Default: recursive character split at 512 tokens with 64-token overlap
  - Configurable via `ChunkOptions` (maxTokens, overlap, strategy: 'recursive' | 'sentence' | 'paragraph')
  - Pure function → easily testable

- [ ] **Implement embedding service:**
  - Use `GoogleGenAI` models (`models.embedContent`) — already a dependency
  - Cache embeddings in-memory Map<textHash, number[]> for duplicate detection
  - Batch multiple texts into single API call
  - Pure function contract: `embed(text) => Promise<number[]>`, testable with mock

- [ ] **Implement vector store:**
  - File-based storage in `embeddings.json` (matching the existing skip pattern in `scanWorkspace`)
  - Load on startup, incremental append on store()
  - Lazy-load with `load()` — don't block startup
  - Mutation-safe: write to tmp file, rename

- [ ] **Implement search with scoring:**
  - Embed query → cosine similarity against all stored chunks
  - Return top K results with score, filePath, text snippet
  - Optional threshold filter (min similarity score)

- [ ] **Implement semantic cache:**
  - Map<queryHash, { result: SearchResult[]; cachedAt: number }>
  - TTL-based invalidation (configurable, default 5 minutes)
  - LRU eviction at max 100 entries
  - Skipped entirely if `NODE_ENV=test` or explicit disable

### 1.2 Extract from agentDaemon.ts

- [ ] **Find and extract inline embedding calls in agentDaemon.ts:**
  - Grep for `cosineSimilarity`, `embed`, any AI embed call
  - Extract into VectorEngine methods
  - Replace with `vectorEngine.embed(...)` / `vectorEngine.search(...)`

### 1.3 Tests (server/vectorEngine.test.ts — new)

- [ ] **Unit tests:**
  - `chunkDocument()` with various sizes, overlap, strategies
  - `cosineSimilarity()` edge cases (zero vectors, identical, opposite)
  - `dotProduct()` and `magnitude()` edge cases
  - Semantic cache hit/miss, TTL expiry, LRU eviction

- [ ] **Integration tests:**
  - `embed()` with mock Google GenAI client
  - `store()` and `load()` round-trip with temp file
  - `search()` returns correctly ranked results

---

## Upgrade 2: Observability & Tracing (OpenTelemetry Wire-Up)

**Problem:** `server/observability/traceContext.ts` is 26 lines providing `AsyncLocalStorage` context but zero OpenTelemetry wiring. `server/lib/otelBootstrap.ts` (25 lines) only starts if `OTEL_EXPORTER_OTLP_ENDPOINT` is set — no auto-instrumentation, no metrics, no span propagation. The audit system (`auditTypes.ts`, `auditService.ts`) is strong but disconnected from traces.

**OpenCode Inspiration:** OpenCode's `GSDEventStream` extends `EventEmitter` with typed events, multiple transports (CLI, file), and cost tracking. Mutly should adopt a similar typed event bus pattern that simultaneously emits to: (a) OpenTelemetry spans, (b) audit log, (c) console output, (d) optional OTLP exporter.

**Files to create/modify:**
- `server/observability/traceContext.ts` → Rewrite: add span management, metric recording
- `server/observability/traceContext.test.ts` → New
- `server/observability/metrics.ts` → New: typed metric definitions
- `server/observability/internalEvents.ts` → New: typed event bus (OpenCode-inspired)
- `server/lib/otelBootstrap.ts` → Rewrite: always-initialized with local exporter fallback
- `server/agentDaemon.ts` → Add span wrapping around key operations

**Implementation plan:**

### 2.1 Typed Internal Event Bus (server/observability/internalEvents.ts — new)

- [ ] **Define MutlyEventType enum:**
  ```typescript
  export enum MutlyEventType {
    WorkflowStart = 'workflow.start',
    WorkflowComplete = 'workflow.complete',
    WorkflowError = 'workflow.error',
    PhaseTransition = 'phase.transition',
    ToolExecution = 'tool.execution',
    EmbeddingRequest = 'embedding.request',
    SearchQuery = 'search.query',
    ApprovalRequested = 'approval.requested',
    ApprovalResolved = 'approval.resolved',
    MemoryAccess = 'memory.access',
  }
  ```

- [ ] **Define typed event payloads:**
  ```typescript
  export interface MutlyEventPayload {
    [MutlyEventType.WorkflowStart]: { workflowId: string; planId: string; traceId: string };
    [MutlyEventType.PhaseTransition]: { from: string; to: string; workflowId: string };
    [MutlyEventType.ToolExecution]: { tool: string; durationMs: number; success: boolean };
    // ... etc per type
  }
  ```

- [ ] **Implement MutlyEventBus:**
  - Extends `EventEmitter` (like OpenCode's `GSDEventStream`)
  - `emit<T extends MutlyEventType>(type: T, payload: MutlyEventPayload[T])` — emits to all transports
  - Transport interface: `{ handle(event): void }`
  - Built-in transports: `OtelTransport` (spans), `AuditTransport` (audit log), `ConsoleTransport` (structured log), `OtlpTransport` (remote exporter, if configured)
  - No-op when no transports registered (test-friendly)

### 2.2 Rewrite TraceContext (server/observability/traceContext.ts)

- [ ] **Add span management:**
  - `startSpan(name: string, options?: SpanOptions): Span` — creates and activates a span
  - `endSpan(span: Span, error?: Error): void` — ends span with optional error recording
  - Wraps `AsyncLocalStorage` to maintain parent-child span hierarchy
  - Each span automatically records: duration, traceId, spanId, parentSpanId

- [ ] **Add metric recording:**
  - `recordMetric(name: string, value: number, attributes?: Record<string, string>): void`
  - Backed by OpenTelemetry `Meter` if available, otherwise in-memory counter
  - Key metrics: `tool.execution.duration`, `embedding.latency`, `search.latency`, `workflow.duration`

- [ ] **Keep backward compatibility:**
  - `createTraceId()` → still works, delegates to OpenTelemetry
  - `runWithTrace()` → still works, creates root span
  - `getTraceContext()` → still works, returns current span context

### 2.3 Rewrite otelBootstrap.ts

- [ ] **Always initialize (not conditional):**
  - When `OTEL_EXPORTER_OTLP_ENDPOINT` is set: full OTLP exporter with BatchSpanProcessor
  - When not set: `ConsoleSpanExporter` + in-memory metric store (dev mode)
  - Auto-instrument `http`, `fs`, `child_process` via `getNodeAutoInstrumentations()`
  - Graceful shutdown on `SIGTERM` / `SIGINT`

### 2.4 Wrap agentDaemon.ts key operations

- [ ] **Add span wrapping around:**
  - `executeAllSteps()` → root span per execution
  - `executeStep()` → child span per step
  - Tool calls → `tool.execution.duration` histogram
  - Embedding/search calls → latency recording

### 2.5 Tests

- [ ] `traceContext.test.ts`: span hierarchy, parent-child, error recording, metric recording
- [ ] `internalEvents.test.ts`: emit-to-transport routing, typed payload validation
- [ ] `otelBootstrap.test.ts`: conditional initialization, graceful shutdown

---

## Upgrade 3: Background Jobs (Inngest Expansion)

**Problem:** `server/inngest/client.ts` is 6 lines. `server/inngest/functions.ts` has exactly 1 function (`mutlyWorkflowStart`) — it works well but there's no scheduled maintenance jobs, no retry-cascading, no event-driven triggers beyond the main workflow.

**Files to create/modify:**
- `server/inngest/functions.ts` → Expand: add periodic maintenance, event-driven tools
- `server/inngest/client.ts` → Minor: add retry defaults
- `server/inngest/periodicJobs.ts` → New: scheduled maintenance functions
- `server/inngest/eventDrivenJobs.ts` → New: reactive job triggers
- `server/inngest/inngest.test.ts` → New: integration tests

**Implementation plan:**

### 3.1 Add retry defaults to client.ts

- [ ] Set `retries: { default: 3, minTimeout: 1000, maxTimeout: 30000 }` on the Inngest client

### 3.2 Scheduled periodic jobs (server/inngest/periodicJobs.ts — new)

- [ ] **`mutlyPeriodicContextPrune`** — daily cron: prune old context/embeddings cache
  - Trigger: `{ cron: '0 3 * * *' }` (daily 3 AM)
  - Steps: clean stale embeddings (>7 days), compact audit log, log prune event

- [ ] **`mutlyPeriodicHealthCheck`** — hourly: verify daemon health
  - Trigger: `{ cron: '0 * * * *' }`
  - Steps: check workspace exists, check db.json readable, emit health metric
  - On failure: emit `mutly/workflow.error` event

- [ ] **`mutlyPeriodicEmbeddingRefresh`** — hourly: re-embed changed files
  - Trigger: `{ cron: '30 * * * *' }`
  - Steps: check `mtimeMs` on all workspace files, re-embed changed-only, update store

### 3.3 Event-driven jobs (server/inngest/eventDrivenJobs.ts — new)

- [ ] **`mutlyOnToolError`** — reacts to tool execution errors
  - Trigger: `{ event: 'mutly/tool.error' }`
  - Steps: classify error severity, auto-retry transient errors, escalate permanent ones

- [ ] **`mutlyOnApprovalTimeout`** — reacts to expired approvals
  - Trigger: `{ event: 'mutly/approval.expired' }`
  - Steps: cancel workflow, rollback partial changes, notify user

- [ ] **`mutlyOnMemoryChange`** — reacts to memory/settings changes
  - Trigger: `{ event: 'mutly/memory.changed' }`
  - Steps: clear semantic cache, re-index affected files

### 3.4 Wire events into the new EventBus

- [ ] When `MutlyEventBus` emits `WorkflowComplete` / `ToolExecution` / `ApprovalResolved`, translate to Inngest events automatically via a transport adapter

### 3.5 Tests

- [ ] `inngest.test.ts`: mock Inngest client, verify each function registers correct trigger
- [ ] Test periodic job step sequences
- [ ] Test error classification in `mutlyOnToolError`

---

## Upgrade 4: Frontend Component Robustness

**Problem:** 14 React components in `src/components/` — many are decorative UI shells with hardcoded/mock data (Kairos: 124 lines, AutoDream: 172 lines, Injector: 112 lines, Specs: 83 lines). No loading states beyond a single `if (!agentState) return null`. No error boundaries. Only 1 frontend test file (`App.test.tsx`).

**Files to create/modify:**
- `src/components/Kairos.tsx` → Add loading/error/empty states
- `src/components/AutoDream.tsx` → Add loading/error/empty states
- `src/components/Injector.tsx` → Add loading/error/empty states
- `src/components/Specs.tsx` → Add loading/error/empty states
- `src/components/BuildPipeline.tsx` → Add loading/error/empty states
- `src/components/CodeAuditor.tsx` → Add loading/error/empty states
- `src/components/UltraPlan.tsx` → Add loading/error/empty states
- `src/components/Memory.tsx` → Add loading/error/empty states
- `src/hooks/useAgentState.ts` → New: generic data-fetching hook with loading/error
- `src/hooks/useWorkflow.ts` → New: workflow-specific hook
- `src/components/ErrorBoundary.tsx` → New: global error boundary
- `src/components/LoadingSkeleton.tsx` → New: reusable skeleton component
- `src/components/EmptyState.tsx` → New: reusable empty state component
- `tests/components/` — New directory for component tests

**Implementation plan:**

### 4.1 Reusable primitives (new files)

- [ ] **ErrorBoundary.tsx**:
  - Class component wrapping `componentDidCatch`
  - Props: `fallback?: ReactNode`, `onError?: (error: Error) => void`
  - Default fallback: styled "something went wrong" with retry button
  - Logs errors to `console.error` and ideally to MutlyEventBus

- [ ] **LoadingSkeleton.tsx**:
  - Props: `variant: 'card' | 'list' | 'text' | 'chart'`, `count?: number`
  - Renders animated pulse skeletons matching component layout
  - Accessible: `aria-busy="true"`, `role="status"`

- [ ] **EmptyState.tsx**:
  - Props: `icon?: ReactNode`, `title: string`, `description?: string`, `action?: { label: string; onClick: () => void }`
  - Centered layout with muted styling

### 4.2 Custom hooks (new files)

- [ ] **useAgentState.ts**:
  - Fetches from `/api/state` endpoint
  - Returns `{ data: FullState | null; loading: boolean; error: Error | null; refetch: () => void }`
  - Auto-refetch interval (configurable, default 30s)
  - Abort controller cleanup on unmount

- [ ] **useWorkflow.ts**:
  - Fetches from `/api/workflow/:id`
  - Same return shape with loading/error/refetch

### 4.3 Upgrade each component with state management

For each component, apply the following pattern:

- [ ] **Loading state**: Render `<LoadingSkeleton variant="..."/>` when `loading === true`
- [ ] **Error state**: Render error message with retry button when `error !== null`
- [ ] **Empty state**: Render `<EmptyState>` when data is null/empty after loading
- [ ] **Data state**: Existing render wrapped in try-catch boundaries as needed

Components to upgrade (7):
- `Kairos.tsx` — add loading skeleton matching the 3-card grid layout
- `AutoDream.tsx` — add loading skeleton matching its form/timeline layout
- `Injector.tsx` — add loading/empty for IDE integration list
- `Specs.tsx` — add loading/error/empty for spec document list
- `BuildPipeline.tsx` — add loading/error for pipeline status
- `CodeAuditor.tsx` — add loading/error for audit results
- `UltraPlan.tsx` — add loading skeleton matching its plan visualization
- `Memory.tsx` — add loading skeleton matching memory context list
- `Dashboard.tsx` — use `useAgentState` hook, add loading/error to stat cards

### 4.4 Tests

- [ ] `tests/components/ErrorBoundary.test.tsx` — renders fallback on thrown error
- [ ] `tests/components/LoadingSkeleton.test.tsx` — renders correct variant DOM
- [ ] `tests/components/EmptyState.test.tsx` — renders title + optional action
- [ ] `tests/hooks/useAgentState.test.ts` — mock fetch, verify loading/error/data states
- [ ] `tests/components/Kairos.test.tsx` — loading, error, empty, and data renders
- [ ] `tests/components/Dashboard.test.tsx` — loading, error, and data renders

---

## Upgrade 5: Testing Infrastructure (Coverage & Patterns)

**Problem:** ~35 test files for 100+ source files (roughly 35% coverage). Only 1 frontend test. No component tests. Integration tests exist but are ad-hoc. No coverage targets enforced. No test patterns documented.

**OpenCode Inspiration:** The GSD SDK uses a typed contract pattern where tests verify against interfaces, not implementations. Mutly should adopt the same: interface-based mocking, structured test fixtures, and per-module coverage targets.

**Files to create/modify:**
- `vitest.config.ts` → Add coverage thresholds
- `tests/setup.ts` → Add global mocks (GoogleGenAI, Inngest, fs)
- `tests/setup.dom.ts` → Add DOM environment config
- `tests/__fixtures__/` → New: shared test fixtures
- `tests/__mocks__/` → New: centralized mocks
- Various new test files to reach coverage targets

**Implementation plan:**

### 5.1 Configure coverage thresholds (vitest.config.ts)

- [ ] Set minimum thresholds:
  - Branches: 60%
  - Functions: 65%
  - Lines: 70%
  - Statements: 70%
- [ ] Exclude: `dist/`, `node_modules/`, `tests/`, `*.config.*`, `*.d.ts`

### 5.2 Move to interface-based mocking

- [ ] **`tests/__mocks__/googleGenAI.ts`** — Mock `GoogleGenAI` client:
  - `embedContent` returns deterministic embedding
  - Throw on `fail: true` flag for error testing

- [ ] **`tests/__mocks__/inngest.ts`** — Mock Inngest client:
  - `createFunction` returns function registration object
  - `send` records events for assertion

- [ ] **`tests/__mocks__/fs.ts`** — Mock `fs` operations via `vitest-mock-fs` or manual:
  - `readFileSync`, `writeFileSync`, `existsSync`, `statSync`, `readdirSync`

### 5.3 Shared fixtures (tests/__fixtures__/)

- [ ] **`embeddingFixtures.ts`** — Pre-computed test embeddings, sample documents, chunk results
- [ ] **`workflowFixtures.ts`** — Sample `ExecutionPlan` objects, workflow states, approval requests
- [ ] **`componentFixtures.ts`** — Sample `FullState` objects for component rendering tests

### 5.4 New test files

- [ ] **`tests/server/vectorEngine.test.ts`** (from Upgrade 1) — 10+ tests
- [ ] **`tests/server/observability/traceContext.test.ts`** (from Upgrade 2) — 8+ tests
- [ ] **`tests/server/observability/internalEvents.test.ts`** (from Upgrade 2) — 6+ tests
- [ ] **`tests/server/inngest/inngest.test.ts`** (from Upgrade 3) — 6+ tests
- [ ] **`tests/server/inngest/periodicJobs.test.ts`** (from Upgrade 3) — 4+ tests
- [ ] **`tests/components/*.test.tsx`** (from Upgrade 4) — 8+ tests
- [ ] **`tests/server/lib/logger.test.ts`** — 4+ tests (redaction, level filtering)
- [ ] **`tests/server/audit/auditService.test.ts`** — 4+ tests (append, list, get)

### 5.5 Build Pipeline tests

The integration tests exist in `tests/integration/` (40 files) but many read production config. Add:

- [ ] **Isolated pipeline tests** — mock all external dependencies, verify step sequencing
- [ ] **Error recovery tests** — simulate step failure, verify retry/recovery logic

---

## Dependency Graph & Parallel Execution

```
Upgrade 1 (Vector) ─────────────────────────────────────┐
                                                         │
Upgrade 2 (Observability) ───── independent ─────────────┤
                                                         ├── all independent
Upgrade 3 (Background Jobs) ─── independent ────────────┤
                                                         │
Upgrade 4 (Frontend) ─────────── independent ────────────┤
                                                         │
Upgrade 5 (Testing) ─────────── depends on 1-4 fixtures ─┘
```

All 5 upgrades are fully independent and can be executed in parallel. Upgrade 5 (testing) benefits from the new modules created in 1-4 for coverage, but can also focus on existing uncovered code while 1-4 are in progress.

---

## Anti-Pattern Catalog (things to avoid)

### From Mutly's current codebase:
1. **Monolithic agentDaemon.ts (1100+ lines)** — Do NOT add more inline logic here. Create separate modules.
2. **Decorative UI shells** — Every component must handle loading/error/empty + data states.
3. **Disconnected observability** — Every subsystem should emit events/spans; never console.log directly.
4. **Fragile string-matching** — Use typed events and interfaces (like `auditTypes.ts`), not string enums.
5. **No test for new code** — Every new file must have a corresponding `.test.ts` file.

### From OpenCode patterns:
6. **No side effects in state machines** — Pure functions for phase logic, I/O only at boundaries.
7. **No bare console.log** — Use the event bus / logger everywhere.
8. **No hardcoded timeouts** — Make TTLs, retry windows, and intervals configurable.
9. **No unstructured errors** — Use typed error classes (like OpenCode's `PhaseRunnerError`).

---

## Success Criteria

1. **VectorEngine**: `embed()`, `search()`, `store()`, `load()`, `chunkDocument()` all independently tested and working. Inline embedding calls extracted from `agentDaemon.ts`.
2. **Observability**: Spans created for every major operation, metrics recorded, EventBus emitting to configured transports. Bootstrap works always (dev fallback).
3. **Background Jobs**: 3+ periodic functions, 2+ event-driven functions, retry-cascading from `mutlyOnToolError`.
4. **Frontend Components**: Every component renders 4 states (loading/error/empty/data). ErrorBoundary catches crashes. 8+ component tests passing.
5. **Testing Infrastructure**: Coverage thresholds enforced, 25+ new tests, interface-based mocks, shared fixtures.

## Verification

After all upgrades:
```bash
npx vitest run --coverage          # Verify coverage thresholds
npx tsc --noEmit                   # Verify TypeScript compilation
npx eslint src/ server/             # Verify lint
cat coverage-summary.json           # Review coverage
```
