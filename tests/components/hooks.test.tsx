// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useAgentState } from "../../src/hooks/useAgentState";
import { useWorkflow } from "../../src/hooks/useWorkflow";

describe("useAgentState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns loading initially", () => {
    const { result } = renderHook(() => useAgentState(0)); // disable interval
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("fetches and returns agent state", async () => {
    const fakeState = { id: "test-agent", status: "running" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeState,
    } as Response);

    const { result } = renderHook(() => useAgentState(0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(fakeState);
    expect(result.current.error).toBeNull();
  });

  it("handles fetch error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAgentState(0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("Network error");
  });

  it("handles non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() => useAgentState(0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("HTTP 404");
  });
});

describe("useWorkflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns loading initially", () => {
    const { result } = renderHook(() => useWorkflow("test-workflow"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("fetches and returns workflow state", async () => {
    const fakeWorkflow = { id: "test-workflow", steps: ["a", "b"] };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeWorkflow,
    } as Response);

    const { result } = renderHook(() => useWorkflow("test-workflow"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(fakeWorkflow);
    expect(result.current.error).toBeNull();
  });

  it("handles fetch error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useWorkflow("test-workflow"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("Network error");
  });

  it("handles non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() => useWorkflow("test-workflow"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("HTTP 404");
  });
});
