# Build Pipeline Security & Compliance Policy

**Date:** June 9, 2026
**Scope:** Mutly, VibeServe, RepoRank — all CI/CD pipelines

---

## 1. Supply Chain Security

### SBOM (Software Bill of Materials)
- **Format:** CycloneDX 1.5 (JSON)
- **Generation:** Every push to main/master, every PR, weekly schedule
- **Tooling:** `anchore/sbom-action` (Node), `cyclonedx-bom` (Python)
- **Artifacts:** Published as workflow artifacts, retained 90 days
- **Consumers:** Dependency trackers, compliance auditors, security scanners

### Dependency Audit
- **Frequency:** Every CI run (push + PR)
- **Threshold:** Fail on HIGH or CRITICAL vulnerabilities
- **Remediation:** Dependabot auto-PRs weekly; manual review for critical CVEs
- **Tooling:** `npm audit` / `pnpm audit` (Node), `pip-audit` (Python)

### Dependency Updates
- **Dependabot:** Enabled for npm, pip, Docker, and GitHub Actions
- **Frequency:** Weekly (Monday)
- **Limit:** Max 5 open PRs per ecosystem
- **Merge policy:** Require CI pass + 1 reviewer approval

---

## 2. Build Integrity

### SLSA Provenance
- **Level:** SLSA Level 3 (build platform attestation)
- **Tooling:** `slsa-framework/slsa-github-generator` + `actions/attest-build-provenance@v2`
- **Scope:** All release artifacts (published packages, Docker images, CLI binaries)
- **Verification:** `slsa-verifier` can verify provenance before deployment

### Artifact Signing
- **Container images:** Trivy-scanned, signed with cosign (planned)
- **Python packages:** Published via OIDC trusted publishing (no API tokens)
- **Node packages:** SLSA provenance attestation on dist/ output

### OIDC (OpenID Connect)
- **All publish jobs:** Use OIDC instead of long-lived API tokens
- **PyPI:** Trusted publishing configured
- **npm:** Planned — requires npm provenance support
- **Environment:** Production deployments use `environment:` with protection rules

---

## 3. Static Analysis (SAST)

| Project | Tool | Languages | Frequency |
|---------|------|-----------|-----------|
| Mutly | CodeQL, Secretlint, Semgrep (via RepoRank) | TypeScript/JavaScript | Every push + PR |
| VibeServe | CodeQL, Bandit, Trufflehog | Python | Every push + PR |
| RepoRank | CodeQL, Semgrep (self-hosted) | TypeScript/JavaScript | Every push + PR |

### CodeQL Configuration
- **Languages:** javascript-typescript (Mutly, RepoRank), python (VibeServe)
- **Query suite:** `security-extended` + `security-and-quality`
- **Alerting:** Results uploaded to GitHub Security tab

---

## 4. Container Security

### Image Scanning
- **Tool:** Trivy (aquasecurity/trivy-action)
- **Frequency:** Every push + PR + weekly schedule
- **Severity threshold:** HIGH and CRITICAL
- **Output:** SARIF uploaded to GitHub Security tab

### Docker Best Practices
- **Multi-stage builds:** Minimize attack surface
- **Non-root user:** `USER mutly` / `USER vibeserve`
- **Pinned digests:** All base images use `@sha256:...`
- **Health checks:** Docker HEALTHCHECK configured
- **No secrets:** `.env` excluded via `.dockerignore`

---

## 5. License Compliance

### Allowed Licenses
**Production dependencies only:**

| License | SPDX ID |
|---------|---------|
| MIT | MIT |
| ISC | ISC |
| Apache 2.0 | Apache-2.0 |
| BSD 2-Clause | BSD-2-Clause |
| BSD 3-Clause | BSD-3-Clause |
| Zero-Clause BSD | 0BSD |
| The Unlicense | Unlicense |
| Creative Commons Zero | CC0-1.0 |
| Blue Oak 1.0 | BlueOak-1.0.0 |
| Python Software Foundation | PSF |
| Mozilla Public License 2.0 | MPL-2.0 |

### Enforcement
- **CI check:** `license-checker` / `pip-licenses` fails on disallowed licenses
- **Frequency:** Every push to main + weekly schedule
- **Exception process:** Open issue with `license-exception` label, document rationale

---

## 6. Branch Protection

### Required Settings (GitHub repository settings)
```yaml
branches:
  main/master:
    required_pull_request_reviews:
      required_approving_review_count: 1
    required_status_checks:
      - CI
      - Security Scan
    require_signed_commits: true
    require_linear_history: false
    enforce_admins: false
    restrictions: null
```

### CI Enforcement
- All PRs must pass: typecheck, tests, lint, secret scan, dependency audit
- Security scan is advisory (non-blocking) — separate workflow
- Quality gate (RepoRank) is advisory for repos using it

---

## 7. Secrets Management

### Rotation Schedule
| Secret Type | Rotation | Tool |
|-------------|----------|------|
| API keys (LLM providers) | Every 90 days | Manual |
| PyPI token | N/A (OIDC, no tokens) | — |
| GitHub PATs | Every 90 days | GitHub notification |
| JWT/API secrets | Every 180 days | Manual |

### Detection
- **Secretlint** (Mutly) — pre-commit + CI
- **Trufflehog** (VibeServe) — CI
- **Semgrep secrets rules** (RepoRank) — quality gate

### Response
If a secret is committed:
1. Immediately rotate the secret
2. Rewrite git history (BFG / git filter-branch) if feasible
3. File post-mortem in `.github/security-incidents/`

---

## 8. Audit Trail

### Provenance Tracking
Every artifact produced by a build pipeline carries provenance:
- **Origin:** human / ai / mixed
- **Build SHA:** commit that produced it
- **Workflow:** GitHub Actions run ID + workflow file hash
- **SLSA attestation:** cryptographically signed by GitHub

### CI Log Retention
- **GitHub Actions:** 90 days (default)
- **Artifacts:** 90 days (SBOM, test results, benchmark data)
- **Security alerts:** Indefinite (CodeQL SARIF, Trivy reports)

---

## 9. Compliance Checklist

Before any release to production:

- [ ] All CI checks pass (lint, test, typecheck)
- [ ] Security scan passes (CodeQL, secret scan, dependency audit)
- [ ] SBOM generated and attached to release
- [ ] SLSA provenance generated
- [ ] Container image scanned (Trivy — no HIGH/CRITICAL)
- [ ] License check passes
- [ ] CHANGELOG.md updated
- [ ] Signed commit / signed tag on release
- [ ] No secrets in source code (confirmed by scan)

---

## 10. Incident Response

### Security Vulnerability Discovery
1. Triage: assign severity (CRITICAL/HIGH/MEDIUM/LOW)
2. Patch: create fix on private fork or feature branch
3. Test: verify fix, ensure no regression
4. Release: publish patch version, update advisory
5. Disclosure: publish CVE/GHSA if applicable

### Contact
- **Security:** Report via GitHub Security Advisory (private)
- **Maintainer:** @ncsound919

---

*Policy last reviewed: June 9, 2026*
*Next review: September 9, 2026*
