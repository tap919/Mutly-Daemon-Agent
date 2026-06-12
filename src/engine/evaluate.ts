import { analyzeProjectIdea } from './analyzers/project-idea';
import { analyzeChatResponse } from './analyzers/chat-response';
import type { ScanPayload, RealityReport } from '@/lib/types';

function assertNever(x: never): never {
  throw new Error(`Unhandled scan payload: ${JSON.stringify(x)}`);
}

export function evaluate(payload: ScanPayload): RealityReport {
  switch (payload.type) {
    case 'project_idea':
      return analyzeProjectIdea(payload.data);
    case 'chat_response':
      return analyzeChatResponse(payload.data);
    default:
      return assertNever(payload);
  }
}