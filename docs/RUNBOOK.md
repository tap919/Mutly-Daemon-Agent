# Mutly Production Runbook

## Topology

```
Dashboard / VS Code / OpenCode
        │
        ▼
Mutly Daemon (port 3000 default)
  ├── HTTP API (X-Mutly-API-Key)
  ├── WebSocket (same key via header or Sec-WebSocket-Protocol)
  ├── Inngest (/api/inngest)
  └── VibeServe HTTP bridge (vs_* tools)
```

## Startup

1. Copy `.env.example` → `.env` and set secrets.
2. Start VibeServe bridge (if enabled): `python -m vibeserve --http` on port 8000.
3. Start Mutly: `npm run dev` (development) or `npm run build && npm start` (production).
4. Verify: `GET /health` (public) and `GET /api/agent/health` (authenticated).

### Required production env

| Variable | Purpose |
|----------|---------|
| `MUTLY_API_KEY` | API auth (required in production) |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) |
| `VIBESERVE_REQUIRE_AUTH=true` | Fail-closed VibeServe bridge |
| `AUTONOMY_KILL_SWITCH=false` | Emergency stop for autonomous runs |

## Approvals

- Pending approvals persist to `data/approvals.json`.
- List: `GET /api/agent/approvals`
- Resolve: `POST /api/agent/approvals/:id/resolve` with `{ "decision": "approved"|"rejected" }`
- Tool-level pauses save ReAct state; approval resumes the loop via `resumeStepAfterApproval`.
- Inngest workflows wait on `mutly/approval.resolved` events (emitted by approval store).

## Kill switch

Set `AUTONOMY_KILL_SWITCH=true` and restart. Autonomous pipelines and policy-gated writes should halt.

## Backup

Persist and back up:

- `data/approvals.json`
- `data/workflow-state-*.json`
- `data/react-pause-*.json` (if present)
- `audit.log`
- `db.json` (daemon UI state)

## Inngest

- Configure `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`.
- Trigger durable workflow: `POST /api/agent/workflow/inngest` with plan payload.
- High-risk plans (>2 High steps) pause for workflow approval before execution.

## VibeServe

- Enable: `ENABLE_VIBESERVE_MCP=true`
- Set matching keys: `VIBESERVE_MUTLY_API_KEY` on VibeServe, `VIBESERVE_API_KEY` on Mutly client.
- Health: VibeServe `GET /health`, Mutly checks via `checkVibeServeHealth()`.

## VS Code extension

- Default daemon port: **3000** (configurable via `mutly.daemonPort`).
- Set API key via command `mutly.setApiKey` or `mutly.apiKey` setting.

## CI / release checklist

```bash
npm run typecheck
npm run secretlint
npm run test:integration
cd ../VibeServe-main && python -m pytest tests/test_mutly_integration.py -q
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 401 on all API calls | `MUTLY_API_KEY` alignment (dev default: `dev_mutly_secure_master_key`) |
| WS disconnect 4401 | Pass key in `X-Mutly-API-Key` or WebSocket subprotocol |
| Workflow stuck paused | Pending approval in `data/approvals.json`; resolve via API |
| VibeServe unreachable | Bridge running, auth keys match, `VIBESERVE_MCP_URL` correct |
| Sandbox fails on Windows | Uses `%TEMP%\\mutly-sandbox-workspace`; override with `MUTLY_SANDBOX_DIR` |
