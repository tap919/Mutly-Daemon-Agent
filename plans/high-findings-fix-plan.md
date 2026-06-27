# HIGH Findings Fix Plan — Top 5

**Date:** June 9, 2026  
**Scope:** 5 HIGH-severity audit findings across Mutly, VibeServe, RepoRank  
**Execution:** 3 parallel agents (one per component)

---

## Fix 1: Timer leak on step timeout

**File:** `Mutly-Daemon-Agent/server/planning/react-loop.ts:690-692`  
**Severity:** HIGH  
**Root cause:** `setTimeout` at line 691 creates a timer that is never cleared. When `executeStep()` resolves before the timeout, the orphaned timer keeps running and eventually fires `reject()` on an already-settled promise — producing an unhandled rejection. Over many steps, orphaned timers accumulate.

### Current code (lines 690-704)
```typescript
const timeoutPromise = new Promise<StepResult>((_, reject) => {
  setTimeout(() => reject(new Error(`Step "${step.id}" timed out`)), this.config.stepTimeoutMs);
});

let result: StepResult;
try {
  result = await Promise.race([executeStep(step, span), timeoutPromise]);
} catch (err) {
  result = { success: false, exitCode: 1, error: err instanceof Error ? err.message : String(err) };
}
```

### Fix
Store the timer handle and clear it in a `finally` block:
```typescript
let timer: ReturnType<typeof setTimeout> | undefined;
const timeoutPromise = new Promise<StepResult>((_, reject) => {
  timer = setTimeout(() => reject(new Error(`Step "${step.id}" timed out`)), this.config.stepTimeoutMs);
});

let result: StepResult;
try {
  result = await Promise.race([executeStep(step, span), timeoutPromise]);
} catch (err) {
  result = { success: false, exitCode: 1, error: err instanceof Error ? err.message : String(err) };
} finally {
  if (timer) clearTimeout(timer);
}
```

### Tests
Add to `tests/server/planning/react-loop.test.ts`:
- Verify no pending timers after step completes successfully
- Verify no pending timers after step times out

---

## Fix 2: Budget guard non-functional

**File:** `Mutly-Daemon-Agent/server/planning/react-loop.ts:623-624`  
**Severity:** HIGH  
**Root cause:** `checkBudget()` compares `tokenUsage` (a count) against `maxCost * 100_000` (a dollar-derived number). But `tokenUsage` is incremented by hardcoded approximations (500, 1000) — not actual token counts from LLM responses. The `costIncurred` field (line 63) already tracks dollar cost and is incremented correctly (line 766: `+= 0.002`). The budget guard should use `costIncurred` instead.

### Current code (lines 623-624)
```typescript
private checkBudget(): boolean {
  if (this.state.tokenUsage > this.state.maxCost * 100_000) {
```

### Fix
Compare `costIncurred` (dollars) against `maxCost` (dollars):
```typescript
private checkBudget(): boolean {
  if (this.state.costIncurred >= this.state.maxCost) {
```

Also update the error message to include the actual cost:
```typescript
this.state.error = `Cost budget exceeded: $${this.state.costIncurred.toFixed(4)} >= $${this.state.maxCost}`;
```

### Tests
Update existing budget tests in `react-loop.test.ts` to use `costIncurred` instead of `tokenUsage`.

---

## Fix 3: Infinite loop via replan retry/fix

**File:** `Mutly-Daemon-Agent/server/planning/react-loop.ts:903-953`  
**Severity:** HIGH  
**Root cause:** The main loop condition is `stepIndex < steps.length && status === "running"`. When replan returns `"retry"`, `stepIndex` is NOT incremented (line 791). When replan returns `"fix"`, new steps are inserted but `stepIndex` stays the same (line 820). The `maxSteps` check (line 629) only checks `stepIndex`, not total execution attempts. A malicious or hallucinating LLM can keep returning "retry" or "fix" forever.

### Current code (lines 903-906)
```typescript
while (
  this.state.stepIndex < this.state.steps.length &&
  this.state.status === "running" &&
  !this.isCancelled()
) {
```

