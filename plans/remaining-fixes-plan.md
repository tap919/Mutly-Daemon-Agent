# Remaining Fixes Plan — Deep Clean

**Date:** June 9, 2026  
**Scope:** 46 remaining issues across Mutly (11), VibeServe (16), RepoRank (19)  
**Execution:** 3 phases — Quick Fixes → Medium Impact → Architectural Refactors

---

## Classification

| Priority | Count | Description | Effort |
|----------|-------|-------------|--------|
| **P0: Quick Fix** | 20 | 1-file change, 5 min each, no design decisions | ~2 hours |
| **P1: Medium** | 16 | Multi-file or needs some thought, 15 min each | ~4 hours |
| **P2: Architecture** | 10 | Multi-module refactor, 30-60 min each | ~6 hours |

---

## Phase 1: Quick Fixes (P0 — 1 file, 5 min each)

### Mutly (6 x 5min)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | `ctx.exitCode` never updated | `planCommand.ts:67` | Set `ctx.exitCode = 0` on success, `= 1` on failure before calling `onComplete` |
| 2 | `getAi()` new client each call | `agentDaemon.ts:129` | Memoize: cache `_aiClient`, create once, recreate if apiKey changes |
| 3 | Cycle error only shows first stuck node | `dagTopoSort.ts:92` | Find the actual cycle via DFS/BFS from stuck node; report full path |
| 4 | Hardcoded paths at module scope | `agentDaemon.ts:28-30` | Lazy-resolve in a getter: `getDbPath()` instead of module-level `const` |
| 5 | Score boundaries at 0 and 2 | `modelRouter.ts:88` | Document boundary behavior, add comment about edge cases |
| 6 | `sha256File` uses sync I/O | `provenance.ts:41` | Add async variant `sha256FileAsync()`, note sync variant for non-blocking callers |

### VibeServe (7 x 5min)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 7 | Orphaned `CONTENT_GUIDELINES` | `vibe_architect.py:9` | Remove constant if unused; if referenced elsewhere, move to a constants module |
| 8 | `time.time()` float→int truncation | `auth.py:39` | No change needed — this is standard JWT practice. Just add a comment |
| 9 | `LocalProvider._client` dead code | `providers.py:225` | Remove the unused `self._client` assignment and `__init__` logic for it |
| 10 | No tool suggestion on "Unknown tool" | `http_bridge.py:88` | Return available tool names in the error message: `f"Unknown tool '{name}'. Available: {sorted(MUTLY_HTTP_TOOLS.keys())[:10]}"` |
| 11 | `__tests__` excluded from compilation | `ts_bridge/tsconfig.json` | Remove `__tests__` from `exclude` array, or exclude from `include` |
| 12 | `algorithms` ignored in `decode_jwt` | `auth.py:47` | Validate the `algorithms` param: check `algorithms` is `["HS256"]` and raise if caller passes anything else |
| 13 | HTML parsed with regex | `verify.py:41` | Replace `re.findall("<section\\b")` with Python's `html.parser` for tag counting |

### RepoRank (7 x 5min)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 14 | Git undeclared for fix-pack-generator | `packages/fix-pack-generator/package.json` | Add `"git"` to `peerDependenciesMeta` or add error message in CLI when git missing |
| 15 | Flags `e` as naming smell | `code-hygiene.ts:327` | Add `"e"` to the allowlist `["i","j","k","x","y","n","e"]` |
| 16 | Misses `debugger` on lines 1-5 | `code-hygiene.ts:185` | Remove the `i > 5` guard entirely — `debugger` is always a smell |
| 17 | URL regex misses multi-part TLDs | `enterprise.ts:462` | Replace `\.[a-z]+` with `\.[a-z]{2,}(?:\.[a-z]{2,})*` |
| 18 | Archetype detection substring matching | `architecture.ts:164` | Use `file.some(p => p.includes("src/components/"))` instead of `allFiles.includes("src/components/")` on a concatenated string |
| 19 | Non-null assertion risky | `scans.ts:121` | Replace `scan.overallScore!` with `(scan.overallScore ?? 0)` |
| 20 | Hardcoded relative path to CLI | `quality-gate.mjs:47` | Add `--cli-path` as required when running outside repo; document in comments |

---

## Phase 2: Medium Impact (P1 — 15 min each)

### Mutly (5 x 15min)

| # | Issue | File(s) | Fix |
|---|-------|---------|-----|
| 21 | `routeTask` naming collision | `agentRegistry.ts:65`, `modelRouter.ts:100` | Rename one to `routeAgentTask` or `routeModelTask`; update callers |
| 22 | `lint_config` phase not initialized | `pipelineTypes.ts:134` | Either add to initializer array, or remove from `PhaseId` type with a migration comment |
| 23 | `scanWorkspace` heuristic error counting | `agentDaemon.ts:58` | Replace substring check with proper regex: word boundaries, no string literal false positives. Or keep as heuristic but rename to `suspiciousPatternCount` |
| 24 | ReAct loop exhausts without final text | `agentDaemon.ts:820-881` | When `loopCount >= maxTurns`, set step status to `"failed"` with `"max turns exhausted"` instead of `"complete"` with empty output |
| 25 | Dynamic import in route handler | `server.ts:242` | Move to static top-of-file import with the rest; test that module loads at startup |

### VibeServe (5 x 15min)

