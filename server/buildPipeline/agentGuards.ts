/**
 * Sprint C.2 — agent guards (little_coder patterns).
 *
 * Two reusable middleware that wrap any LLM-driven agent call:
 *
 *   1. `repairToolCall` (output-parser)
 *      Tries to salvage a malformed tool call before failing.
 *      Handles: unclosed JSON, missing closing fence, stray backticks,
 *      "tool_use" / "<tool_call>" tag variants.
 *
 *   2. `monitorAgentResult` (quality-monitor)
 *      Inspects an agent's textual result and flags common failure
 *      modes: empty, loop, hallucinated file paths, unbacked "done"
 *      claims. Used by the Ralph Loop to decide whether to trust
 *      an agent's success signal before auto-committing.
 */
import fs from "fs";
import path from "path";

// ── 1. output-parser ─────────────────────────────────────────

/**
 * Best-effort repair of a malformed tool call. Returns:
 *   { repaired: true, value } on success
 *   { repaired: false, reason } on failure
 *
 * Recognized shapes (in priority order):
 *   - {"name": "...", "arguments": {...}}     # standard JSON
 *   - <tool_call>{"name":"...","args":{...}}</tool_call>
 *   - ```tool\n{"name":"...","args":{...}}\n```
 *   - tool_use: {"name":"...","input":{...}}
 */
export type RepairedToolCall = {
  name: string;
  arguments: Record<string, unknown>;
} | null;

export function repairToolCall(raw: string): { repaired: boolean; value: RepairedToolCall; reason?: string } {
  if (!raw || !raw.trim()) return { repaired: false, value: null, reason: "empty input" };
  let text = raw.trim();

  // 1. Try to extract a JSON object from any wrappers
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    return { repaired: false, value: null, reason: "no JSON object found" };
  }
  const jsonEnd = text.lastIndexOf("}");
  // If we find no closing brace, take everything from the first `{` to end of string.
  // (We'll add the missing `}` in the recovery step below.)
  const endIdx = jsonEnd > jsonStart ? jsonEnd + 1 : text.length;
  let json = text.slice(jsonStart, endIdx);

  // 2. Try parsing as-is
  let parsed: any;
  try { parsed = JSON.parse(json); }
  catch {
    // 3. Try closing the JSON if it's truncated.
    //    Walk through chars and append whichever close chars are missing.
    let inString = false;
    let escape = false;
    let openBraces = 0, closeBraces = 0, openBrackets = 0, closeBrackets = 0;
    for (let i = 0; i < json.length; i++) {
      const c = json[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") openBraces++;
      else if (c === "}") closeBraces++;
      else if (c === "[") openBrackets++;
      else if (c === "]") closeBrackets++;
    }
    if (inString) json += '"';
    if (openBrackets > closeBrackets) json += "]".repeat(openBrackets - closeBrackets);
    if (openBraces > closeBraces) json += "}".repeat(openBraces - closeBraces);
    try { parsed = JSON.parse(json); }
    catch { return { repaired: false, value: null, reason: "truncated JSON, cannot recover" }; }
  }

  // 4. Normalize shape
  const name = parsed.name ?? parsed.tool ?? parsed.function ?? parsed.tool_name;
  const args = parsed.arguments ?? parsed.args ?? parsed.input ?? parsed.parameters ?? {};
  if (typeof name !== "string" || !name) {
    return { repaired: false, value: null, reason: "missing 'name' field" };
  }
  if (typeof args !== "object" || args === null) {
    return { repaired: false, value: null, reason: "'arguments' is not an object" };
  }
  return { repaired: true, value: { name, arguments: args } };
}

// ── 2. quality-monitor ──────────────────────────────────────

export interface QualityContext {
  /** What the agent claimed it did (free text). */
  claim: string;
  /** Files the agent actually touched on disk. */
  filesChanged: string[];
  /** Workspace root for path validation. */
  workspaceRoot: string;
  /** Recent results from this agent — for loop detection. */
  history: Array<{ claim: string; filesChanged: string[] }>;
}

export type QualityVerdict =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

/** Heuristics, in order. The first failure short-circuits. */
export function monitorAgentResult(ctx: QualityContext): QualityVerdict {
  const warnings: string[] = [];

  // a. Empty result
  if (!ctx.claim || !ctx.claim.trim()) {
    return { ok: false, reason: "empty claim" };
  }

  // b. Loop detection: identical claim to any of the last 3
  const recent = ctx.history.slice(-3).map((h) => normalize(h.claim));
  if (recent.includes(normalize(ctx.claim))) {
    return { ok: false, reason: "loop: claim repeated verbatim" };
  }

  // c. Claim says it changed files but didn't
  const claimMentionsFileChange = /\b(creat|modif|writ|edit|chang|update|delete|remov)\w*\b/i.test(ctx.claim);
  if (claimMentionsFileChange && ctx.filesChanged.length === 0) {
    return { ok: false, reason: "claim mentions file change but no filesChanged recorded" };
  }

  // d. Files changed, but paths must be valid
  for (const f of ctx.filesChanged) {
    const abs = path.isAbsolute(f) ? f : path.resolve(ctx.workspaceRoot, f);
    if (!fs.existsSync(abs)) {
      return { ok: false, reason: `hallucinated file: ${f} does not exist on disk` };
    }
  }

  // e. "Done" / "complete" / "fixed" claims need at least one file change
  //    or the result must be very short (a one-line "no changes needed" is fine).
  const claimsDone = /\b(done|complete|fixed|shipped|applied|finished|success)\b/i.test(ctx.claim);
  if (claimsDone && ctx.filesChanged.length === 0 && ctx.claim.length > 200) {
    warnings.push("long success claim with no files changed — verify the work happened");
  }

  return { ok: true, warnings };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