### Fix
Add a `totalAttempts` field to `PlanLoopState` and enforce a global attempt limit:

1. Add `totalAttempts: number` to `PlanLoopState` interface (line 51-66)
2. Initialize `totalAttempts: 0` in the constructor (around line 580)
3. Increment `totalAttempts` at the start of each loop iteration (after line 915)
4. Add check in `checkBudget()`:
```typescript
if (this.state.totalAttempts >= this.state.maxSteps * 3) {
  this.state.status = "cancelled";
  this.state.error = `Total attempts (${this.state.totalAttempts}) exceeded limit`;
  return false;
}
```

The `maxSteps * 3` multiplier allows for retries (maxRetriesPerStep=2) plus fix steps, while still capping total work.

### Tests
Add to `react-loop.test.ts`:
- Verify loop terminates after `maxSteps * 3` total attempts even with continuous "retry" replans

---

## Fix 4: ws.send() on closed WebSocket

**File:** `VibeServe-main/vibeserve/ts_bridge/bridge.ts:149-155`  
**Severity:** HIGH  
**Root cause:** After `await lifecycle.mcp.callTool()` (line 150), the WebSocket client may have disconnected during the async operation. `ws.send()` at line 152 throws `"WebSocket is not open: readyState 3 (CLOSED)"` — an unhandled exception that crashes the message handler and potentially the process.

### Current code (lines 149-155)
```typescript
try {
  const raw = await lifecycle.mcp.callTool(msg.name, msg.arguments ?? {});
  const result = parseMcpResult(raw);
  ws.send(JSON.stringify(result ?? { status: "success" }));
} catch (err: any) {
  ws.send(JSON.stringify({ status: "error", error: err.message }));
}
```

### Fix
Add a helper function and guard every `ws.send()`:
```typescript
function safeSend(ws: WebSocket, data: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}
```

Replace all `ws.send(...)` calls in the `createWss` function with `safeSend(ws, ...)`. This affects lines 139, 145, 152, 154, 157, 159.

Also guard the error message in the catch block (line 154) — if the socket closed during the error, we shouldn't try to send the error response either.

### Tests
Update `websocket.test.ts`:
- Add test: "does not crash when client disconnects during tool call"

---

## Fix 5: XML parser lacks explicit XXE/DOCTYPE protection

**File:** `reporank/packages/grading-engine/src/importers/sonarqube.ts:146-151`  
**Severity:** HIGH  
**Root cause:** `XMLParser` from `fast-xml-parser` is instantiated without explicitly disabling external entity resolution. While `fast-xml-parser` v5 does not resolve DTDs by default, defense-in-depth requires explicit configuration. A crafted SonarQube profile XML with `<!DOCTYPE>` or `<!ENTITY>` could behave unexpectedly in edge parser versions or if the library's defaults change.

### Current code (lines 146-151)
```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  textNodeName: "#text",
});
```

### Fix
Add `processEntities: false`:
```typescript
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  textNodeName: "#text",
  processEntities: false,
});
```

### Tests
Add to `sonarqube.test.ts`:
- Test: `parseQualityProfile` with XML containing `<!DOCTYPE>` or `<!ENTITY>` declarations — should parse without error and ignore entities

---

## Execution Plan

| Agent | Fixes | Files | Tests |
|-------|-------|-------|-------|
| **Mutly** | 1, 2, 3 | `react-loop.ts` | `react-loop.test.ts` |
| **VibeServe** | 4 | `bridge.ts` | `websocket.test.ts` |
| **RepoRank** | 5 | `sonarqube.ts` | `sonarqube.test.ts` |

All 3 agents run in parallel — no shared files.

## Verification (post-fix)

```bash
# Mutly
cd Mutly-Daemon-Agent && npx tsc --noEmit
cd Mutly-Daemon-Agent && npx vitest run tests/server/planning/react-loop.test.ts

# VibeServe
cd VibeServe-main/vibeserve/ts_bridge && npx vitest run

# RepoRank
cd reporank && pnpm --filter @reporank/grading-engine test
```
