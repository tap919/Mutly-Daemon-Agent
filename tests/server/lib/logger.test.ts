import { describe, it, expect } from "vitest";
import { logger } from "../../../server/lib/logger.js";

describe("Logger", () => {
  it("logger is defined", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("logger.info accepts structured data", () => {
    // Should not throw
    expect(() => {
      logger.info({ key: "value", count: 42 }, "test message");
    }).not.toThrow();
  });

  it("logger.error accepts error and message", () => {
    expect(() => {
      logger.error(new Error("test error"), "error occurred");
    }).not.toThrow();
  });

  it("logger.warn works with string", () => {
    expect(() => {
      logger.warn("warning message");
    }).not.toThrow();
  });
});
