import { describe, it, expect, beforeEach } from "vitest";
import { setFlag, getFlag, getAllFlags, clearFlags, removeFlag, hasOverride } from "../../../server/settings/sessionOverrides.js";

describe("sessionOverrides", () => {
  beforeEach(() => clearFlags());

  it("setFlag stores and getFlag retrieves", () => {
    setFlag("adaptive_routing", true);
    expect(getFlag("adaptive_routing")).toBe(true);
  });

  it("getFlag returns undefined for unset key", () => {
    expect(getFlag("nonexistent")).toBeUndefined();
  });

  it("getAllFlags returns all overrides", () => {
    setFlag("a", true);
    setFlag("b", false);
    expect(getAllFlags()).toEqual({ a: true, b: false });
  });

  it("removeFlag removes a single flag", () => {
    setFlag("x", true);
    expect(removeFlag("x")).toBe(true);
    expect(getFlag("x")).toBeUndefined();
  });

  it("hasOverride returns true only for set flags", () => {
    expect(hasOverride("test")).toBe(false);
    setFlag("test", true);
    expect(hasOverride("test")).toBe(true);
  });

  it("clearFlags removes all overrides", () => {
    setFlag("a", true);
    setFlag("b", false);
    clearFlags();
    expect(getAllFlags()).toEqual({});
  });
});
