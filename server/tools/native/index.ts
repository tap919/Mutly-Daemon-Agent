import { readFileTool } from "./readFileTool.js";
import { createFileTool } from "./createFileTool.js";
import { applyDiffTool } from "./applyDiffTool.js";
import { runCommandTool } from "./runCommandTool.js";

export const nativeTools = [
  readFileTool,
  createFileTool,
  applyDiffTool,
  runCommandTool
];