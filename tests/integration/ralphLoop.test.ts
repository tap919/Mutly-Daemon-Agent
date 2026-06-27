import { describe, it, expect, beforeEach } from "vitest";
import {
  RalphLoop,
  IllegalTransitionError,
  TERMINAL_DONE_SIGNAL,
  TERMINAL_ERROR_SIGNAL,
  type RalphEvent,
} from "../../server/buildPipeline/ralphLoop.js";

beforeEach(() => {});

describe("RalphLoop — happy path", () => {
  it("starts in IDLE and follows the happy path to DONE", () => {
    const loop = new RalphLoop();
    expect(loop.state).toBe("IDLE");
    loop.ok("DONE");
    expect(loop.state).toBe("DONE");
    expect(loop.isTerminal).toBe(true);
  });

  it("walks LOAD_WORKFLOW → INGEST → AUDIT → PLAN → BUILD → REVIEW → READY → DONE", () => {
    const loop = new RalphLoop();
    const states: string[] = [];
    loop.subscribe((e) => { if (e.type === "transition") states.push(`${e.from}→${e.to}`); });
    loop.ok("READY");
    loop.transition("DONE");
    expect(states).toEqual([
      "IDLE→LOAD_WORKFLOW",
      "LOAD_WORKFLOW→INGEST",
      "INGEST→AUDIT",
      "AUDIT→PLAN",
      "PLAN→BUILD",
      "BUILD→REVIEW",
      "REVIEW→READY",
      "READY→DONE",
    ]);
  });

  it("increments the iteration counter on ITERATE", () => {
    const loop = new RalphLoop();
    loop.ok("REVIEW");
    expect(loop.iteration).toBe(0);
    loop.transition("ITERATE");
    expect(loop.iteration).toBe(1);
    loop.transition("BUILD");
    loop.transition("REVIEW");
    loop.transition("ITERATE");
    expect(loop.iteration).toBe(2);
  });
});

describe("RalphLoop — error path", () => {
  it("can fail from any non-terminal state", () => {
    const loop = new RalphLoop();
    loop.ok("AUDIT");
    loop.fail("audit crashed", "AUDIT");
    expect(loop.state).toBe("ERROR");
    expect(loop.errorMessage).toBe("audit crashed");
  });

  it("emits MUTLY_ERROR terminal signal on ERROR", () => {
    const loop = new RalphLoop();
    const events: RalphEvent[] = [];
    loop.subscribe((e) => events.push(e));
    loop.fail("boom", "IDLE");
    const term = events.find((e) => e.type === "terminal");
    expect(term).toBeDefined();
    expect(term!.signal).toBe(TERMINAL_ERROR_SIGNAL);
  });

  it("emits MUTLY_DONE terminal signal on DONE", () => {
    const loop = new RalphLoop();
    const events: RalphEvent[] = [];
    loop.subscribe((e) => events.push(e));
    loop.ok("DONE");
    const term = events.find((e) => e.type === "terminal");
    expect(term!.signal).toBe(TERMINAL_DONE_SIGNAL);
  });
});

describe("RalphLoop — illegal transitions", () => {
  it("rejects skipping required phases (IDLE → BUILD)", () => {
    const loop = new RalphLoop();
    expect(() => loop.transition("BUILD")).toThrow(IllegalTransitionError);
  });

  it("rejects re-transitioning from a terminal state", () => {
    const loop = new RalphLoop();
    loop.ok("DONE");
    expect(() => loop.transition("ERROR")).toThrow(IllegalTransitionError);
  });

  it("nextAfterReview returns ITERATE only when both flags are true", () => {
    const loop = new RalphLoop();
    expect(loop.nextAfterReview({ shouldIterate: true, canIterate: true })).toBe("ITERATE");
    expect(loop.nextAfterReview({ shouldIterate: true, canIterate: false })).toBe("READY");
    expect(loop.nextAfterReview({ shouldIterate: false, canIterate: true })).toBe("READY");
    expect(loop.nextAfterReview({ shouldIterate: false, canIterate: false })).toBe("READY");
  });
});

describe("RalphLoop — config + reset", () => {
  it("attachConfig makes config observable", () => {
    const loop = new RalphLoop();
    loop.attachConfig({ risk: "high", max_iterations: 7 } as any);
    expect(loop.config?.risk).toBe("high");
  });

  it("reset returns to IDLE with iteration=0 and no error", () => {
    const loop = new RalphLoop();
    loop.ok("REVIEW");
    loop.transition("ITERATE");
    loop.fail("nope", "BUILD");
    expect(loop.state).toBe("ERROR");
    loop.reset();
    expect(loop.state).toBe("IDLE");
    expect(loop.iteration).toBe(0);
    expect(loop.errorMessage).toBeNull();
  });
});
