# PLAN_LEADER.md — From Coding Tool to Leading Coding System

**Objective:** Evolve Mutly/VibeServe/RepoRank from a functional coding assistant into a market-leading AI development platform — the orchestration layer that runs the entire development lifecycle.

**Current state:** CLI-grade tooling with working LLM router (7+ providers), code review benchmark (72% F1), codegen (100% pass), blast radius analysis, SSE streaming, multi-agent orchestration primitives.

**Target state:** A visual, opinionated, "batteries-included" platform that handles: task decomposition → parallel agent execution → quality gating → infrastructure deployment → production monitoring. The "AI development team lead."

**Timeline:** 6 phases, ~4-6 weeks total. Parallelizable.

---

## Dependency Graph

```
Phase 1 (Quality Gate)
  ├── Phase 2 (Visual Orchestrator) — depends on Phase 1 scoring
  │     ├── Phase 4 (Multi-Agent Memory) — depends on Phase 2 session model
  │     └── Phase 5 (Infra Deployment) — independent of all except Phase 2
  ├── Phase 3 (Model Router) — independent of all
  └── Phase 6 (Universal Instructions) — depends on all other phases for feedback
```

**Parallel workstreams possible:** Phase 3 + Phase 1 can run concurrently. Phase 5 can start after Phase 2 is scaffolded.

---

## Phase 1 — Productize RepoRank as a Quality Gate (Week 1)

**Why:** Quality gates are the #1 missing feature in every coding agent. Your benchmark harness already scores 72% F1 — productize it into a `reporank verify` command that any CI system or agent can call.

### Step 1.1 — `reporank verify` CLI command (4 hr)

**Context brief:** The benchmark harness (`harness.ts`) already runs LLM code review and scores findings against ground truth. Productize this into a standalone `verify` command that analyzes any file or diff and returns a structured quality report.

**Tasks:**
1. Add `verify` subcommand to `index.ts` — accepts file path, directory, or git diff
2. Wire `llmScan` from `review_scanner.ts` → build prompt with AGENTS.md rules as context
3. Run heuristic scanner + LLM scanner, merge findings via `capFindings`
4. Return structured report: findings array, quality score (0-100), pass/fail verdict
5. Add `--threshold` flag (default 70) — exit non-zero if score below threshold
6. Add `--format json` for CI integration

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts verify apps/cli/src/harness.ts --threshold 50 --json
```
→ returns findings + quality score

**Exit criteria:** `verify` command is registered in CLI help, runs on any source file, returns structured JSON, exits non-zero on threshold failure.

### Step 1.2 — Hallucination detector (4 hr)

**Context brief:** LLMs hallucinate imports, APIs, and function signatures. Scan generated/committed code for references to packages/modules/functions that don't exist in the project's dependency tree.

**Tasks:**
1. Walk project's `package.json`, `requirements.txt`, `go.mod` etc to build known dependency set
2. Parse import/require statements in source files
3. Flag any import that references a module not in the dependency set ("phantom import")
4. Flag any function call to an identifier that doesn't exist in the project's own symbol table (requires tree-sitter or regex-based scan)
5. Add to `reporank verify` output as `hallucinations` array
6. Add `--fix-hallucinations` flag that attempts auto-removal of phantom imports

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts verify path/to/file.ts --detect-hallucinations
```
→ marks imports to unknown packages

**Exit criteria:** Detects a known-bad import from a test file. False positive rate < 10% on the reporank codebase.

### Step 1.3 — PR integration & CI gate (3 hr)

**Context brief:** The quality gate is most valuable when it runs automatically on PRs. Wire it into the developer's git workflow.

**Tasks:**
1. `reporank verify --diff` — accepts git diff on stdin, only analyzes changed lines/regions
2. `reporank verify --pr <number>` — fetches PR diff from GitHub CLI, analyzes changes
3. Output GitHub-flavored markdown summary suitable for PR comment
4. Add GitHub Actions workflow template (`.github/workflows/reporank-verify.yml`)
5. Publish as `@reporank/verify` npm package for easy CI integration

**Verification:**
```powershell
git diff HEAD~1 | node $tsx apps/cli/src/index.ts verify --diff --format gh-markdown
```
→ returns formatted markdown with findings on changed lines only

**Exit criteria:** CI gate runs, comments on PRs, exits non-zero on failed threshold. Published as consumable package.

---

## Phase 2 — Visual Multi-Agent Orchestrator (Weeks 2-3)

**Why:** You already have subagent-driven-development, team-builder, dmux-workflows, and gsd-executor for parallel agents. The missing piece: a visual interface showing what every agent is doing, with conflict detection and cost tracking.

