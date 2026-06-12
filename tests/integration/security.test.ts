import { describe, expect, it } from "vitest";
import { resolvePathInWorkspace } from "../../server/lib/workspacePaths.js";
import { sanitizeArgsForApproval } from "../../server/lib/sanitizeApprovalArgs.js";
import { validateMcpUrl } from "../../server/tools/mcp/mcpVibeServeClient.js";
import {
  ApprovalResolutionError,
  approvalStore,
} from "../../server/policy/approvalStore.js";

describe("security hardening", () => {
  it("blocks path traversal via prefix trick", () => {
    const root = "C:\\Users\\app";
    const evil = resolvePathInWorkspace(root, "..\\app-evil\\secret.txt");
    expect(evil.ok).toBe(false);
  });

  it("redacts sensitive approval args", () => {
    const sanitized = sanitizeArgsForApproval("create_file", {
      filePath: "src/a.ts",
      content: "secret code ".repeat(100),
    });
    expect(String(sanitized.content)).toContain("REDACTED");
    expect(sanitized.filePath).toBe("src/a.ts");
  });

  it("blocks remote MCP URLs by default", () => {
    expect(validateMcpUrl("http://169.254.169.254/latest")).toBeTruthy();
    expect(validateMcpUrl("http://127.0.0.1:8000")).toBeNull();
  });

  it("rejects expired approval resolution", async () => {
    const id = "exp-test-1";
    await approvalStore.addRequest({
      id,
      correlationId: "wf-exp",
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      summary: "expired test",
      riskTier: "orange",
      filesAffected: [],
      route: "native",
      tool: "create_file",
      parametersSummary: {},
      blastRadius: { estimatedFiles: 1, isDestructive: false, isIrreversible: false },
    });
    await expect(approvalStore.resolveRequest(id, "approved")).rejects.toThrow(
      ApprovalResolutionError
    );
  });
});
