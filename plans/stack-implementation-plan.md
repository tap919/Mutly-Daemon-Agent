# Mutly Stack Implementation Plan

**Objective:** Close competitive gaps across Mutly, VibeServe, and RepoRank — 9 moves in 3 parallel phases.  
**Execution model:** 3 phases, parallel within each phase, sequential between phases.  
**Date:** June 9, 2026

---

## Dependency Graph

```
Phase 1 (Foundation)          Phase 2 (Distribution & UX)     Phase 3 (Intelligence)
┌─────────────────────┐      ┌─────────────────────────┐     ┌────────────────────────┐
│ 1A: Codegen bench   │─────▶│ 2A: VS Code polish      │────▶│ 3A: Autonomous planner  │
│ 1B: Windows bridge  │─────▶│ 2B: PyPI publish        │────▶│ 3B: Auto-gen docs       │
│ 1C: Semgrep library │─────▶│ 2C: PR auto-fix         │────▶│ 3C: SonarQube import    │
└─────────────────────┘      └─────────────────────────┘     └────────────────────────┘
```

**Invariants (verified after every step):**
- All existing tests pass (`npm run test` / `pytest`)
- No secrets in code (`secretlint` / `grep -r`)
- Type checks pass (`tsc --noEmit` / `mypy`)

---

## Phase 1: Foundation

> Run all 3 steps in parallel. No shared files between them.

### Step 1A: Run codegen-benchmark.ts against real LLM

**Component:** Mutly  
**Files:** `reporank/apps/cli/src/codegen-benchmark.ts`, `Mutly-Daemon-Agent/server/pipeline/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
`codegen-benchmark.ts` exists but has never been run against a real LLM. The pipeline in `server/pipeline/` generates code but quality is unmeasured. Goal: establish a baseline score, identify weak prompts, iterate once.

**Task list:**
1. Read `codegen-benchmark.ts` to understand the benchmark harness and expected input/output format
2. Configure it to call the Mutly pipeline's LLM provider (Gemini via `@google/genai` already in deps)
3. Run the benchmark, capture results to `benchmark-results-codegen.json`
4. Analyze output: identify the 3 weakest prompt templates by score
5. Rewrite the 3 weakest prompts with better system instructions and few-shot examples
6. Re-run benchmark, compare before/after scores
7. Commit results + prompt improvements

**Verification:**
```bash
cd Mutly-Daemon-Agent && npm run test
cd reporank && pnpm test
```

**Exit criteria:** Baseline score recorded, 3 prompts improved, delta documented in benchmark results file.

---

### Step 1B: Fix Windows bridge lifecycle

**Component:** VibeServe  
**Files:** `VibeServe-main/vibeserve/http_bridge.py`, new `VibeServe-main/vibeserve/ts_bridge/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
VibeServe's Python MCP server has ProactorEventLoop issues on Windows. The existing `http_bridge.py` works but has lifecycle problems (startup race, shutdown hang). Goal: create a clean TypeScript-native Hono bridge as an optional alternative that avoids Python event loop issues entirely on Windows.

**Task list:**
1. Read `http_bridge.py` to understand current bridge protocol (tool list, tool call, streaming)
2. Create `vibeserve/ts_bridge/` with `package.json` (hono, @hono/node-server, ws)
3. Implement `bridge.ts` — Hono HTTP server that proxies to Python MCP via stdio JSON-RPC
4. Implement `lifecycle.ts` — clean startup (spawn Python, wait for `initialized`), graceful shutdown (SIGTERM → drain → kill)
5. Add `start-bridge.ps1` and `start-bridge.cmd` for Windows
6. Write 5 integration tests: startup, tool list, tool call, streaming response, graceful shutdown
7. Update `README.md` with Windows bridge section

**Verification:**
```bash
cd VibeServe-main && python -m pytest tests/ -q
cd VibeServe-main/vibeserve/ts_bridge && npm test
```

**Exit criteria:** Bridge starts on Windows without ProactorEventLoop errors, all 5 tests pass, Python MCP tools accessible via HTTP.

