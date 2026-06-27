import { getConfig } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * RepoRank API client — calls the external RepoRank API for
 * AI-powered codebase audits. Falls back gracefully on network errors.
 */

export interface ReporankScanRequest {
  repoName: string;
  files: Array<{ path: string; content: string }>;
  privateMode: boolean;
  aiProvider?: string;
  aiModel?: string;
}

export interface ReporankScanResponse {
  id: string;
  status: string;
  result?: {
    overallScore: number;
    vibeScore: number;
    gradeCategory: string;
    maturityLevel: string;
    healthReport: Record<string, unknown>;
    summary: string;
    recommendations: string[];
    findings: Array<{
      severity: "critical" | "high" | "medium" | "low" | "info";
      category: string;
      title: string;
      message: string;
      filePath?: string;
    }>;
  };
  error?: string;
}

export class ReporankApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly enabled: boolean;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.REPORANK_API_URL;
    this.apiKey = config.REPORANK_API_KEY;
    this.enabled = config.REPORANK_ENABLED;
  }

  /**
   * Submit a local scan to the RepoRank API and poll for the result.
   */
  async submitScan(request: ReporankScanRequest): Promise<ReporankScanResponse | null> {
    if (!this.enabled) {
      logger.info("[reporank-client] RepoRank integration disabled (REPORANK_ENABLED=false)");
      return null;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-Mutly-Key"] = this.apiKey;
    }

    // Use the dedicated internal Mutly endpoint when an API key is configured;
    // fall back to the standard local-scan route (requires user JWT) otherwise.
    const scanEndpoint = this.apiKey
      ? `${this.baseUrl}/api/v1/internal/mutly/scan`
      : `${this.baseUrl}/api/v1/scans/local`;

    try {
      logger.info(`[reporank-client] Submitting scan for ${request.repoName} to ${scanEndpoint}`);

      const createRes = await fetch(scanEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      });

      if (!createRes.ok) {
        const errBody = await createRes.text();
        logger.warn(`[reporank-client] API returned ${createRes.status}: ${errBody}`);
        return null;
      }

      const createBody = (await createRes.json()) as {
        data: { scanId: string; status: string; estimatedDuration: number };
      };
      const scanId = createBody.data?.scanId;
      if (!scanId) {
        logger.warn("[reporank-client] No scanId in response");
        return null;
      }

      // Poll for completion
      return await this.pollScanResult(scanId, headers, createBody.data.estimatedDuration ?? 60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[reporank-client] Failed to submit scan: ${msg}`);
      return null;
    }
  }

  private async pollScanResult(
    scanId: string,
    headers: Record<string, string>,
    estimatedDuration: number
  ): Promise<ReporankScanResponse | null> {
    const maxAttempts = Math.max(3, Math.ceil(estimatedDuration / 3));
    const pollIntervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const pollRes = await fetch(`${this.baseUrl}/api/v1/internal/mutly/scan/${scanId}`, {
          headers,
          signal: AbortSignal.timeout(10000),
        });

        if (!pollRes.ok) {
          logger.warn(`[reporank-client] Poll attempt ${attempt + 1} failed: ${pollRes.status}`);
          continue;
        }

        const pollBody = (await pollRes.json()) as {
          data: ReporankScanResponse & { status: string };
        };
        const scan = pollBody.data;

        if (scan.status === "complete") {
          logger.info(`[reporank-client] Scan ${scanId} completed successfully`);
          return scan;
        }

        if (scan.status === "failed") {
          logger.warn(`[reporank-client] Scan ${scanId} failed: ${scan.error ?? "unknown"}`);
          return null;
        }

        // Still processing — continue polling
      } catch {
        // Transient error during poll — continue
      }
    }

    logger.warn(`[reporank-client] Scan ${scanId} timed out after ${maxAttempts * (pollIntervalMs / 1000)}s`);
    return null;
  }

  /**
   * Quick health check — is the RepoRank API reachable?
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
