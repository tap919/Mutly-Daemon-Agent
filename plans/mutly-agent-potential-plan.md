# Mutly Agent — Path to Highest Potential

**Date:** June 9, 2026
**Current Architecture:** 7-agent pipeline (ingest→audit→plan→code→review→iterate→deploy) with ReAct loop, VibeServe MCP, RepoRank scoring, git auto-commit, skill system

---

## Gap Analysis

### Current State vs Top-Tier Agents

| Capability | Mutly | Claude Code | Cursor | Aider | Priority |
|------------|-------|-------------|--------|-------|----------|
| **Code generation** | LiteLLM adapter, untested quality | Best-in-class | Best-in-class | Multi-model, 60+ models | **P0** |
| **Test generation** | Listed as capability, not implemented | Yes, with assertions | Yes, with coverage | Yes, TDD workflow | **P0** |
| **Multi-file editing** | Single file per step | Yes, coordinated | Yes, Composer | Yes, map-refine | **P0** |
| **Conversation memory** | None across sessions | Full context retention | Project memory | Session history | **P1** |
| **Semantic code search** | Grep only | Embedding-based | Embedding-based | Repo-map | **P1** |
| **Streaming output** | Completion-only callbacks | Real-time stream | Real-time stream | Stream to terminal | **P1** |
| **PR automation** | None | GitHub integration | None | None | **P1** |
| **Documentation gen** | None | Yes | Yes | No | **P2** |
| **Refactoring tools** | Create/apply file only | Rename, extract, move | Rename, extract | No | **P2** |
| **Learning from feedback** | None | No | No | No | **P2** |
| **Project context** | WORKFLOW.md only | .claude.md, .cursorrules | .cursorrules | .aider.conf | **P2** |

---

## P0: Immediate — Code Generation + Test + Multi-File (3 additions)

### 1. SWE-bench Eval Harness
**What:** Run the existing `codegen-benchmark.ts` against real SWE-bench tasks to establish a baseline.

**How:** Already partially done (benchmark exists, needs SWE-bench dataset integration). Add:
- SWE-bench task loader that reads verified task definitions
- Automated execution environment (Docker/sandbox)
- Scoring against SWE-bench's pass/fail criteria
- Prompt tuning loop — iterate prompts until quality improves

**Expected impact:** Quantify code generation quality, identify weak prompt patterns, close the gap with Cursor/Antigravity.

### 2. Test Generation Agent
**What:** A new `testAgent.ts` that generates tests for code changes.

**How:**
- Read the code agent's output (the changed/created files)
- Use LLM to generate unit tests for the changed functions
- Run `npx vitest` against the generated tests
- If tests fail, feed errors back to LLM for correction (iterate up to 3 times)
- Commit passing tests alongside code changes

**Files to create:**
- `server/agents/testAgent.ts` — extends BaseAgent
- `server/planning/test-planner.ts` — generates test plans from code changes
- Register in `coordinator.ts`

**Expected impact:** Every code change gets tests. Zero-touch TDD. The biggest gap between Mutly and Cursor/Claude Code.

### 3. Multi-File Coordinated Editing
**What:** The code agent currently does single file per step OR delegates to `p4_build` for the full plan. Add a multi-file edit mode that coordinates changes across dependent files.

**How:**
- After the plan agent produces steps, group steps by dependency (files that import each other)
- For dependent files, run code generation in a single LLM call with the full context of all files
- Apply all changes atomically (commit as one unit)
- Verify the build passes after the multi-file edit

**Files to modify:**
- `server/agents/codeAgent.ts` — add multi-step atomic mode
- `server/planning/react-loop.ts` — add dependency grouping
- `server/buildPipeline/fileStepExecutor.ts` — support atomic multi-file writes

**Expected impact:** Coordinated refactoring across files. Prevents broken builds from partial edits.

---

## P1: Near-Term — Memory + Search + Streaming + PRs (4 additions)

### 4. Session & Project Memory
**What:** Persistent conversation history and project-specific learning.

**How:**
- Store conversation turns in VibeServe's `vs_memory_store` (already integrated)
- On new sessions, inject the last N turns as context
- Build a project profile that remembers: file conventions, naming patterns, tech stack, test framework
- Auto-save on each session end, auto-load on session start

