# Design Doc: Mutly Logic Upgrade - Option C (Hybrid Phased Approach)

## Overview
This design outlines a phased, hybrid approach to upgrading Mutly's core logic, balancing immediate improvements (Phase 1) with long-term architectural evolution (Phase 2).

## Phase 1: Incremental Enhancements (Option A)
The goal is to increase agent reliability and decision-making quality with minimal architectural disruption.

### 1.1 Post-Edit Verification Gate
- **Logic:** After `apply_diff` or file creation, automatically trigger a verification step.
- **Verification:** Run `npm run lint` or `tsc --noEmit` and critical unit tests.
- **Correction:** If verification fails, pass error logs back to the agent in the same ReAct turn for automated fixing (max 3 retries).

### 1.2 Multi-Model Routing
- **Logic:** Implement a router to select the optimal model.
- **Implementation:**
  - `gemini-2.5-flash` for routine tool calls (low latency).
  - Use a more capable model (e.g., `gemini-1.5-pro` or equivalent) for planning and complex reasoning tasks.

## Phase 2: Architectural Migration (Option B)
The goal is to evolve into a production-grade, highly extensible framework.

### 2.1 DAG-Based Workflow
- **Logic:** Move from linear tool execution to a Directed Acyclic Graph (DAG) for parallel task handling and robust error recovery.

### 2.2 Plugin SDK
- **Logic:** Introduce a defined interface for adding custom tools/capabilities without modifying core Mutly code.

### 2.3 Production Diagnostics & Sandbox
- **Logic:** Enhance observability with OpenTelemetry and implement containerized sandboxing for safer execution.

---
## Implementation Roadmap (Transition to writing-plans)
Once this design is approved, I will invoke the `writing-plans` skill to outline the implementation steps for Phase 1.
