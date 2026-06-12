/**
 * Mock Inngest client for testing.
 *
 * Usage:
 *   vi.mock("inngest", () => ({
 *     Inngest: vi.fn(() => createMockInngest()),
 *   }));
 *
 *   import { Inngest } from "inngest";
 *   const client = new Inngest({ id: "test" });
 */

import { vi } from "vitest";

export function createMockInngest() {
  const recordedEvents: Array<{ name: string; data: unknown }> = [];

  return {
    id: "test-inngest",
    send: vi.fn(async (event: { name: string; data?: unknown }) => {
      recordedEvents.push({ name: event.name, data: event.data });
    }),
    createFunction: vi.fn(
      (
        opts: { id: string; retries?: number },
        triggers: Array<{ event?: string; cron?: string }>,
        handler: (ctx: { event: any; step: any }) => Promise<any>
      ) => {
        return {
          id: opts.id,
          triggers,
          handler,
          opts,
        };
      }
    ),
    getRecordedEvents: () => [...recordedEvents],
  };
}
