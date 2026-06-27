import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadDesignConfig, designPrompt } from "../../server/buildPipeline/designConfig.js";

describe("loadDesignConfig", () => {
  it("returns null when DESIGN.md does not exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-dd-"));
    const r = loadDesignConfig(dir);
    expect(r).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses front matter with components", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-dd-"));
    fs.writeFileSync(path.join(dir, "DESIGN.md"), [
      "---",
      "brand: Acme",
      "primary_color: '#FF0000'",
      "spacing_scale: 8",
      "font_family: 'Inter, sans-serif'",
      "components: button:rounded-lg px-4, card:rounded-xl p-6",
      "---",
      "",
      "We use a clean minimal design.",
    ].join("\n"));
    const cfg = loadDesignConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg!.brand).toBe("Acme");
    expect(cfg!.primaryColor).toBe("#FF0000");
    expect(cfg!.spacingScale).toBe(8);
    expect(cfg!.fontFamily).toMatch(/Inter/);
    expect(cfg!.components.length).toBeGreaterThan(0);
    expect(cfg!.body).toMatch(/clean minimal/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("handles a file with no front matter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-dd-"));
    fs.writeFileSync(path.join(dir, "DESIGN.md"), "Just a note about the design.");
    const cfg = loadDesignConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg!.brand).toBe("App"); // default
    expect(cfg!.body).toBe("Just a note about the design.");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("designPrompt", () => {
  it("returns empty string for null config", () => {
    expect(designPrompt(null)).toBe("");
  });

  it("renders a design context block", () => {
    const prompt = designPrompt({
      brand: "Acme", primaryColor: "#00F", spacingScale: 4, fontFamily: "Inter",
      components: [{ name: "button", className: "rounded px-4" }],
      tokens: [], body: "Keep it simple.",
    });
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("#00F");
    expect(prompt).toContain("Keep it simple.");
  });
});
