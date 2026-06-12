import fs from "fs";
import path from "path";

export interface SpecBundle {
  designMd?: string;
  requirementsMd?: string;
  designDocMd?: string;
  tasksMd?: string;
  hasDesignMd: boolean;
  hasFullSpec: boolean;
}

export function loadSpecAssets(workspaceRoot: string): SpecBundle {
  const read = (name: string) => {
    const p = path.join(workspaceRoot, name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : undefined;
  };

  const designMd = read("DESIGN.md");
  const requirementsMd = read("requirements.md");
  const designDocMd = read("design.md");
  const tasksMd = read("tasks.md");

  return {
    designMd,
    requirementsMd,
    designDocMd,
    tasksMd,
    hasDesignMd: Boolean(designMd),
    hasFullSpec: Boolean(requirementsMd && designDocMd && tasksMd),
  };
}

export function specSummaryForPlanning(bundle: SpecBundle): string | undefined {
  if (bundle.hasFullSpec) {
    return [
      bundle.requirementsMd?.slice(0, 4000),
      bundle.designDocMd?.slice(0, 4000),
      bundle.tasksMd?.slice(0, 2000),
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");
  }
  return bundle.designMd?.slice(0, 6000);
}
