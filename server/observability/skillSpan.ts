/**
 * OpenTelemetry span helpers for skill and agent execution.
 *
 * Use these to wrap skill/agent work in OTel spans with consistent
 * attributes. Spans record name, duration, and (on failure)
 * exceptions and error status.
 */

import { SpanStatusCode, type Tracer } from "@opentelemetry/api";

export interface SkillSpanMeta {
  name: string;
  version?: string;
  tools?: string[];
}

export interface AgentSpanMeta {
  name: string;
  capabilities: string[];
  description?: string;
}

/**
 * Execute `fn` inside a skill span. Records the skill name, version,
 * and tools used. On failure, records the exception and sets error
 * status before re-throwing.
 */
export async function withSkillSpan<T>(
  tracer: Tracer,
  meta: SkillSpanMeta | string,
  fn: () => Promise<T>
): Promise<T> {
  const m: SkillSpanMeta = typeof meta === "string" ? { name: meta } : meta;
  return tracer.startActiveSpan(`skill.${m.name}`, async (span) => {
    span.setAttribute("skill.name", m.name);
    if (m.version) span.setAttribute("skill.version", m.version);
    if (m.tools?.length) span.setAttribute("skill.tools", m.tools.join(","));
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      throw e;
    } finally {
      span.end();
    }
  });
}

/**
 * Execute `fn` inside an agent span. Records agent name, capabilities,
 * and description. Same error semantics as withSkillSpan.
 */
export async function withAgentSpan<T>(
  tracer: Tracer,
  meta: AgentSpanMeta,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`agent.${meta.name}`, async (span) => {
    span.setAttribute("agent.name", meta.name);
    span.setAttribute("agent.capabilities", meta.capabilities.join(","));
    if (meta.description) span.setAttribute("agent.description", meta.description);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      throw e;
    } finally {
      span.end();
    }
  });
}
