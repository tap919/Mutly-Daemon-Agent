import type { ToolArgs } from "../tools/types.js";
import {
  atomicWriteJson,
  getDataPath,
  readJsonFile,
  withFileLock,
} from "../lib/persistStore.js";

export interface PausedReActState {
  approvalId: string;
  workflowId: string;
  stepId: string | number;
  messages: unknown[];
  loopCount: number;
  toolsConfig: unknown[];
  workflowIdForContext: string;
  workspaceId: string;
  pendingToolResponses: Array<{
    name: string;
    args: ToolArgs;
    id?: string;
  }>;
  createdAt: string;
}

const FILE = () => getDataPath("react-pause.json");

export async function savePausedReAct(state: PausedReActState): Promise<void> {
  await withFileLock(FILE(), async () => {
    const all = await readJsonFile<Record<string, PausedReActState>>(FILE(), {});
    all[state.approvalId] = state;
    await atomicWriteJson(FILE(), all);
  });
}

export async function loadPausedReAct(
  approvalId: string
): Promise<PausedReActState | undefined> {
  const all = await readJsonFile<Record<string, PausedReActState>>(FILE(), {});
  return all[approvalId];
}

export async function clearPausedReAct(approvalId: string): Promise<void> {
  await withFileLock(FILE(), async () => {
    const all = await readJsonFile<Record<string, PausedReActState>>(FILE(), {});
    delete all[approvalId];
    await atomicWriteJson(FILE(), all);
  });
}
