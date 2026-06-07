/**
 * Re-export of withAgentSpan for discoverability. The implementation
 * lives in skillSpan.ts to keep span helpers in one place.
 */
export { withAgentSpan, type AgentSpanMeta } from "./skillSpan.js";