| # | Issue | File(s) | Fix |
|---|-------|---------|-----|
| 26 | `body.pop` still renames 8+ fields | `http_bridge.py:90-128` | Move field-renaming to a dedicated `_rename_fields(data)` function with a single dict comprehensions instead of 8 individual `pop()` calls |
| 27 | Global mutable tool dict | `mutly_integration.py:339` | Wrap in a `ToolRegistry` class with `register()` and `get()` methods; convert module-level dict to instance |
| 28 | Three concerns in middleware.py | `middleware.py` | Split into `correlation_middleware.py`, `rate_limiter.py`, `audit_logger.py`; import all three in `__init__.py` |
| 29 | Lock bypass for HTTP POST session | `agent_ws.py:316` | Wrap session creation in `async with self._lock`; same for `:171,331-430` |
| 30 | No timeout on SamplingProvider | `llm_endpoint.py:189`, `providers.py:514` | Add `asyncio.wait_for(prov.call(...), timeout=30)` around the `SamplingProvider.call()` |

### RepoRank (6 x 15min)

| # | Issue | File(s) | Fix |
|---|-------|---------|-----|
| 31 | CLI imports from grading-engine directly | `apps/cli/src/agents.ts:6` | Extract needed API into `@reporank/shared-types` or have CLI own its types; break the direct package coupling |
| 32 | Comment endpoint drops context | `prs.ts:74` | Add `sourceFiles`, `fileTree`, `testFilePaths` to the destructured request and pass to `predictImpact` |
| 33 | Topic detection false positives | `complexity.ts:179` | Tighten keyword patterns: require `request` only when near `express`/`http`, `component` only when near `tsx`/`jsx` |
| 34 | Inconsistent severity weights | `analyzers/index.ts:38,46` | Unify to a single `SEVERITY_WEIGHTS` map used by all analyzers |
| 35 | Duplicate checks across analyzers | `production.ts`, `enterprise.ts` | Move shared checks (logging, healthcheck, hardcoded URLs) to a `shared_checks.ts` module, deduplicate |
| 36 | ScannerResults untyped | `grading-engine/src/index.ts:14` | Define proper `ScannerResults` type with known fields: `complexity`, `dependencies`, `architecture`, `production`, `codeHygiene`, `enterprise`, `perFile` |

---

## Phase 3: Architectural Refactors (P2 — 30-60 min each)

### Mutly (0 — all architectural issues were either fixed or noted as "wontfix for now") — NONE

### VibeServe (5 x 30min)

| # | Module | Refactor | Risk |
|---|--------|----------|------|
| 37 | `providers.py` (1242 lines) | Split into: `providers/base.py`, `providers/gemini.py`, `providers/openai.py`, `providers/deepseek.py`, `providers/ollama.py`, `providers/router.py` | MEDIUM — import paths change, test fixtures reference old structure |
| 38 | `http_bridge.py:137-308` | Extract each HTTP handler into its own module: `handlers/health.py`, `handlers/llm.py`, `handlers/budget.py`, `handlers/memory.py`, `handlers/tools.py` | MEDIUM — route mount points must stay same, test validation |
| 39 | `server.py:17` global singleton | Convert `_LazyMCP` to support multi-instance instantiation; store state on instance, not class | HIGH — many tools reference `server._tools` class attribute directly |
| 40 | `entrypoint.py` + `__main__.py` | Unify into single entry point in `__main__.py`; have `entrypoint.py` be a backward-compat import | LOW — test CLI invocations after change |
| 41 | `vibe_architect.py:37` provider param ignored | Actually pass the provider to the router's `create_architect()` call instead of ignoring it | LOW — one line change |

### RepoRank (5 x 30min)

| # | Module | Refactor | Risk |
|---|--------|----------|------|
| 42 | `analyzers/index.ts` god object | Break into `analyzers/run-deep-analysis.ts` (orchestrator) and `analyzers/aggregator.ts` (score aggregation); `index.ts` becomes re-exports | LOW — module-internal refactor |
| 43 | Inconsistent recommendation logic | Replace `analyzers/index.ts:59-100` hand-coded rules with a data-driven rule table: `{ condition: (r) => r.complexity > 0, message: (r) => \`${r.complexity} complexity hotspots\` }` | MEDIUM — test all recommendations behave same |
| 44 | Full-file regex on large files | In `complexity.ts:51`, use streaming or line-by-line approach for the large file regex scans | LOW — optimization only, no behavior change |
| 45 | Insecure redaction for short secrets | In `secretsScanner.ts:23` — for secrets under 8 chars, show `"***"` instead of leaking 8 chars | LOW — one line change |
| 46 | Arch: `full-file regex` duplicated in multiple analyzers | Extract `analyzeContent(file)` into a shared utility that runs all regex patterns once | MEDIUM — consolidates pattern matching across 3 analyzers |

---

## Execution Order

```
Phase 1 (P0-Quick)
  ├── Mutly: items 1-6 (parallel)
  ├── VibeServe: items 7-13 (parallel)
  └── RepoRank: items 14-20 (parallel)
          │
          ▼
Phase 2 (P1-Medium)
  ├── Mutly: items 21-25 (parallel)
  ├── VibeServe: items 26-30 (parallel)
  └── RepoRank: items 31-36 (parallel)
          │
          ▼
Phase 3 (P2-Architecture)
  ├── VibeServe: items 37-41 (sequential — shared modules)
  └── RepoRank: items 42-46 (parallel within component)
```

## Verification

After each phase:
```bash
# Mutly
npx tsc --noEmit
node bin/mutly.cjs build ./test-workspace

# VibeServe
python -m pytest tests/ -q
cd vibeserve/ts_bridge && npx vitest run

# RepoRank
pnpm --filter @reporank/grading-engine test
pnpm --filter @reporank/api build
```

---

## Rollback Notes

- All Phase 1 fixes are revertible with single-file undo
- Phase 2 fixes to `http_bridge.py`, `middleware.py`, `agent_ws.py` are higher risk — test each one individually before next
- Phase 3 `providers.py` split is the highest-risk change in this plan — test all provider call paths after restructuring