**Files to create:**
- `server/memory/sessionStore.ts` — session history persistence
- `server/memory/projectProfile.ts` — project conventions memory

**Expected impact:** No more "cold start" for each session. Agent remembers what it learned.

### 5. Semantic Code Search
**What:** Replace grep-only code discovery with embedding-based semantic search.

**How:**
- Index workspace files into embeddings (already partially done in `agentDaemon.ts:indexWorkspaceEmbeddings`)
- Add a `findRelevantFiles(query: string)` function that does semantic search against the embedding index
- Use in the audit and plan agents to find relevant code when diagnosing issues

**Files to modify:**
- `server/agentDaemon.ts` — expose `searchEmbeddings()` as a tool
- `server/agents/auditAgent.ts` — use semantic search for issue impact analysis

**Expected impact:** Find issues that grep can't. Understand code intent, not just patterns.

### 6. Streaming CLI Output
**What:** Real-time token streaming in the terminal.

**How:**
- Modify the LiteLLM adapter to support streaming (it likely already does via the underlying SDKs)
- Expose streaming via WebSocket (`plan:stream` message type)
- In the CLI, use stdout streaming with progress indicators

**Files to modify:**
- `server/routing/litellmAdapter.ts` — add `generateStream()`
- `server/ws-server.ts` — add `plan:stream` message type
- `server/cli/planCommand.ts` — use streaming output

### 7. PR & Release Automation
**What:** Auto-generate PR descriptions and release notes.

**How:**
- After the review agent passes, generate a PR description from the plan + changes
- Create a GitHub PR via the API (or generate the `gh pr create` command)
- Generate changelog entries from the commit history

**Files to create:**
- `server/automation/prGenerator.ts` — PR description generation
- `server/automation/changelogGenerator.ts` — changelog generation

---

## P2: Long-Term — Docs + Refactoring + Learning + Context (4 additions)

### 8. Documentation Generation
Auto-generate README, API docs, and inline JSDoc from code changes.

### 9. Refactoring Toolbox
Add rename-symbol, extract-function, move-file operations beyond simple create/apply/delete.

### 10. Feedback Learning Loop
Track which code generations pass tests and which fail. Bias future generations toward patterns that succeed.

### 11. Project Context Injection
Auto-detect and read `.cursorrules`, `.claude.md`, `AGENTS.md`, and inject as system prompt context.

---

## Implementation Plan

### Phase A: P0 (3 agents, parallel) — ~3 hours

| Agent | What | Key Files |
|-------|------|-----------|
| **SWE-bench Harness** | Integrate benchmark, run baseline, tune prompts | `codegen-benchmark.ts` |
| **Test Agent** | New agent class, test generation, run-and-fix loop | `testAgent.ts`, `testPlanner.ts` |
| **Multi-File Edit** | Dependency grouping, atomic multi-file apply | `codeAgent.ts`, `fileStepExecutor.ts` |

### Phase B: P1 (4 agents, parallel) — ~3 hours

| Agent | What | Key Files |
|-------|------|-----------|
| **Session Memory** | Store/load conversation history | `sessionStore.ts`, `projectProfile.ts` |
| **Semantic Search** | Embedding-based code search | `agentDaemon.ts`, `auditAgent.ts` |
| **Streaming Output** | Real-time token streaming | `litellmAdapter.ts`, `ws-server.ts` |
| **PR Automation** | PR description + changelog generation | `prGenerator.ts`, `changelogGenerator.ts` |

### Phase C: P2 (4 agents, parallel) — ~2 hours

| Agent | What |
|-------|------|
| Doc gen, Refactoring tools, Feedback learning, Project context | Lower priority, foundational improvements |

---

## Success Metrics

| Capability | Before | Target |
|------------|--------|--------|
| SWE-bench score | Untested/unknown | ≥ 50% (baseline) |
| Test generation | 0 | Auto-generate tests for every code change |
| Multi-file edits | Single file per step | Coordinated atomic multi-file |
| Session memory | None | Last N turns injected on start |
| Code search | Grep only | Semantic + grep hybrid |
| Output | Completion only | Real-time streaming |
| PR automation | 0 | Auto PR description + changelog |

---

**After this roadmap, Mutly would be competitive with Cursor/Claude Code on code quality, superior on CI/CD/security automation, and unique on governance + convergence + self-correction.**
