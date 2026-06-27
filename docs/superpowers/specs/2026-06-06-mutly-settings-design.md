# Mutly Settings & Control Plane Design

**Date:** 2026-06-06
**Status:** Draft
**Version:** 1.1
**Author:** Overlay Eco / ncsound919

---

## 1. Problem Statement

Mutly currently has a single configuration source — environment variables validated by `server/config.ts` via Zod. This covers infrastructure defaults (host, port, log level, API endpoints) but leaves everything else hardcoded: agent identity, MCP server definitions, runtime feature flags, pipeline governance, and scalability limits.

To make Mutly **adaptable, reconfigurable, and observable at runtime**, the configuration model must be split into multiple layered sources with distinct change mechanisms, and surfaced through a unified **Settings Control Plane** UI.

**Design goals:**
- No restart required for agent behavior, feature flags, or MCP server changes
- All runtime state readable and writable through a typed API
- UI always reflects the live merged config — never stale
- Secrets and infrastructure config remain env-only and read-only in the UI

---

## 2. Architecture: Five Configuration Sources

```
┌──────────────────────────────────────────────────────────────────────┐
│                      MUTLY SETTINGS ARCHITECTURE                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐     │
│  │   .env     │  │ soul.md  │  │ mcp.json │  │ config.json   │     │
│  │ (secrets,  │  │ (agent   │  │ (MCP     │  │ (integrations,│     │
│  │  ports,    │  │  identity│  │  servers,│  │  flags,       │     │
│  │  infra)    │  │  & tone) │  │  tools)  │  │  pipelines,   │     │
│  │            │  │          │  │          │  │  scalability) │     │
│  └────┬───────┘  └────┬─────┘  └────┬─────┘  └───┬───────────┘     │
│       │          hot- │       hot-  │       runtime│ API            │
│   restart       reload│      reload │              │                 │
│   required            │             │              │                 │
│       v               v             v              v                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │               Config Loader  (server/settings/)             │    │
│  │  · Reads all sources on startup and on reload               │    │
│  │  · Merge order: soul.md → mcp.json → config.json → .env    │    │
│  │  · Validates each source with dedicated Zod schemas         │    │
│  │  · Exposes /api/settings for reads and runtime writes       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│              ┌──────────────────────────┐                            │
│              │  mutly.heartbeat.json    │  ← daemon write target     │
│              │  (NOT a config source)   │     every N seconds        │
│              └──────────────────────────┘                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Source Priority (lowest → highest)

| Priority | Source | Change Mechanism | Scope |
|---|---|---|---|
| 1 | `mutly.soul.md` | Hot-reload via `fs.watch` | Agent identity & behavior |
| 2 | `mutly.mcp.json` | Hot-reload via `fs.watch` | MCP server registry |
| 3 | `mutly.config.json` | Runtime API (`PUT /api/settings/config`) | Feature flags, pipelines, integrations |
| 4 | `.env` / env vars | Restart required | Secrets, ports, infra |
| 5 | Runtime API toggle | Session-only (not persisted) | Live feature flag overrides |

Higher-priority sources override lower-priority ones. Session-level toggles (priority 5) are lost on daemon restart and are never written to disk.

---

## 3. Configuration Sources

### 3.1 `.env` — Environment Variables

Unchanged from current `server/config.ts`. Restart required for changes.

- `SERVER_PORT`, `SERVER_HOST`
- `LOG_LEVEL`, `OTLP_ENDPOINT`
- `REDIS_URL`
- `VIBESERVE_MCP_URL`, `VIBESERVE_API_KEY`
- `REPORANK_API_URL`, `REPORANK_API_KEY`
- `MUTLY_DEFAULT_MODEL`, `MUTLY_FALLBACK_MODEL`
- `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`

**UI behavior:** Shown read-only in the Environment Config tab. Each row displays a `RESTART REQUIRED` badge. No API writes permitted.

---

### 3.2 `mutly.soul.md` — Agent Identity

A Markdown file with YAML frontmatter defining the agent's persona, constraints, and allowed tools. The body is the system prompt template, supporting `{{SLOT}}` markers for dynamic context injection.

```yaml
---
name: Mutly
role: Build Pipeline Agent
version: "1.0"
mission: Reliably transform specs into production-ready code
tone: professional, clear, concise
guardrails:
  - Never use eval() in production code
  - Always run RepoRank review before marking a task complete
  - Handle all async errors with try/catch
