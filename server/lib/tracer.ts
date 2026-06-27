import { trace, context, SpanStatusCode } from "@opentelemetry/api";

export const tracer = trace.getTracer("mutly-daemon", "1.0.0");

export async function withSpan(
  name: string,
  attributes: Record<string, string>,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      fn
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err: unknown) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}