### Step 2.1 — Agent session WebSocket API (6 hr)

**Context brief:** Currently agents run as detached subprocesses with no visibility. Build a WebSocket-based session manager that tracks running agent sessions, their status, files being modified, and cost incurred.

**Tasks:**
1. Add WebSocket endpoint to VibeServe HTTP bridge (`/ws/agents`)
2. Define `AgentSession` type: id, status (pending/running/blocked/done/failed), task, files_changed, cost, started_at, model
3. Wrap `create_subprocess_exec` in `mutly_integration.py` to emit status events over WebSocket
4. Track file modifications per agent (watch or hook into the edit pipeline)
5. Track token/cost usage per agent from LLM responses
6. Emit heartbeat events every 5s so UI knows agents are alive

**Verification:**
```python
# Connect to ws://127.0.0.1:8000/ws/agents and observe events
```

**Exit criteria:** WebSocket emits events when an agent runs, each event has agent_id/status/files_changed/cost, connection survives agent lifecycle.

### Step 2.2 — Agent orchestrator web UI (12 hr)

**Context brief:** A simple React-based dashboard showing active agents, their task descriptions, files modified, cost so far, and status. Inspired by Antigravity's "Manager View" and vibe-kanban.

**Tasks:**
1. Scaffold a lightweight SPA (React + Vite) in `apps/orchestrator/`
2. Connect to WebSocket endpoint, render agent cards showing:
   - Task summary (first 80 chars)
   - Status badge (colored: green=done, yellow=running, red=failed, gray=pending)
   - Files changed count + list (expandable)
   - Cost so far (real-time updates)
   - Duration (running time or total)
3. Add "dispatch new agent" form: task description, model selector, file context picker
4. Add kill button per agent
5. Agent timeline view — show sequence of actions each agent took
6. Add approval-required mode — agent does dry-run, user reviews before apply

**Verification:**
```powershell
# Start the dashboard, dispatch an agent from the UI, watch it progress
```

**Exit criteria:** Dashboard renders live agent status, dispatch works, kill works, cost updates in real-time, approval mode blocks edits until user confirms.

### Step 2.3 — Conflict detection & merge queue (8 hr)

**Context brief:** When multiple agents edit the same file, conflicts arise. Build a system that detects overlapping edits, visualizes the conflict, and provides resolution strategies.

**Tasks:**
1. Track file regions per agent (which lines each agent edits)
2. When two agents edit overlapping regions, mark both as "blocked: conflict"
3. Show side-by-side diff of conflicting edits in the UI
4. Resolution strategies: "keep A", "keep B", "keep both (sequential)", "manual merge"
5. Build a merge queue: agents that finish wait for auto-merge approval before their edits are applied
6. Integrate with git: auto-commit each agent's changes to a feature branch, merge queue handles PR creation

**Verification:**
```powershell
# Dispatch 2 agents to edit different parts of the same file
# Both run, conflict is detected, user resolves in UI
```

**Exit criteria:** Simultaneous edits to the same file are detected, blocked, and resolvable. Auto-commit + merge queue works.

### Step 2.4 — Cost dashboard (4 hr)

**Context brief:** Per-agent cost tracking needs a dashboard for team leads to understand spending.

**Tasks:**
1. Add `/v1/cost/stats` endpoint — aggregated cost by agent, model, project, time period
2. Cost dashboard tab in the orchestrator UI: per-session breakdown, per-model costs
3. Budget alerts: configurable per-session budget, emit warning on 80%+ usage
4. Cost projection: estimate remaining cost for running agents based on current burn rate

**Verification:** Dashboard shows recent sessions with cost breakdowns.

**Exit criteria:** Cost data persisted, dashboard renders per-session and per-model costs, budget warnings fire.

---

## Phase 3 — Cost-Aware Model Router (Week 2, parallel with Phase 2)

**Why:** VibeServe already routes to 7+ providers. The upgrade is intelligence: analyze task complexity and route to the optimal model for cost/speed/quality tradeoffs.

### Step 3.1 — Task complexity classifier (4 hr)

**Context brief:** Not all code tasks need a $3/Mtoken model. A commit message generator should use a cheap/fast model. A security audit should use the strongest. Build a classifier that tags each task by complexity class.

**Tasks:**
1. Define complexity classes: `simple` (formatting, commit messages, docstrings), `medium` (single-file refactor, bug fix), `complex` (multi-file architecture, feature design), `critical` (security, data integrity, auth)
2. Build a lightweight classifier (regex + keyword heuristics — no LLM needed for this):
   - `simple`: prompt < 100 chars, keywords like "commit", "format", "doc"
   - `medium`: single file reference, keywords like "fix", "refactor", "add"
   - `complex`: multi-file, keywords like "architect", "design", "migrate"
   - `critical`: keywords like "security", "auth", "password", "encrypt", "data loss"
