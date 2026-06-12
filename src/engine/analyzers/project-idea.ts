import type { ProjectIdeaInput, ScoreBreakdown, EvidenceItem, Optimization, RealityReport } from '@/lib/types';
import { clamp, normalizeTo100 } from '../shared/clamp';
import { createEvidence } from '../shared/evidence';
import { calculateVerdict } from '../shared/scoring';

const EXPERIENCE_VALUES = {
  beginner: 30,
  intermediate: 70,
  advanced: 100,
};

const BUDGET_VALUES = {
  free: 10,
  low: 40,
  medium: 75,
  high: 100,
};

const COMPLEXITY_BY_TYPE = {
  saas: 9,
  mobile: 8,
  web: 6,
  desktop: 7,
  cli: 3,
  library: 4,
  other: 5,
};

const AI_USAGE_VALUES = {
  none: 10,
  light: 40,
  moderate: 75,
  heavy: 95,
};

export function analyzeProjectIdea(data: ProjectIdeaInput): RealityReport {
  const experienceVal = EXPERIENCE_VALUES[data.experience];
  const budgetVal = BUDGET_VALUES[data.budget];
  const complexity = COMPLEXITY_BY_TYPE[data.projectType];
  const aiUsageVal = AI_USAGE_VALUES[data.aiUsage];

  // 1. Calculate Reality Score (Feasibility)
  // Total available hours
  const totalHoursAvailable = data.hoursPerWeek * 4.33 * data.timelineMonths;
  
  // Base hours required for project type and complexity level
  let baseHoursNeeded = complexity * 120;
  
  // Adjust required hours based on experience (beginners need more time)
  if (data.experience === 'beginner') baseHoursNeeded *= 1.8;
  if (data.experience === 'intermediate') baseHoursNeeded *= 1.2;
  if (data.experience === 'advanced') baseHoursNeeded *= 0.8;

  // Adjust based on AI Usage (AI accelerates dev)
  if (data.aiUsage === 'heavy') baseHoursNeeded *= 0.6;
  if (data.aiUsage === 'moderate') baseHoursNeeded *= 0.8;
  if (data.aiUsage === 'light') baseHoursNeeded *= 0.95;

  const hoursRatio = totalHoursAvailable / baseHoursNeeded;
  const realityScore = clamp(Math.round(hoursRatio * 85), 10, 100);

  // 2. Calculate Risk Score
  let riskScore = 50; // Starting baseline
  
  // If expecting core income but hours or budget are low
  if (data.coreIncome) {
    riskScore += 25;
    if (data.hoursPerWeek < 15) riskScore += 15;
    if (data.budget === 'free' || data.budget === 'low') riskScore += 15;
  } else {
    riskScore -= 15;
  }

  // Experience offsets risk
  if (data.experience === 'advanced') riskScore -= 20;
  if (data.experience === 'intermediate') riskScore -= 5;
  if (data.experience === 'beginner') riskScore += 15;

  // Timeline risk
  if (data.timelineMonths < 3) riskScore += 15;
  if (data.timelineMonths > 12) riskScore -= 10;

  riskScore = clamp(riskScore, 5, 95);

  // 3. AI Readiness
  let aiReadinessScore = aiUsageVal;
  if (data.projectType === 'saas' || data.projectType === 'web') {
    aiReadinessScore = clamp(aiReadinessScore + 10, 0, 100);
  } else if (data.projectType === 'cli' || data.projectType === 'library') {
    aiReadinessScore = clamp(aiReadinessScore - 10, 0, 100);
  }

  // 4. Human Oversight Needed
  let humanOversight = 50;
  if (data.experience === 'beginner') humanOversight += 30;
  if (data.experience === 'advanced') humanOversight -= 20;
  if (data.aiUsage === 'heavy') humanOversight += 20; // Heavy AI requires verification
  if (data.aiUsage === 'none') humanOversight -= 10;
  
  humanOversight = clamp(humanOversight, 10, 95);

  const scores: ScoreBreakdown = {
    reality: realityScore,
    risk: riskScore,
    aiReadiness: aiReadinessScore,
    humanOversightNeeded: humanOversight,
  };

  const evidence: EvidenceItem[] = [
    createEvidence('Available Development Time', `${Math.round(totalHoursAvailable)} hours total`, 'strong', 'derived'),
    createEvidence('Project Complexity Factor', `${complexity}/10`, 'moderate', 'derived'),
    createEvidence('Timeline Commitment', `${data.timelineMonths} months`, 'moderate', 'input'),
    createEvidence('Weekly Time Commitment', `${data.hoursPerWeek} hrs/week`, 'moderate', 'input'),
    createEvidence('Funding Budget Capability', data.budget.toUpperCase(), 'moderate', 'input'),
    createEvidence('Target Core Income Need', data.coreIncome ? 'Yes' : 'No', 'strong', 'input'),
    createEvidence('AI Assistance Level', data.aiUsage.toUpperCase(), 'weak', 'input'),
  ];

  // Optimizations list
  const optimizations: Optimization[] = [];
  if (hoursRatio < 1.0) {
    optimizations.push({
      title: 'Extend Project Timeline',
      description: `With ${data.hoursPerWeek} hours/week, a complexity factor of ${complexity} requires approx. ${Math.round(baseHoursNeeded)} hours. Consider extending timeline to ${Math.ceil(baseHoursNeeded / (data.hoursPerWeek * 4.33))} months.`,
      impact: 'high',
      effort: 'low',
    });
  }
  if (data.experience === 'beginner' && complexity > 5) {
    optimizations.push({
      title: 'Reduce Initial Scope',
      description: 'As a beginner, starting with a SaaS or mobile app has high friction. Build a web prototype or CLI tool first to validate the core mechanic.',
      impact: 'high',
      effort: 'medium',
    });
  }
  if (data.aiUsage === 'none' || data.aiUsage === 'light') {
    optimizations.push({
      title: 'Leverage Heuristic Scanners',
      description: 'Increase developer efficiency by integrating local code quality tooling and static analysis engines early.',
      impact: 'medium',
      effort: 'low',
    });
  }
  if (data.coreIncome && riskScore > 60) {
    optimizations.push({
      title: 'Reduce Financial Exposure',
      description: 'Secure secondary income streams. Avoid full-time transition until the prototype has proven initial adoption and utility.',
      impact: 'high',
      effort: 'high',
    });
  }

  if (optimizations.length === 0) {
    optimizations.push({
      title: 'Maintain Execution Velocity',
      description: 'Your resources and parameters are perfectly aligned. Document specifications strictly to avoid scope creep.',
      impact: 'medium',
      effort: 'low',
    });
  }

  const verdict = calculateVerdict(scores);

  let summary = '';
  if (verdict === 'strong_go') {
    summary = 'Outstanding resource allocation and execution alignment. The project plan is exceptionally viable.';
  } else if (verdict === 'conditional_go') {
    summary = 'Viable project direction, but requires timeline extension or scoped refinement to manage development risks.';
  } else if (verdict === 'pivot') {
    summary = 'Resource deficits or high complexity mismatch. A structural pivot towards smaller scope is highly recommended.';
  } else {
    summary = 'High risk of failure due to critical resource-to-complexity mismatch. Redefine goals or secure more execution bandwidth.';
  }

  return {
    id: `scan_${Math.random().toString(36).substring(2, 11)}`,
    type: 'project_idea',
    timestamp: Date.now(),
    verdict,
    scores,
    evidence,
    optimizations,
    summary,
  };
}