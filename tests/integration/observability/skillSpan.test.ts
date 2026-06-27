import { describe, it, expect, vi } from "vitest";
import { withSkillSpan, withAgentSpan } from "../../../server/observability/skillSpan.js";

describe("withSkillSpan", () => {
  it("creates a span with skill name and duration attributes", async () => {
    const recorded: any[] = [];
    const tracer = {
      startActiveSpan: (name: string, fn: (span: any) => any) => {
        const span = {
          setAttribute: vi.fn((k, v) => recorded.push({ k, v })),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(() => recorded.push({ event: "end" })),
        };
        return fn(span);
      },
    };

    const result = await withSkillSpan(tracer as any, "my-skill", async () => {
      return { output: 42 };
    });
    expect(result).toEqual({ output: 42 });
    expect(recorded.some((r) => r.k === "skill.name" && r.v === "my-skill")).toBe(true);
    expect(recorded.some((r) => r.event === "end")).toBe(true);
  });

  it("records exception and sets error status on failure", async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (_: string, fn: (s: any) => any) => fn(span),
    };

    await expect(
      withSkillSpan(tracer as any, "failing-skill", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(span.recordException).toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: expect.stringContaining("boom") });
    expect(span.end).toHaveBeenCalled();
  });
});

describe("withAgentSpan", () => {
  it("creates a span with agent name, capabilities, and duration", async () => {
    const recorded: any[] = [];
    const span = {
      setAttribute: vi.fn((k, v) => recorded.push({ k, v })),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (_: string, fn: (s: any) => any) => fn(span),
    };

    const result = await withAgentSpan(
      tracer as any,
      { name: "code-agent", capabilities: ["implement", "fix"] },
      async () => ({ applied: 3 })
    );
    expect(result).toEqual({ applied: 3 });
    expect(recorded.some((r) => r.k === "agent.name" && r.v === "code-agent")).toBe(true);
    expect(recorded.some((r) => r.k === "agent.capabilities" && r.v === "implement,fix")).toBe(true);
    expect(span.end).toHaveBeenCalled();
  });
});
