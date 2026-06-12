import { describe, it, expect } from "vitest";
import { inngestFunctions } from "../../../server/inngest/functions.js";
import { inngestFunctions as periodicJobs } from "../../../server/inngest/periodicJobs.js";
import { classifyToolSeverity } from "../../../server/inngest/eventDrivenJobs.js";

describe("inngest functions registration", () => {
  it("exports combined inngestFunctions array", () => {
    expect(Array.isArray(inngestFunctions)).toBe(true);
    expect(inngestFunctions.length).toBe(6);
  });

  it("periodicJobs exports 3 functions", () => {
    expect(periodicJobs.length).toBe(3);
  });

  it("each function has a unique name via constructor", () => {
    const names = inngestFunctions.map((fn) => (fn as any)?.name ?? "anonymous");
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });
});

describe("classifyToolSeverity", () => {
  it("classifies permission errors as high", () => {
    expect(classifyToolSeverity("permission denied")).toBe("high");
    expect(classifyToolSeverity("forbidden")).toBe("high");
    expect(classifyToolSeverity("access denied")).toBe("high");
  });

  it("classifies timeout and not-found as medium", () => {
    expect(classifyToolSeverity("timeout")).toBe("medium");
    expect(classifyToolSeverity("not found")).toBe("medium");
    expect(classifyToolSeverity("file missing")).toBe("medium");
  });

  it("classifies generic errors as low", () => {
    expect(classifyToolSeverity("something went wrong")).toBe("low");
    expect(classifyToolSeverity("unexpected error")).toBe("low");
  });
});
