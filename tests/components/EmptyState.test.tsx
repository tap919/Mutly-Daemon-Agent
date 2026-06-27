/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyState from "../../src/components/EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <EmptyState
        title="No data"
        description="There is nothing to display right now."
      />
    );
    expect(
      screen.getByText("There is nothing to display right now.")
    ).toBeInTheDocument();
  });

  it("renders action button when provided", () => {
    render(
      <EmptyState
        title="No results"
        action={<button>Create new</button>}
      />
    );
    expect(screen.getByText("Create new")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    const { container } = render(
      <EmptyState
        icon={<span data-testid="test-icon">📦</span>}
        title="Empty"
      />
    );
    expect(screen.getByTestId("test-icon")).toBeInTheDocument();
  });

  it("renders without optional props", () => {
    render(<EmptyState title="Just a title" />);
    expect(screen.getByText("Just a title")).toBeInTheDocument();
  });
});
