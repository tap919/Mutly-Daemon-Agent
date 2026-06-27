/**
 * Provenance query endpoint — returns the audit trail for a pipeline.
 * Every phase result has a _provenance field stamped with origin, timestamp,
 * workflow hash, and prompt hash. This endpoint aggregates them.
 */
import { Router } from "express";

export function createProvenanceRouter(pipelineRunner: any): Router {
  const router = Router();

  router.get("/pipeline/:id/provenance", async (req, res) => {
    try {
      const state = await pipelineRunner.getState(req.params.id);
      if (!state) return res.status(404).json({ error: "Pipeline not found" });

      const phases = state.phases || {};
      const trail: Array<{
        phase: string;
        status: string;
        provenance: Record<string, unknown>;
        score?: number;
        completedAt?: number;
      }> = [];

      for (const [phaseId, phase] of Object.entries(phases)) {
        const p = phase as any;
        trail.push({
          phase: phaseId,
          status: p.status || "unknown",
          score: p.score,
          completedAt: p.completedAt,
          provenance: {
            agent: p._provenance?.agent || "coordinator",
            origin: p._provenance?.origin || "ai",
            timestamp: p._provenance?.timestamp || p.completedAt,
            workflowHash: p._provenance?.workflowHash || state.workflowHash,
            promptHash: p._provenance?.promptHash || null,
          },
        });
      }

      res.json({
        success: true,
        pipelineId: state.id,
        workflowHash: state.workflowHash,
        totalPhases: trail.length,
        completedPhases: trail.filter(t => t.status === "passed").length,
        failedPhases: trail.filter(t => t.status === "failed").length,
        trail,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