3. Accept optional `--complexity` override flag
4. Add to VibeServe's `handle_llm_complete` to tag tasks automatically

**Verification:**
```python
classifier.classify("write a commit message for this diff")  # → "simple"
classifier.classify("migrate authentication from JWT to OAuth")  # → "complex"
```

**Exit criteria:** Classifier returns correct class for 10 test prompts covering all 4 tiers.

### Step 3.2 — Model routing table (4 hr)

**Context brief:** Map complexity classes to optimal model+provider combinations. The routing table should be configurable by the user.

**Tasks:**
1. Add `VIBESERVE_ROUTING_TABLE` env var or config file:
```json
{
  "simple": { "provider": "opencode", "model": "opencode/deepseek-v4-flash-free" },
  "medium": { "provider": "deepseek", "model": "deepseek-v4-flash" },
  "complex": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4" },
  "critical": { "provider": "openrouter", "model": "anthropic/claude-opus-4" }
}
```
2. Wire into VibeServe's `LLMRouter.get()` — when a complexity tag is present, select the mapped provider/model
3. Fall back to default provider when no complexity tag or routing table entry is missing
4. Add `--complexity` option to `/v1/llm/complete` endpoint
5. Log routing decisions: "routed task=... complexity=medium → deepseek/deepseek-chat"

**Verification:**
```powershell
# Call with complexity=simple → uses cheap provider
Invoke-WebRequest -Body '{"prompt":"format this", "complexity":"simple"}' ...
```

**Exit criteria:** Routing works for all 4 complexity levels. Fallback to default works. Config is user-editable JSON.

### Step 3.3 — Per-session cost tracking & budgets (4 hr)

**Context brief:** Users need to know what they're spending. Build cost tracking into the model router.

**Tasks:**
1. Track per-session cost in memory (session created when first LLM call arrives with `session_id` header)
2. Expose `/v1/cost/session/<id>` endpoint — returns cost breakdown for a session
3. Add `session_budget` parameter to LLM calls — hard cap on cost, route to cheaper model when exceeded
4. Emit WebSocket event when budget reaches 50%/80%/100%
5. Add cost projection: burn rate × estimated remaining tokens

**Verification:**
```powershell
# Make 10 LLM calls with session_id=test-123
# GET /v1/cost/session/test-123 → returns total cost + per-model breakdown
```

**Exit criteria:** Cost is tracked per session. Budget enforcement switches model when exceeded. WebSocket events fire.

---

## Phase 4 — Persistent Session Memory (Week 3-4, depends on Phase 2)

**Why:** You already have `.aether_prime_memory/`, `vs_memory_get/store`, and `continuous-learning-v2` instinct system. The next step is making this automatic — agents learn from corrections without explicit instructions.

### Step 4.1 — Auto-learning from corrections (6 hr)

**Context brief:** When a user corrects an agent's output ("that's wrong, it should be X"), persist the correction as an "instinct" that future agents will read.

**Tasks:**
1. In the edit pipeline, when a user rejects or modifies an agent's change, capture the original proposal vs. final accepted version
2. Diff the two versions, extract the pattern: "agent proposed A, user accepted B"
3. Store as an instinct in `vs_memory_store` with context type `correction`
4. On future agent runs, query for relevant `correction` memories and inject them into the prompt
5. Add `--learn` flag to `reporank verify` to enable auto-learning during code review
6. Add `forget <pattern>` subcommand for removing learned behaviors

**Verification:**
```powershell
# Agent writes "use var x = 5"
# User corrects to "const x = 5"
# Next agent run → prompt includes "use const instead of var for this project"
```

**Exit criteria:** Correction from one session persists and influences next session. `forget` removes it.

### Step 4.2 — Cross-session context bridge (6 hr)

**Context brief:** Currently each agent session starts fresh. Build a context bridge that automatically pulls relevant history from past sessions.

**Tasks:**
1. At agent session start, query memory store for:
   - Project architecture decisions (stored via `vs_memory_store` with `architectural` context)
   - Recent corrections (last 10)
   - Open issues/tasks
   - Active feature branch context
2. Format the retrieved memories as a "project context" block prepended to the system prompt
3. Add `--no-memory` flag to disable (for privacy-sensitive tasks)
4. Track which memories were used and whether they helped (user feedback signal: was the edit accepted or rejected?)
5. Present memories in the orchestrator UI as a "context panel" — user can see what the agent knows

**Verification:** Agent starts, prompt includes "Project context" with relevant memories from past sessions.

