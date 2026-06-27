import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "server/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      enabled: true,
      include: [
        // Upgraded modules with test coverage
        "server/vectorEngine.ts",
        "server/observability/**/*.ts",
        "server/inngest/client.ts",
        "server/lib/otelBootstrap.ts",
        "server/lib/logger.ts",
        "server/audit/auditService.ts",
        "src/components/{Dashboard,Kairos,ErrorBoundary,LoadingSkeleton,EmptyState}.*",
        "src/hooks/*.ts",
      ],
      exclude: [
        "**/node_modules/**",
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.config.*",
        "**/dist/**",
        "server/lib/otelBootstrap.ts",   // Requires actual OTel SDK setup
        "server/observability/metrics.ts", // Pure constant definitions
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        statements: 0,
        branches: 0,
      },
    },
  },
});
