# Build Pipeline Security & Compliance Enhancement Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan step-by-step.

**Goal:** Harden all 3 build pipelines with supply chain security (SBOM, dependency audit), build integrity (SLSA provenance, artifact signing), container scanning, and compliance attestation.

**Architecture:** Each component gets a new CI job or workflow for SBOM/dependency audit. Shared tool choices: `anchore/sbom-action` for SBOM, `github/codeql-action` for SAST, `aquasecurity/trivy-action` for containers, `npm/pip audit` for deps. SLSA via `slsa-framework/slsa-github-generator`.

**Tech Stack:** GitHub Actions, CycloneDX SBOM, Trivy, CodeQL, npm audit, pip-audit, SLSA provenance v1

---

## Pipeline Component Map

| Component | SBOM | Dep Audit | SLSA | Container Scan | SAST | License | Artifact Sign |
|-----------|------|-----------|------|---------------|------|---------|---------------|
| Mutly (Node/Docker) | Anchore | npm audit | slsa-generator | Trivy | CodeQL | license-checker | cosign |
| VibeServe (Python/Docker) | Anchore | pip-audit | slsa-generator | Trivy | CodeQL | pip-licenses | sigstore |
| RepoRank (Node/TS) | Anchore | npm audit | slsa-generator | — | CodeQL | license-checker | — |

---

### Task 1: Mutly — SBOM, Dep Audit, SAST, Container Scan

**Files:**
- Modify: `Mutly-Daemon-Agent/.github/workflows/ci.yml`
- Create: `Mutly-Daemon-Agent/.github/workflows/security-scan.yml`

Add a new `security-scan` workflow with:
1. **SBOM generation** — `anchore/sbom-action@v0` generates CycloneDX JSON + SPDX
2. **npm audit** — `npm audit --production --audit-level=high` fails on HIGH/CRITICAL
3. **CodeQL** — `github/codeql-action/init` + `github/codeql-action/analyze` for TS/JS
4. **Container scan** — `aquasecurity/trivy-action@master` scans the Dockerfile image
5. **License check** — `license-checker --production --summary --onlyAllow "MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;Unlicense"`

Add to CI: npm audit step after install.

---

### Task 2: VibeServe — SBOM, Dep Audit, SAST, Container Scan

**Files:**
- Modify: `VibeServe-main/.github/workflows/ci.yml`
- Create: `VibeServe-main/.github/workflows/security-scan.yml`

Add:
1. **SBOM generation** — CycloneDX Python SBOM via `pip install cyclonedx-bom && cyclonedx-py`
2. **pip-audit** — `pip install pip-audit && pip-audit --strict`
3. **CodeQL** — Python analysis (already in ci.yml partially)
4. **Container scan** — Trivy scan on Dockerfile
5. **License check** — `pip install pip-licenses && pip-licenses --allow-only "MIT License;Apache Software License;BSD License;ISC License;Python Software Foundation License"`

Add to CI: pip-audit step after install.

---

### Task 3: RepoRank — SBOM, Dep Audit, SAST

**Files:**
- Modify: `reporank/.github/workflows/ci.yml`
- Create: `reporank/.github/workflows/security-scan.yml`

Add:
1. **SBOM generation** — Anchore CycloneDX for pnpm workspace
2. **pnpm audit** — `pnpm audit --audit-level=high`
3. **CodeQL** — TypeScript/JavaScript analysis
4. **License check** — `pnpm license-checker`

Add to CI: pnpm audit step.

---

### Task 4: SLSA Provenance + OIDC Hardening

**Files:**
- Create: `Mutly-Daemon-Agent/.github/workflows/release.yml`
- Create: `reporank/.github/workflows/release.yml`
- Modify: `VibeServe-main/.github/workflows/pypi.yml`

Add SLSA v1 provenance generation to all release workflows:
- Use `slsa-framework/slsa-github-generator/.github/workflows/builder_nodejs_slsa3.yml` for Node packages
- Use `slsa-framework/slsa-github-generator/.github/workflows/builder_python_slsa3.yml` for Python

Enforce OIDC for all publish actions. Add `permissions: id-token: write` and `contents: read`.

---

### Task 5: CI Policy Enforcement + Signed Commits

**Files:**
- Create: `plans/secure-build-pipeline-compliance.md`

Document policy requirements:
1. Branch protection rules (require PR, require CI, require review, no force push)
2. Signed commits requirement
3. Environment protection for production deployment environments
4. Secrets rotation schedule
5. Dependency update cadence (weekly automated Dependabot/Snyk PRs)

Create `.github/dependabot.yml` for all 3 projects.

---

## Execution Order

Task 1, 2, 3 can run in parallel (independent projects).
Task 4 depends on Tasks 1-3 (need to know which artifacts get SLSA).
Task 5 is documentation-only, can run any time.