**Exit criteria:** Memory query returns relevant items. Agent prompt includes context. Orchestrator UI shows context panel.

### Step 4.3 — Team-shared memory (4 hr)

**Context brief:** Multiple developers working on the same project should share agent memory. Correction I make should benefit my teammate's agents too.

**Tasks:**
1. Add `team` scope to `vs_memory_store` — memories tagged with team scope are visible to all team members
2. Add `--share` flag to learn from corrections — publishes the correction to the team scope
3. Add `vs_memory_list` tool for browsing stored team memories
4. In orchestrator UI, add "Team Brain" tab showing shared instincts and corrections
5. Add conflict resolution for contradictory team memories (last write wins + tag as overridden)

**Verification:** Two users make corrections, both see each other's learned patterns in agent prompts.

**Exit criteria:** Team-shared memories survive across user sessions. Contradictions handled. UI shows shared memory bank.

---

## Phase 5 — Infrastructure Deployment (Weeks 3-4, depends on Phase 2 scaffold)

**Why:** Karpathy's #1 pain point — AI can generate code but can't provision infrastructure. If your system can deploy from natural language ("SaaS app with Stripe, Clerk, Postgres on Fly.io"), it wins the market.

### Step 5.1 — Deployment provider abstractions (8 hr)

**Context brief:** Each deployment target (Fly.io, Railway, Vercel, Supabase) has its own CLI. Build an abstraction layer that maps natural language deployment requests to specific CLI commands.

**Tasks:**
1. Define `DeploymentTarget` interface: `deploy(project): url`, `configure(service, options): void`, `logs(project): string`
2. Implement `FlyioTarget` — wraps `flyctl launch`, `flyctl deploy`, `flyctl secrets set`
3. Implement `SupabaseTarget` — wraps Supabase CLI for DB provisioning, migrations
4. Implement `VercelTarget` — wraps `vercel deploy`, `vercel env pull`
5. Implement `RailwayTarget` — wraps `railway up`, `railway connect`
6. Each target resolves from env vars (FLY_API_TOKEN, SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN, RAILWAY_TOKEN)
7. All targets return structured results (URL, status, logs) — not raw CLI output

**Verification:**
```typescript
const target = new FlyioTarget();
const result = await target.deploy({ name: "my-app", entrypoint: "./dist/index.js" });
console.log(result.url); // https://my-app.fly.dev
```

**Exit criteria:** At least 2 targets work end-to-end (deploy a static app). All targets return structured results. CLI wrappers handle errors gracefully.

### Step 5.2 — `mutly deploy` natural language command (8 hr)

**Context brief:** Let users type "deploy a SaaS app with Stripe payments and Clerk auth" and have the system figure out which services to provision and in what order.

**Tasks:**
1. Add `deploy` subcommand to Mutly CLI (or RepoRank CLI)
2. Parse deployment request for service keywords: "stripe", "clerk", "postgres", "auth", "payments", "domain"
3. Generate deployment plan: ordered list of services to provision + config
4. Execute each step, reporting progress
5. Handle partial failure — if Stripe key setup fails but Clerk succeeded, retry Stripe or skip
6. Output final URLs, API keys (masked), and next steps for the developer
7. Support `--dry-run` flag that shows deployment plan without executing

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts deploy "SaaS app with Postgres and auth on Fly.io" --dry-run
```
→ Shows: "Step 1: Create Fly.io app, Step 2: Provision Postgres, Step 3: Configure Clerk auth, Step 4: Deploy"

**Exit criteria:** `deploy` command works end-to-end for at least "deploy a static site to Fly.io". Partial failure handled. Dry-run works.

### Step 5.3 — Service configuration templates (6 hr)

**Context brief:** Services like Stripe, Clerk, Supabase require specific environment variables, webhook URLs, and OAuth settings. Template these so the deploy command can auto-configure them.

**Tasks:**
1. Create template system: `templates/stripe.md`, `templates/clerk.md`, `templates/supabase.md`
2. Each template defines: required API keys, env vars to set, webhook URLs to register, post-deploy verification steps
3. Wire into `mutly deploy` — after provisioning the service, run the template's configuration steps
4. Add `mutly deploy --list-templates` to show available service templates
5. Community-contributed template format (users can add their own services)

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts deploy --list-templates
# → stripe, clerk, supabase, postgres, redis, sentry, ...
```

**Exit criteria:** Stripe template configures webhook endpoints. Clerk template sets OAuth URLs. Templates are discoverable and extensible.

### Step 5.4 — Deployment dashboard in orchestrator UI (4 hr)