---

### Step 1C: Wire full Semgrep library

**Component:** RepoRank  
**Files:** `reporank/packages/claw-protect-core/src/`, `reporank/packages/grading-engine/src/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
RepoRank already has Semgrep integration but uses a limited ruleset. The `claw-protect-core` package runs security scanning. Goal: wire the full Semgrep community rule registry (2K+ rules) with language-aware filtering, and integrate scores into the grading engine.

**Task list:**
1. Read `claw-protect-core/src/` to understand current Semgrep invocation and rule selection
2. Read `grading-engine/src/` to understand how security scores feed into the 6-dimension rubric
3. Create a rule registry module: `claw-protect-core/src/rule-registry.ts` that maps languages to Semgrep rule packs
4. Add rule pack discovery: scan `semgrep --config auto` output or use the Semgrep registry API
5. Update the scanner to dynamically select rules based on detected languages in the target codebase
6. Map Semgrep severity levels (ERROR/WARNING/INFO) to RepoRank's scoring weights
7. Update grading engine to consume expanded security findings
8. Run benchmark before/after to measure rule count increase and score impact
9. Write 3 tests: rule discovery, language filtering, score mapping

**Verification:**
```bash
cd reporank && pnpm test
cd reporank && node comprehensive-benchmark.mjs
```

**Exit criteria:** Rule count increases from current to 2K+, security dimension score changes documented, all tests pass.

---

## Phase 2: Distribution & UX

> Run all 3 steps in parallel. Depends on Phase 1 completion.

### Step 2A: Polish VS Code extension

**Component:** Mutly  
**Files:** `Mutly-Daemon-Agent/mutly-vscode/`  
**Model tier:** Strongest  
**Estimated effort:** 1-2 sessions

**Context brief:**  
The VS Code extension exists but is basic. Goal: add real-time feedback from the daemon (review scores, security findings, pipeline status) directly in the editor, matching Cursor's inline UX.

**Task list:**
1. Read `mutly-vscode/src/` to understand current extension architecture
2. Read `Mutly-Daemon-Agent/server/ws-server.ts` to understand WebSocket protocol
3. Add a status bar item showing current pipeline state (idle/running/reviewing/done)
4. Add a diagnostics provider that surfaces RepoRank findings as VS Code problems
5. Add a sidebar webview showing the 6-dimension score radar chart
6. Add a code lens provider showing "Review score: X/100" above each file
7. Connect all UI to the daemon WebSocket for real-time updates
8. Add `package.json` commands: "Mutly: Run Review", "Mutly: Show Dashboard"
9. Write extension integration tests using `@vscode/test-electron`

**Verification:**
```bash
cd Mutly-Daemon-Agent/mutly-vscode && npm run compile
cd Mutly-Daemon-Agent && npm run test
```

**Exit criteria:** Extension installs, connects to daemon, shows live review scores and diagnostics.

---

### Step 2B: Publish to PyPI

**Component:** VibeServe  
**Files:** `VibeServe-main/pyproject.toml`, `VibeServe-main/.github/workflows/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
`pyproject.toml` is already configured with entry points (`vibeserve = "vibeserve.__main__:main"`). Goal: set up CI/CD for automated PyPI publishing with proper gates.

**Task list:**
1. Verify `pyproject.toml` metadata is complete (classifiers, URLs, dependencies)
2. Create `.github/workflows/pypi.yml` with: test gate → security scan → build → publish
3. Add trusted publishing OIDC config (no API tokens in CI secrets)
4. Add post-publish smoke test: `pip install vibeserve && vibeserve --version`
5. Add `CHANGELOG.md` enforcement: CI fails if no entry for the version being published
6. Create `scripts/publish.sh` for manual local publishing as fallback
7. Test the full pipeline with `--dry-run` or TestPyPI first
8. Document the release process in `CONTRIBUTING.md`

**Verification:**
```bash
cd VibeServe-main && python -m build
cd VibeServe-main && python -m twine check dist/*
```

**Exit criteria:** `pip install vibeserve` works from TestPyPI, CI pipeline green, release docs written.

