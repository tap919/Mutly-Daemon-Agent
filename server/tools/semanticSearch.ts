import { agentDaemon } from "../agentDaemon.js";

export interface SemanticSearchParams {
  query: string;
  maxResults?: number;
  fileExtensions?: string[];
}

export interface SemanticSearchResult {
  filePath: string;
  score: number;
  snippet: string;
  fullPath: string;
}

export async function semanticSearch(
  params: SemanticSearchParams,
  workspaceRoot: string
): Promise<SemanticSearchResult[]> {
  const results = await agentDaemon.searchCodeSemantically(
    params.query,
    params.maxResults || 10
  );

  return results
    .filter(r => {
      if (!params.fileExtensions?.length) return true;
      const ext = "." + (r.filePath.split(".").pop() || "");
      return params.fileExtensions.includes(ext);
    })
    .map(r => ({
      ...r,
      fullPath: workspaceRoot + "/" + r.filePath,
    }));
}

export async function hybridSearch(
  query: string,
  workspaceRoot: string,
  maxResults = 10
): Promise<SemanticSearchResult[]> {
  const semantic = await semanticSearch({ query, maxResults }, workspaceRoot);
  if (semantic.length >= maxResults) return semantic;

  const remaining = maxResults - semantic.length;
  try {
    const { execSync } = await import("child_process");
    const escaped = query.replace(/"/g, '\\"');
    const grepResults = execSync(
      `grep -rl "${escaped}" "${workspaceRoot}" --include="*.ts" --include="*.tsx" 2>/dev/null | head -${remaining}`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim().split("\n").filter(Boolean);

    for (const fullPath of grepResults) {
      if (semantic.some(r => r.fullPath === fullPath)) continue;
      semantic.push({
        filePath: fullPath.replace(workspaceRoot + "/", ""),
        score: 0.5,
        snippet: "",
        fullPath,
      });
    }
  } catch {}

  return semantic.slice(0, maxResults);
}
