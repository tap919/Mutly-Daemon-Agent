/**
 * Phase 6: ITERATE
 * Loop controller. If score >= 80, pass through to READY.
 * If score < 80 and under max iterations, generate delta plan.
 * If max iterations exceeded, fail.
 */
import { PipelineState, PhaseResult } from "./pipelineTypes.js";

const MAX_ITERATIONS = 3;
const SCORE_TARGET = 80;

export async function p6_iterate(state: PipelineState): Promise<PhaseResult> {
  const reviewResult = state.phases["review"]?.output as any;
  const currentScore = reviewResult?.newScore ?? state.currentScore ?? 0;

  state.iterationCount = (state.iterationCount || 0) + 1;
  const remaining = MAX_ITERATIONS - state.iterationCount;

  if (currentScore >= SCORE_TARGET) {
    return {
      id: "iterate", status: "passed", score: currentScore,
      output: {
        passed: true,
        message: `Score ${currentScore}/${SCORE_TARGET} meets quality target`,
        currentScore,
        targetScore: SCORE_TARGET,
        iterationsUsed: state.iterationCount,
      },
      startedAt: Date.now(), completedAt: Date.now(),
    };
  }

  if (remaining <= 0) {
    return {
      id: "iterate", status: "failed", score: currentScore,
      output: {
        passed: false,
        message: `Score ${currentScore} below ${SCORE_TARGET} after ${MAX_ITERATIONS} iterations`,
        currentScore,
        targetScore: SCORE_TARGET,
        iterationsUsed: state.iterationCount,
      },
      startedAt: Date.now(), completedAt: Date.now(),
    };
  }

  // Generate delta plan from remaining recommendations
  const recommendations: string[] = reviewResult?.rawReport?.vibe?.recommendations || [];
  const deltaSteps = recommendations.slice(0, 3).map((r, i) => ({
    id: `iter_${state.iterationCount}_${i + 1}`,
    step: r,
    risk: "Low" as const,
    status: "pending" as const,
  }));

  return {
    id: "iterate", status: "passed", score: currentScore,
    output: {
      passed: false,
      remaining,
      message: `Score ${currentScore} below ${SCORE_TARGET}. ${remaining} iteration(s) remaining.`,
      deltaPlan: { tree: deltaSteps },
      currentScore,
      targetScore: SCORE_TARGET,
      iterationsUsed: state.iterationCount,
    },
    startedAt: Date.now(), completedAt: Date.now(),
  };
}