---

### Step 2C: Add PR auto-fix (`--apply` flag)

**Component:** RepoRank  
**Files:** `reporank/packages/fix-pack-generator/src/`, `reporank/apps/cli/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
RepoRank generates fix packs (suggested patches) but doesn't apply them. Goal: add `reporank verify --apply` that generates fix commits directly, similar to `eslint --fix`.

**Task list:**
1. Read `fix-pack-generator/src/` to understand fix pack format and generation
2. Read the CLI entry point to understand current `verify` command flow
3. Add `--apply` flag to the `verify` command
4. Implement a patch applier: reads fix packs, generates git commits per fix category
5. Add `--dry-run` mode that shows what would be changed without applying
6. Add safety checks: refuse to apply on dirty working tree, require clean git state
7. Add `--interactive` mode: prompt per-fix with y/n/skip
8. Write 5 tests: dry-run output, clean tree check, apply single fix, apply all fixes, interactive mode
9. Update CLI help text and README

**Verification:**
```bash
cd reporank && pnpm test
cd reporank && node apps/cli/dist/index.js verify --dry-run .
```

**Exit criteria:** `--apply` generates valid git commits from fix packs, `--dry-run` shows preview, all tests pass.

---

## Phase 3: Intelligence & Integration

> Run all 3 steps in parallel. Depends on Phase 2 completion.

### Step 3A: Add autonomous planning loop

**Component:** Mutly  
**Files:** `Mutly-Daemon-Agent/server/planning/`, `Mutly-Daemon-Agent/server/execution/`  
**Model tier:** Strongest  
**Estimated effort:** 2 sessions

**Context brief:**  
The daemon has planning and execution modules but lacks a ReAct-style autonomous loop (plan → act → observe → replan). Claude Code and Cursor have this. Goal: add a checkpoint/restore planning loop that can autonomously decompose and execute multi-step tasks.

**Task list:**
1. Read `server/planning/` and `server/execution/` to understand current architecture
2. Read `server/dag/` to understand the existing DAG execution model
3. Design the ReAct loop: `PlanStep → ExecuteStep → ObserveResult → ReplanIfNeeded`
4. Implement `planning/react-loop.ts` with:
   - Task decomposition (break user request into steps)
   - Step execution (delegate to existing execution engine)
   - Observation parsing (extract success/failure/partial from step output)
   - Replanning (modify remaining steps based on observations)
   - Checkpoint/restore (save state after each step, resume from checkpoint)
5. Add a `maxSteps` safety limit (default 20) and `maxCost` budget guard
6. Expose via CLI: `mutly plan "build a REST API with auth"` → autonomous execution
7. Add WebSocket streaming of plan progress to the VS Code extension
8. Write 5 tests: simple 3-step plan, replan on failure, checkpoint restore, maxSteps limit, cost guard

**Verification:**
```bash
cd Mutly-Daemon-Agent && npm run test
cd Mutly-Daemon-Agent && npm run typecheck
```

**Exit criteria:** `mutly plan` decomposes a task, executes steps autonomously, replans on failure, respects limits.

---

### Step 3B: Auto-generate docs from tool docstrings

**Component:** VibeServe  
**Files:** `VibeServe-main/vibeserve/tools/`, `VibeServe-main/docs/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
VibeServe has 37 tool files but documentation is README-only. Goal: auto-generate a tool reference from Python docstrings, published to GitHub Pages.

**Task list:**
1. Audit all 37 tool files for docstring completeness — add missing docstrings
2. Create `scripts/generate-docs.py` that:
   - Imports all tool modules
   - Extracts docstrings, parameter types, return types
   - Generates Markdown reference pages grouped by category
3. Add category grouping: Core, Code Review, Deployment, LLM, Memory, Messaging, Integration
4. Create `docs/tools/` directory structure with generated Markdown
5. Add MkDocs config (`mkdocs.yml`) with navigation
6. Create `.github/workflows/docs.yml`: generate docs → build MkDocs → deploy to GitHub Pages
7. Add a `make docs` command to `pyproject.toml` scripts
8. Add a docstring lint check: CI fails if any tool lacks a docstring