**Context brief:** Show current deployments, their status, logs, and costs in the orchestrator web UI.

**Tasks:**
1. "Deployments" tab showing: app name, URL, status (deploying/running/failed), last deployed, service count
2. Real-time deployment log stream (tail the deployment log via WebSocket)
3. "Destroy" button per deployment (with confirmation)
4. Show per-deployment cost (platform costs, not just LLM costs)
5. Link to external dashboard URLs (Fly.io dashboard, Supabase dashboard)

**Verification:** Deploy an app from the UI, watch logs stream, see "Running" status, click destroy.

**Exit criteria:** Deployments tab shows all active deployments. Logs stream in real-time. Destroy works.

---

## Phase 6 — Universal Agent Instructions (Week 4-5, depends on all phases)

**Why:** The market is fragmented across `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`. An instruction format compiler that translates between them is a moat-building play.

### Step 6.1 — Instruction format translation (4 hr)

**Context brief:** Build a compiler that converts between agent instruction formats. Users write once in their preferred format, output is compiled for the target tool.

**Tasks:**
1. Define a canonical intermediate representation (IR): `AgentInstructions { rules: Rule[]; context: string; tools: string[]; }`
2. Build parsers: `parseCursorrules()`, `parseClaudeMd()`, `parseAgentsMd()`, `parseCopilotInstructions()`
3. Build generators: `generateCursorrules()`, `generateClaudeMd()`, `generateAgentsMd()`, `generateCopilotInstructions()`
4. Detect agent type from environment (check for `.cursorrules`, `CLAUDE.md`, etc.)
5. `reporank agents sync` — reads all instruction files, merges into canonical IR, writes all formats
6. `reporank agents lint` — validates instruction files against a schema, reports conflicts between formats

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts agents sync
# → CLAUDE.md updated from .cursorrules
```

**Exit criteria:** Translation works bidirectionally between at least 3 formats. `sync` and `lint` commands work. Conflicts between formats are detected and reported.

### Step 6.2 — Context-aware rule suggestions (4 hr)

**Context brief:** Based on project analysis (language, frameworks, test patterns), suggest relevant AGENTS.md rules that the project should have.

**Tasks:**
1. Analyze project: detect language(s), frameworks, test framework, CI system, package manager
2. Map project characteristics to recommended rules (e.g., "uses TypeScript" → "add type safety rules")
3. `reporank agents suggest` — list recommended rules with rationale
4. `reporank agents suggest --apply` — append suggested rules to AGENTS.md
5. Model the suggestion engine as a decision tree (not LLM — deterministic, fast, auditable)

**Verification:**
```powershell
node $tsx apps/cli/src/index.ts agents suggest
# → "Based on your project (TypeScript, React, Vitest): consider adding rules for..."
```

**Exit criteria:** Suggestions are relevant to the project. Applying them produces valid instruction files. No LLM calls needed for suggestions.

### Step 6.3 — Orchestrator feedback loop (6 hr)

**Context brief:** The orchestrator UI should show quality gate results inline, and learn from the user's decisions to improve future verification.

**Tasks:**
1. In orchestrator UI, after agent completes edits, show result of `reporank verify --diff`
2. Allow user to "accept" or "reject" each finding (not just the whole diff)
3. Store accepted/rejected findings as memory (`vs_memory_store` with `review_decision` context)
4. Update `reporank verify` threshold based on historical acceptance rates
5. Add "training mode": user marks findings as correct/incorrect, system learns to match their judgment
6. Show quality score trend over time in the orchestrator dashboard

**Verification:**
```powershell
# Agent makes edit → verify runs → user rejects one finding → next verify excludes similar findings
```

**Exit criteria:** Verify results shown in orchestrator UI. User can accept/reject individual findings. Rejected finding types are deprioritized in future runs.

---

## Summary

| Phase | Name | Steps | Est. Effort | Parallel | Dependencies |
|---|---|---|---|---|---|
| 1 | Quality Gate | 3 | 11 hr | — | None |
| 2 | Visual Orchestrator | 4 | 30 hr | — | None |
| 3 | Model Router | 3 | 12 hr | Parallel with Phase 2 | None |
| 4 | Session Memory | 3 | 16 hr | — | Phase 2 |
| 5 | Infra Deployment | 4 | 26 hr | — | Phase 2 scaffold |
| 6 | Universal Instructions | 3 | 14 hr | — | All phases |
| | **Total** | **20** | **~109 hr** | | |

## Immediate Next Step

Confirm priority order, then start Phase 1 Step 1.1 (`reporank verify` CLI command). It's the highest-ROI single task: turns your benchmark infra into a product, takes 4 hours, and pays compounding dividends through every later phase.
