import fs from "fs";
import path from "path";
import { PipelineState, PhaseResult } from "./pipelineTypes.js";

export async function p9_lintConfig(state: PipelineState): Promise<PhaseResult> {
  const workspaceRoot = state.workspacePath || process.cwd();
  const changes: string[] = [];

  const eslintPath = path.join(workspaceRoot, ".eslintrc.json");
  if (!fs.existsSync(eslintPath)) {
    fs.writeFileSync(eslintPath, JSON.stringify({
      root: true,
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint"],
      extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
      rules: { "no-console": "warn", "@typescript-eslint/no-unused-vars": "warn" },
    }, null, 2));
    changes.push("Created .eslintrc.json");
  }

  const prettierPath = path.join(workspaceRoot, ".prettierrc");
  if (!fs.existsSync(prettierPath)) {
    fs.writeFileSync(prettierPath, JSON.stringify({
      semi: true, singleQuote: true, tabWidth: 2, trailingComma: "all", printWidth: 100,
    }, null, 2));
    changes.push("Created .prettierrc");
  }

  return {
    id: "lint_config",
    status: "passed",
    output: { changes, message: changes.length > 0 ? changes.join("; ") : "No config changes needed" },
    completedAt: Date.now(),
  };
}
