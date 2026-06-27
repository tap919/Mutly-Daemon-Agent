import { ScoreBreakdown, Verdict } from '@/lib/types';

export function calculateVerdict(scores: ScoreBreakdown): Verdict {
  const { reality, risk, aiReadiness, humanOversightNeeded } = scores;

  // Example logic, this will need to be refined based on actual requirements
  if (reality > 80 && risk < 20 && aiReadiness > 70 && humanOversightNeeded < 30) {
    return 'strong_go';
  } else if (reality > 60 && risk < 40) {
    return 'conditional_go';
  } else if (reality < 40 || risk > 60) {
    return 'strong_no';
  }
  return 'pivot';
}

export function calculateOverallScore(scores: ScoreBreakdown): number {
  const { reality, risk, aiReadiness, humanOversightNeeded } = scores;
  // Example weighting
  return (reality * 0.4) + (risk * 0.3) + (aiReadiness * 0.2) + (humanOversightNeeded * 0.1);
}