**Verification:**
```bash
cd VibeServe-main && python scripts/generate-docs.py
cd VibeServe-main && mkdocs build --strict
```

**Exit criteria:** All 37+ tools have docstrings, `make docs` generates a complete reference site, CI deploys to GitHub Pages.

---

### Step 3C: Add SonarQube import path

**Component:** RepoRank  
**Files:** `reporank/packages/grading-engine/src/`, `reporank/apps/cli/src/`  
**Model tier:** Default  
**Estimated effort:** 1 session

**Context brief:**  
Enterprises using SonarQube have existing rule configurations and quality profiles. Goal: add `reporank import sonarqube` that reads SonarQube exports and maps them to RepoRank's scoring system, providing a migration path.

**Task list:**
1. Research SonarQube export formats: quality profiles (XML), issue reports (JSON), rule definitions
2. Create `grading-engine/src/importers/sonarqube.ts` with parsers for:
   - Quality profile XML → RepoRank rule config
   - Issue report JSON → RepoRank finding format
   - Quality gate definitions → RepoRank thresholds
3. Map SonarQube severity (BLOCKER/CRITICAL/MAJOR/MINOR/INFO) to RepoRank weights
4. Map SonarQube rule types (BUG/VULNERABILITY/CODE_SMELL) to RepoRank dimensions
5. Add CLI command: `reporank import sonarqube --profile <file> --issues <file>`
6. Generate a migration report: what's covered, what's not, equivalent rules
7. Write 5 tests: profile parsing, issue parsing, severity mapping, gate mapping, CLI integration
8. Document the migration path in `docs/sonarqube-migration.md`

**Verification:**
```bash
cd reporank && pnpm test
cd reporank && node apps/cli/dist/index.js import sonarqube --help
```

**Exit criteria:** SonarQube quality profiles import successfully, findings map to RepoRank format, migration docs published.

---

## Rollback Strategy

| Step | Rollback |
|------|----------|
| 1A | Revert prompt changes, benchmark results are additive |
| 1B | Delete `ts_bridge/`, Python bridge unchanged |
| 1C | Revert rule registry, original ruleset preserved |
| 2A | Revert extension changes, daemon unchanged |
| 2B | Unpublish from PyPI, disable workflow |
| 2C | Remove `--apply` flag, fix-pack generator unchanged |
| 3A | Remove `react-loop.ts`, existing planning module unchanged |
| 3B | Remove generated docs, tool files unchanged |
| 3C | Remove importer, grading engine unchanged |

---

## Success Metrics

| Metric | Before | Target | Measured By |
|--------|--------|--------|-------------|
| Code gen quality | Untested | Baseline + 15% | `codegen-benchmark.ts` score |
| Windows compatibility | Broken event loop | Clean startup | Manual + CI on Windows runner |
| Security rule count | ~200 | 2,000+ | `comprehensive-benchmark.mjs` |
| Editor integration | Basic extension | Live scores + diagnostics | Extension test suite |
| Distribution | Manual `python -m` | `pip install vibeserve` | PyPI smoke test |
| Auto-fix | Report only | Git commits | `verify --apply` test |
| Autonomy | No planning loop | ReAct with checkpoint | `mutly plan` test suite |
| Documentation | README only | Full tool reference | GitHub Pages deploy |
| Migration path | None | SonarQube import | CLI integration test |

---

## Anti-Patterns to Avoid

1. **Don't rewrite existing modules** — extend, don't replace. The planning module exists; add ReAct on top.
2. **Don't add new LLM dependencies** — use existing providers (`@google/genai`, VibeServe's provider router).
3. **Don't break the monorepo** — RepoRank uses turbo/pnpm. New packages must follow the workspace convention.
4. **Don't skip the dry-run** — every destructive operation (`--apply`, publish, autonomous execution) needs a preview mode.
5. **Don't ignore Windows** — VibeServe's biggest weakness is Windows. Every change must be tested on Windows.
