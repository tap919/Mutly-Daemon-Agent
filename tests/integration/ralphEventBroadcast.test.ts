import { describe, it, expect, vi } from "vitest";
import {
  subscribeToRalphEvents,
  attachRalphLoop,
  formatEventForMcp,
} from "../../server/tools/ralphEventBroadcast.js";
import { RalphLoop } from "../../server/buildPipeline/ralphLoop.js";

describe("subscribeToRalphEvents", () => {
  it("receives events from attached loops", () => {
    const loop = new RalphLoop();
    const events: Array<{ from: string | null; to: string }> = [];
    const unsub = subscribeToRalphEvents((e) => {
      events.push({ from: e.from, to: e.to });
    });
    attachRalphLoop(loop);

    loop.ok("LOAD_WORKFLOW");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].to).toBe("LOAD_WORKFLOW");
    unsub();
  });

  it("unsub stops receiving events", () => {
    const loop = new RalphLoop();
    const events: Array<{ from: string | null; to: string }> = [];
    const unsub = subscribeToRalphEvents((e) => {
      events.push({ from: e.from, to: e.to });
    });
    attachRalphLoop(loop);
    unsub();

    loop.ok("LOAD_WORKFLOW");
    expect(events.length).toBe(0);
  });
});

describe("formatEventForMcp", () => {
  it("formats a transition event", () => {
    const e = { type: "transition" as const, from: null, to: "LOAD_WORKFLOW" as const, ts: Date.now(), iteration: 0 };
    const f = formatEventForMcp(e);
    expect((f.phase as any).from).toBeNull();
    expect((f.phase as any).to).toBe("LOAD_WORKFLOW");
    expect((f.meta as any).type).toBe("transition");
  });
});
