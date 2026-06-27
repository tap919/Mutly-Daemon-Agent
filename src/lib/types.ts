export type ScanType = 'project_idea' | 'chat_response';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type BudgetTier = 'free' | 'low' | 'medium' | 'high';
export type ProjectType = 'saas' | 'mobile' | 'web' | 'desktop' | 'cli' | 'library' | 'other';
export type TimelineMonths = 1 | 2 | 3 | 6 | 12 | 18 | 24;
export type AIUsageLevel = 'none' | 'light' | 'moderate' | 'heavy';
export type Verdict = 'strong_go' | 'conditional_go' | 'pivot' | 'strong_no';

export interface ProjectIdeaInput {
  experience: ExperienceLevel;
  budget: BudgetTier;
  hoursPerWeek: number;
  projectType: ProjectType;
  coreIncome: boolean;
  timelineMonths: TimelineMonths;
  aiUsage: AIUsageLevel;
}

export interface ChatResponseInput {
  text: string;
  source?: string;
}

export type ScanPayload = 
  | { type: 'project_idea'; data: ProjectIdeaInput }
  | { type: 'chat_response'; data: ChatResponseInput };

export interface ScoreBreakdown {
  reality: number;
  risk: number;
  aiReadiness: number;
  humanOversightNeeded: number;
}

export interface EvidenceItem {
  label: string;
  value: string | number;
  weight: 'strong' | 'moderate' | 'weak';
  source: 'input' | 'derived' | 'benchmark';
}

export interface Optimization {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
}

export interface RealityReport {
  id: string;
  type: ScanType;
  timestamp: number;
  verdict: Verdict;
  scores: ScoreBreakdown;
  evidence: EvidenceItem[];
  optimizations: Optimization[];
  summary: string;
}

export interface ScanApiRequest {
  payload: ScanPayload;
  paymentIntentId?: string;
}

export interface ScanApiResponse {
  report: RealityReport;
}

export interface ScanHistoryItem {
  id: string;
  type: ScanType;
  timestamp: number;
  verdict: Verdict;
  scores: ScoreBreakdown;
  summary: string;
}