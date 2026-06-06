/**
 * Sprint D.1 — DESIGN.md support (VoltAgent/awesome-claude-design pattern).
 *
 * If a workspace has `DESIGN.md` at the root, the build phase reads it
 * and uses it as a design system prior for generated frontend code.
 *
 * The format mirrors WORKFLOW.md — YAML front matter + Markdown body.
 * When available, the DesignConfig is injected into the build context
 * so agents use it as a style constraint.
 *
 * Example:
 *   ---
 *   brand: "Acme Corp"
 *   primary_color: "#0066FF"
 *   spacing_scale: 4
 *   font_family: "Inter, sans-serif"
 *   components:
 *     button: "rounded-full px-4 py-2 font-medium"
 *     card: "rounded-xl border p-6 shadow-sm"
 *   ---
 *
 *   # Design System Overview
 *   We use a clean, minimal design with generous whitespace...
 */
import fs from "fs";
import path from "path";
import { WorkflowParseError } from "./workflowContract.js";

export interface DesignToken {
  name: string;
  value: string;
  description?: string;
}

export interface ComponentSpec {
  name: string;
  className: string;
  description?: string;
}

export interface DesignConfig {
  brand: string;
  primaryColor: string;
  spacingScale: number;
  fontFamily: string;
  components: ComponentSpec[];
  tokens: DesignToken[];
  body: string; // raw markdown body for context
}

const DESIGN_DEFAULTS: Omit<DesignConfig, "body"> = {
  brand: "App",
  primaryColor: "#0066FF",
  spacingScale: 4,
  fontFamily: "Inter, sans-serif",
  components: [],
  tokens: [],
};

/**
 * Load and parse DESIGN.md from a workspace root.
 * Returns null if the file does not exist (no error — design is optional).
 */
export function loadDesignConfig(workspaceRoot: string): DesignConfig | null {
  const filePath = path.join(workspaceRoot, "DESIGN.md");
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return null;

  // Same front matter format as WORKFLOW.md
  if (!raw.startsWith("---")) return { ...DESIGN_DEFAULTS, body: raw };

  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { ...DESIGN_DEFAULTS, body: raw };

  const yamlText = raw.slice(3, end).replace(/^\n/, "");
  const body = raw.slice(end + 4).replace(/^\n/, "").trim();

  const cfg: Record<string, unknown> = {};
  for (const line of yamlText.split("\n")) {
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    const clean = val.replace(/^['"]|['"]$/g, "");
    if (key === "primary_color") cfg.primaryColor = clean;
    else if (key === "spacing_scale") cfg.spacingScale = parseInt(clean, 10) || 4;
    else if (key === "font_family") cfg.fontFamily = clean;
    else if (key === "brand") cfg.brand = clean;
    else if (key === "components") {
      cfg.components = parseComponentLines(val);
    }
  }

  return {
    brand: (cfg.brand as string) ?? DESIGN_DEFAULTS.brand,
    primaryColor: (cfg.primaryColor as string) ?? DESIGN_DEFAULTS.primaryColor,
    spacingScale: (cfg.spacingScale as number) ?? DESIGN_DEFAULTS.spacingScale,
    fontFamily: (cfg.fontFamily as string) ?? DESIGN_DEFAULTS.fontFamily,
    components: (cfg.components as ComponentSpec[]) ?? [],
    tokens: [],
    body,
  };
}

function parseComponentLines(raw: string): ComponentSpec[] {
  if (!raw) return [];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => {
    const [name, ...rest] = p.split(/\s+/);
    return { name: name || "unknown", className: rest.join(" ") || "", description: "" };
  });
}

/**
 * Render a DESIGN.md as a system prompt prefix for the build phase.
 */
export function designPrompt(cfg: DesignConfig | null): string {
  if (!cfg) return "";
  const comps = cfg.components.map((c) => `  ${c.name}: "${c.className}"`).join("\n");
  return [
    `## Design System`,
    ``,
    `Brand: ${cfg.brand}`,
    `Primary color: ${cfg.primaryColor}`,
    `Spacing scale: ${cfg.spacingScale}px`,
    `Font: ${cfg.fontFamily}`,
    ``,
    comps ? `Components:\n${comps}\n` : ``,
    cfg.body ? `Design notes:\n${cfg.body}\n` : ``,
  ].filter(Boolean).join("\n");
}
