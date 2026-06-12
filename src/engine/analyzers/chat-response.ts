import type { ChatResponseInput, ScoreBreakdown, EvidenceItem, Optimization, RealityReport } from '@/lib/types';
import { clamp } from '../shared/clamp';
import { createEvidence } from '../shared/evidence';
import { calculateVerdict } from '../shared/scoring';

const HEDGE_WORDS = [
  'maybe', 'probably', 'likely', 'could', 'perhaps', 'might', 'possibly', 
  'presumably', 'arguably', 'generally', 'seem', 'seems', 'appeared'
];

const OVERCONFIDENCE_WORDS = [
  'absolutely', 'definitely', 'always', 'never', 'guaranteed', '100%', 
  'completely', 'perfectly', 'undoubtedly', 'obviously'
];

const AI_TRANSITIONS = [
  'furthermore', 'moreover', 'consequently', 'therefore', 'in conclusion', 
  'it is important to note', 'firstly', 'secondly', 'on the other hand', 
  'overall', 'additionally', 'specifically'
];

export function analyzeChatResponse(data: ChatResponseInput): RealityReport {
  const text = data.text || '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length || 1;
  const avgSentenceLength = wordCount / sentenceCount;

  // 1. Detect hedge words density
  let hedgeCount = 0;
  // 2. Detect overconfidence density
  let overconfidenceCount = 0;
  // 3. Detect AI transition markers
  let aiTransitionCount = 0;

  words.forEach(word => {
    const cleanWord = word.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '');
    if (HEDGE_WORDS.includes(cleanWord)) hedgeCount++;
    if (OVERCONFIDENCE_WORDS.includes(cleanWord)) overconfidenceCount++;
    if (AI_TRANSITIONS.includes(cleanWord)) aiTransitionCount++;
  });

  // 4. Find factual references (numbers, percentages, dates)
  const numberRegex = /\b\d+(?:\.\d+)?%?\b/g;
  const numberMatches = text.match(numberRegex) || [];
  const factDensity = numberMatches.length / Math.max(1, sentenceCount);

  // 5. Calculate scores based on pure text metrics (no mocks!)
  // Factual support, balanced sentence length, and lack of wild handwaving
  let realityScore = 50; // Baseline
  
  // High fact density increases reality
  realityScore += Math.min(30, factDensity * 15);
  // Source presence boosts reality
  if (data.source && data.source.trim().length > 0) {
    realityScore += 15;
  }
  // Balanced sentence length (between 10 and 25 words is professional and realistic)
  if (avgSentenceLength >= 10 && avgSentenceLength <= 25) {
    realityScore += 10;
  } else {
    realityScore -= 10;
  }
  // Too many hedge words lowers factuality/reality
  realityScore -= Math.min(25, (hedgeCount / Math.max(1, wordCount)) * 100);
  realityScore = clamp(Math.round(realityScore), 15, 98);

  // Risk Score: Higher hedges (uncertainty) or extreme claims (overconfidence)
  let riskScore = 30; // Baseline
  const hedgeRatio = hedgeCount / Math.max(1, wordCount);
  const overconfidenceRatio = overconfidenceCount / Math.max(1, wordCount);

  riskScore += Math.min(35, hedgeRatio * 300); // Risk of vagueness/indecision
  riskScore += Math.min(35, overconfidenceRatio * 400); // Risk of overclaiming

  if (!data.source) {
    riskScore += 15; // Unverified text is higher risk
  }
  if (wordCount < 30) {
    riskScore += 20; // Short responses have high risk due to lack of context
  }
  riskScore = clamp(Math.round(riskScore), 10, 95);

  // AI Readiness (or style index): how organized/structured is the response?
  let aiStyleIndex = 15; // Base
  const aiTransitionRatio = aiTransitionCount / Math.max(1, wordCount);
  aiStyleIndex += Math.min(45, aiTransitionRatio * 500); // Heavy transitions
  
  // Lists and bullets increase structure index
  const bulletCount = (text.match(/^[-*•+]\s/gm) || []).length;
  aiStyleIndex += Math.min(30, bulletCount * 10);
  
  if (avgSentenceLength >= 15 && avgSentenceLength <= 22) {
    aiStyleIndex += 10; // AI typically writes in structured sentence lengths
  }
  const aiReadinessScore = clamp(Math.round(aiStyleIndex), 10, 95);

  // Human Oversight Needed
  let humanOversight = 50;
  if (riskScore > 60) humanOversight += 20;
  if (realityScore < 40) humanOversight += 15;
  if (data.source) humanOversight -= 10; // Cites source
  if (wordCount > 300) humanOversight += 10; // Long texts need more auditing

  humanOversight = clamp(Math.round(humanOversight), 15, 95);

  const scores: ScoreBreakdown = {
    reality: realityScore,
    risk: riskScore,
    aiReadiness: aiReadinessScore,
    humanOversightNeeded: humanOversight,
  };

  const evidence: EvidenceItem[] = [
    createEvidence('Word Count Metric', `${wordCount} words`, 'moderate', 'derived'),
    createEvidence('Factual References Density', `${(factDensity * 100).toFixed(0)}% per sentence`, 'moderate', 'derived'),
    createEvidence('Syntactic Transition Words', `${aiTransitionCount} style anchors`, 'weak', 'derived'),
    createEvidence('Hedge/Uncertainty Words', `${hedgeCount} occurrences`, 'moderate', 'derived'),
    createEvidence('Unverified Overconfidence Terms', `${overconfidenceCount} occurrences`, 'moderate', 'derived'),
  ];

  if (data.source) {
    evidence.push(createEvidence('Stated Citation Source', data.source, 'strong', 'input'));
  }

  const optimizations: Optimization[] = [];
  if (!data.source) {
    optimizations.push({
      title: 'Attach Primary Source',
      description: 'Add a URL, document reference, or dataset origin to establish factual verification and reduce risk metrics.',
      impact: 'high',
      effort: 'low',
    });
  }
  if (overconfidenceRatio > 0.03) {
    optimizations.push({
      title: 'Audit Absolute Claims',
      description: `Detected overconfidence index of ${(overconfidenceRatio * 100).toFixed(1)}%. Tone down absolute words ('always', 'never') unless backed by mathematical proofs.`,
      impact: 'high',
      effort: 'medium',
    });
  }
  if (hedgeRatio > 0.04) {
    optimizations.push({
      title: 'Strengthen Indeterminate Assertions',
      description: 'Your text contains high density of tentative phrases. Replace passive framing with specific criteria, metrics, or ranges.',
      impact: 'medium',
      effort: 'medium',
    });
  }
  if (wordCount < 40) {
    optimizations.push({
      title: 'Expand Context Window',
      description: 'The scan input is too short. Provide surrounding paragraphs, prompts, or reference documentation for a multi-layered analysis.',
      impact: 'high',
      effort: 'low',
    });
  }

  if (optimizations.length === 0) {
    optimizations.push({
      title: 'Lock In Heuristic Profile',
      description: 'This text shows high structural logic. No immediate stylistic or factual optimization required.',
      impact: 'low',
      effort: 'low',
    });
  }

  const verdict = calculateVerdict(scores);

  let summary = '';
  if (verdict === 'strong_go') {
    summary = 'Superb factual backing and objective style. This text has extremely high structural integrity.';
  } else if (verdict === 'conditional_go') {
    summary = 'Solid communication pattern. Minor overclaiming or slight ambiguity detected; verify critical assertions.';
  } else if (verdict === 'pivot') {
    summary = 'High level of speculation or stylistic transition density. Substantive editing for clarity is advised.';
  } else {
    summary = 'Highly speculative or completely unverified assertions. Do not use without thorough manual editing and citation audits.';
  }

  return {
    id: `scan_${Math.random().toString(36).substring(2, 11)}`,
    type: 'chat_response',
    timestamp: Date.now(),
    verdict,
    scores,
    evidence,
    optimizations,
    summary,
  };
}