allowed_tools:
  - create_file
  - apply_diff
  - delete_file
  - read_file
  - run_command
denied_tools:
  - eval
defaults:
  auto_commit: true
  ask_before_delete: true
  review_threshold: 0.4
---

You are {{name}}, a {{role}} working on {{workspace_name}}.

Your current task: {{task_description}}

...
```

**Hot-reload:** Daemon watches `mutly.soul.md` via `fs.watch`. On change, `soulParser.ts` re-parses frontmatter and re-registers the system prompt — no restart needed.

**Validation:** Zod schema enforces required fields (`name`, `role`, `mission`, `tone`). Unknown keys are allowed to support user extension.

---

### 3.3 `mutly.mcp.json` — MCP Server Definitions

Defines which MCP servers are registered, which tools they expose, and how responses are guarded.

```json
{
  "servers": [
    {
      "name": "vibeserve",
      "command": "node",
      "args": ["path/to/vibeserve-server.js"],
      "env": {
        "VIBESERVE_URL": "http://127.0.0.1:8000"
      },
      "tools": {
        "allow": ["vibe_code", "vibe_review", "vibe_architect"],
        "deny": ["vibe_deploy"]
      },
      "response_guards": {
        "max_chars": 12000,
        "strip_instructions": true,
        "redact_secrets": true
      }
    },
    {
      "name": "reporank",
      "command": "node",
      "args": ["path/to/reporank-client.js"],
      "tools": {
        "allow": ["review", "grade", "audit"],
        "deny": []
      }
    }
  ]
}
```

**Hot-reload:** On change, the daemon de-registers active MCP connections and re-registers from the updated file. In-flight tool calls complete before re-registration.

**Note:** Secrets for MCP servers (API keys, tokens) should be injected via env vars referenced in `env` blocks — never stored in this file directly.

---

### 3.4 `mutly.config.json` — Runtime Configuration

The primary runtime configuration file. Readable and writable through the settings API. Changes take effect immediately without restart.

```json
{
  "features": {
    "main_agent_enabled": true,
    "adaptive_routing": false,
    "autonomous_pipelines": true,
    "human_approvals": true,
    "autonomy_kill_switch": false
  },
  "agent": {
    "mode": "auto",
    "max_concurrent_sub_agents": 4,
    "memory_backend": "redis",
    "soul_file": "mutly.soul.md",
    "heartbeat_file": "mutly.heartbeat.json",
    "heartbeat_interval_seconds": 30
  },
  "integrations": {
    "vibeserve": {
      "enabled": true,
      "url": "http://127.0.0.1:8000",
      "tool_timeout_ms": 10000,
      "max_retries": 3
    },
    "reporank": {
      "enabled": true,
      "url": "http://localhost:3001"
    },
    "google_ax": {
      "enabled": false,
      "endpoint": "",
      "project": ""
    }
  },
  "pipeline": {
    "drift_threshold": 0.3,
    "review_threshold": 0.4,
    "approval_policy": {
      "require_for": ["delete_file", "deploy"]
    },
    "default_template": "build"
  },
  "sub_agents": {
    "token_budget": 8000,
    "scope_boundary": "src/",
    "audit_trail": true,
    "timeout_ms": 120000
  }
}
```

**Write safety:** The API validates all writes with the Zod config schema before flushing to disk. Validation failures return `400` with structured errors — the file is never partially written.

---

### 3.5 `mutly.heartbeat.json` — Daemon Write Target

Written by the daemon every `heartbeat_interval_seconds`. This is **not** a configuration source — it is telemetry output. The UI reads it for the Diagnostics tab.

```json
{
  "last_seen": "2026-06-06T00:15:22Z",
  "uptime_seconds": 847,
  "phase": "idle",
  "active_sessions": 3,
  "pipelines_run": 42,
  "memory_usage_mb": 5.2,
  "heartbeat_interval_seconds": 30
}
```

---

## 4. Config Loader: Merge & Validation

`server/settings/loader.ts` is the single entry point for all config consumption. It:

1. Reads each source at startup in priority order
2. Deep-merges into a single `MutlyConfig` object (env overrides config.json; config.json overrides mcp.json; etc.)
3. Validates each source with its own Zod schema — validation errors are **non-fatal** for optional sources (soul.md, mcp.json) but **fatal** for config.json and env
4. Registers `fs.watch` listeners on hot-reloadable files
5. Exposes a `getConfig()` function for internal consumers — no module should read config files directly

**Session overrides** (from `POST /api/settings/toggle`) are stored in-memory via `sessionOverrides.ts` as a shallow patch layer on top of the merged config. They are never flushed to disk and are cleared on daemon restart.

---

## 5. UI: Settings Control Plane

Five tabs, each reflecting a logical grouping of configuration concerns.

### 5.1 Agents Tab

Controls the daemon's operational posture and sub-agent constraints.

- **Main Agent** — runtime toggle → `features.main_agent_enabled`
- **Agent Mode** — select (AUTO / SUPERVISED / MANUAL) → `agent.mode`
- **Max Concurrent Sub-Agents** — number input → `agent.max_concurrent_sub_agents`
- **Soul File** — text input → `agent.soul_file` (path to soul.md)
- **Heartbeat File** — text input → `agent.heartbeat_file`
- **Heartbeat Interval** — number input (seconds) → `agent.heartbeat_interval_seconds`
- **Memory Backend** — select (Redis / SQLite / In-Memory / File) → `agent.memory_backend`
- **Sub-Agent Token Budget** — number input → `sub_agents.token_budget`
- **Sub-Agent Scope Boundary** — text input → `sub_agents.scope_boundary`
- **Audit Trail** — runtime toggle → `sub_agents.audit_trail`

### 5.2 Integrations Tab

Integration-specific cards, each with an enable toggle and connection details.

- **VibeServe MCP** — enable toggle, URL, tool timeout (ms), max retries
- **RepoRank** — enable toggle, API URL *(key shown as env-backed, read-only)*
- **Redis Cache** — URL, audit TTL, state TTL *(all env-backed, read-only)*
- **Google AX** — endpoint, project *(env-backed unless overridden by config.json)*

Each card includes a **Test Connection** button that hits `/api/settings/integration/:name/health`.

### 5.3 Runtime Controls Tab

Live feature flags and routing decisions. These take effect immediately — no page reload.

- **Adaptive Routing** — toggle → `features.adaptive_routing`
- **Autonomous Pipelines** — toggle → `features.autonomous_pipelines`
- **Human Approvals** — toggle → `features.human_approvals`
- **Autonomy Kill Switch** — prominent banner toggle → `features.autonomy_kill_switch` *(disables all autonomous actions globally)*
- **Default Model** — text *(env-backed, read-only)*
- **Fallback Model** — text *(env-backed, read-only)*
- **Default Routing Path** — select (native / vibeserve / auto)

### 5.4 Environment Config Tab

Read-only snapshot of all resolved env vars from `server/config.ts`.

- Each row: key, masked/unmasked value, `RESTART REQUIRED` badge
- Secrets (`API_KEY`, `PASSWORD`, `SECRET`) are masked by default with a show/hide toggle
- A **Copy Key** button copies the env var name (not value) for reference

### 5.5 Diagnostics Tab

- **Stats grid:** Uptime, Phase, Active Sessions, Pipelines Run (sourced from heartbeat.json)
- **Agent Health:** Daemon status indicator, last heartbeat timestamp, soul sync status
- **Integration Health:** Per-integration status dot + response time bar
- **Observability:** Log level selector *(env-backed, shows restart warning on change)*, OTLP endpoint display
- **Hot-Reload Actions:** Buttons for `Reload Soul File` and `Reload MCP Config` (calls `POST /api/settings/reload/soul` and `POST /api/settings/reload/mcp`)

---

## 6. Runtime API Endpoints

All endpoints require the daemon to be running. The Settings UI is unavailable (shows a "Daemon Offline" state) if the API is unreachable.

```
GET  /api/settings                          → full merged config (all sources)
GET  /api/settings/config                   → mutly.config.json contents
PUT  /api/settings/config                   → update mutly.config.json (Zod-validated)
POST /api/settings/toggle                   → set a single feature flag (session-only)
GET  /api/settings/integration/:name/health → health check for named integration
GET  /api/settings/env                      → resolved env vars (read-only, secrets masked)
POST /api/settings/reload/soul              → hot-reload mutly.soul.md
POST /api/settings/reload/mcp               → hot-reload mutly.mcp.json
```

**Error contract:** All endpoints return `{ ok: boolean, error?: string, details?: ZodError[] }`. `PUT /api/settings/config` with a validation error returns `400` and never writes to disk.

---

## 7. Phase Plan

### Phase 1 — Foundation *(this sprint)*
- Create `server/settings/` module with config loader, merge logic, and Zod schemas
- Implement `mutly.config.json` read/write with validation
- Implement runtime API endpoints (GET, PUT, POST toggle, GET env)
- Parse `mutly.soul.md` frontmatter via `soulParser.ts`
- Write `mutly.heartbeat.json` via `heartbeat.ts`
- Add Settings UI tab: Agents + Runtime Controls + Environment Config (read-only)

### Phase 2 — Integrations & MCP
- Implement `mutly.mcp.json` hot-reload and server re-registration
- Wire MCP server registration to config file (replace hardcoded definitions)
- Add Integrations tab with health check cards
- Add Diagnostics tab reading from heartbeat.json

### Phase 3 — Governance & Observability
- Add hot-reload for `mutly.soul.md` with `fs.watch`
- Add audit trail for all config writes (who changed what, when)
- Add per-agent policy rules and approval gates
- Scalability auto-tuning (auto-adjust `max_concurrent_sub_agents` based on load)

---

## 8. Files Created / Modified

| File | Action | Purpose |
|---|---|---|
| `server/settings/loader.ts` | Create | Loads, merges, and exposes all config sources |
| `server/settings/configSchema.ts` | Create | Zod schemas for `mutly.config.json` |
| `server/settings/soulParser.ts` | Create | Parses YAML frontmatter from `mutly.soul.md` |
| `server/settings/heartbeat.ts` | Create | Writes and reads `mutly.heartbeat.json` |
| `server/settings/routes.ts` | Create | All `/api/settings/*` endpoints |
| `server/settings/sessionOverrides.ts` | Create | In-memory session-level flag store |
| `server/config.ts` | Modify | Integrate with loader; add version check |
| `src/components/Settings.tsx` | Create | React Settings panel (5 tabs) |
| `src/App.tsx` | Modify | Add Settings tab and daemon-offline guard |
| `mutly.soul.md` | Create | Default agent identity |
| `mutly.config.json` | Create | Default runtime configuration |
| `mutly.mcp.json` | Create | Default MCP server definitions |

---

## 9. Open Questions & Recommendations

| # | Question | Recommendation |
|---|---|---|
| 1 | Should `mutly.config.json` be committed to the repo? | **Yes** — commit with safe defaults; add a `.config.local.json` override pattern for local customization; gitignore the local variant |
| 2 | Should Settings UI be available when the daemon is offline? | **No** — show a "Daemon Offline" banner; the Environment Config tab (static env snapshot) may still render read-only from a cached last-known state |
| 3 | Should `soul.md` support full Markdown or just YAML frontmatter? | **Both** — YAML frontmatter for structured fields (validated by Zod); free-form Markdown body for the system prompt template |
| 4 | What happens when a hot-reload produces an invalid file? | **Reject and alert** — keep the previous valid config in memory; emit a `config.reload.failed` event; show an error banner in the Diagnostics tab |
| 5 | Should `POST /api/settings/toggle` session overrides survive across browser sessions? | **No** — session overrides are daemon-scoped, not client-scoped; they reset on daemon restart, ensuring determinism |
