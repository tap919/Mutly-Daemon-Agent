/**
 * OpenTelemetry bootstrap — always-initialized with local fallback.
 *
 * Behavior:
 * - If OTEL_EXPORTER_OTLP_ENDPOINT is set: full OTLP exporter with BatchSpanProcessor
 * - If not set: ConsoleSpanExporter for dev visibility (wrapped in SimpleSpanProcessor)
 * - Always registers auto-instrumentations for http, fs, child_process
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Never throws — failures are logged and silently swallowed
 */

import { logger } from "./logger.js";

let sdk: { start: () => void; shutdown: () => Promise<void> } | null = null;
let started = false;

export async function bootstrapOtel(): Promise<void> {
  if (started) return;

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    const { ConsoleSpanExporter, SimpleSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-base"
    );
    const { diag, DiagConsoleLogger, DiagLogLevel } = await import(
      "@opentelemetry/api"
    );

    // Enable OTEL diagnostics in dev
    if (process.env.NODE_ENV !== "production") {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const spanProcessors = [];

    if (endpoint) {
      // Full OTLP exporter for production
      const { OTLPTraceExporter } = await import(
        "@opentelemetry/exporter-trace-otlp-http"
      );
      const { BatchSpanProcessor } = await import(
        "@opentelemetry/sdk-trace-base"
      );
      const otlpExporter = new OTLPTraceExporter({ url: endpoint });
      spanProcessors.push(new BatchSpanProcessor(otlpExporter));
      logger.info({ endpoint }, "OpenTelemetry: OTLP exporter configured");
    } else {
      // Dev fallback — console exporter wrapped in SimpleSpanProcessor
      spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
      logger.info("OpenTelemetry: Console exporter active (dev mode)");
    }

    const nodeSdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "mutly-daemon",
      instrumentations: [getNodeAutoInstrumentations()],
      spanProcessors,
    });

    nodeSdk.start();
    sdk = {
      start: () => nodeSdk.start(),
      shutdown: () => nodeSdk.shutdown(),
    };
    started = true;

    // Graceful shutdown
    const shutdownHandler = async () => {
      if (sdk) {
        try {
          await sdk.shutdown();
          logger.info("OpenTelemetry SDK shut down gracefully");
        } catch (e) {
          logger.warn({ err: String(e) }, "OpenTelemetry shutdown warning");
        }
      }
    };

    process.on("SIGTERM", shutdownHandler);
    process.on("SIGINT", shutdownHandler);

    logger.info("OpenTelemetry initialized successfully");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "OpenTelemetry bootstrap skipped (non-critical)");
  }
}
