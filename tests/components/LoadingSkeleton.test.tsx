/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingSkeleton from "../../src/components/LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("renders card variant with default count", () => {
    const { container } = render(<LoadingSkeleton variant="card" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const cards = container.querySelectorAll(".rounded-lg");
    expect(cards.length).toBeGreaterThan(0);
  });

  it("renders list variant", () => {
    const { container } = render(<LoadingSkeleton variant="list" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const items = container.querySelectorAll(".animate-pulse");
    expect(items.length).toBeGreaterThan(0);
  });

  it("renders text variant", () => {
    const { container } = render(<LoadingSkeleton variant="text" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders chart variant", () => {
    const { container } = render(<LoadingSkeleton variant="chart" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const bars = container.querySelectorAll(".rounded-full");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders multiple items with count prop", () => {
    const { container } = render(<LoadingSkeleton variant="card" count={3} />);
    const wrappers = container.querySelectorAll(".space-y-4 > div");
    expect(wrappers.length).toBe(3);
  });

  it("has aria-busy on skeleton elements", () => {
    render(<LoadingSkeleton variant="card" />);
    const busy = document.querySelector("[aria-busy='true']");
    expect(busy).toBeTruthy();
  });

  it("has sr-only loading text", () => {
    render(<LoadingSkeleton variant="card" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
