# SWE-bench Evaluation Setup

## Prerequisites

| Requirement | Status | Notes |
|---|---|---|
| Docker Desktop | ❌ Not installed | Required for SWE-bench evaluation harness |
| Python 3.10+ | ✅ 3.12.10 available | For SWE-bench CLI + harness |
| 120GB+ free disk | ❓ Unknown | Docker images + repos need ~120GB |
| 16GB+ RAM | ❓ Unknown | Harness recommends 16GB+ |
| 8+ CPU cores | ❓ Unknown | For parallel evaluation workers |
| Node.js 18+ | ✅ Present (Mutly depends on it) | For Mutly runner script |

## Installation

### 1. Install Docker Desktop

Download from [docker.com](https://www.docker.com/products/docker-desktop/). After install:

- Increase virtual disk space to ~120GB (Docker Desktop → Settings → Resources → Advanced)
- Ensure WSL2 backend is enabled on Windows

### 2. Clone and install SWE-bench

```bash
git clone https://github.com/princeton-nlp/SWE-bench.git
cd SWE-bench
pip install -e .
```

### 3. (Optional) Install sb-cli for cloud evaluation

```bash
pip install sb-cli
sb login
```

Cloud evaluation avoids local Docker resource requirements. See [sb-cli docs](https://github.com/swe-bench/sb-cli).

### 4. Validate SWE-bench installation

```bash
python -m swebench.harness.run_evaluation \
    --predictions_path gold \
    --max_workers 1 \
    --instance_ids sympy__sympy-20590 \
    --run_id validate-gold
```

On ARM-based systems (Mac M-series), add `--namespace ''` to build images locally.

## Available Datasets

| Dataset | Instances | Size |
|---|---|---|
| **SWE-bench Lite** | 300 | Recommended starting point |
| **SWE-bench Verified** | 500 | Human-validated solvable issues |
| **SWE-bench (Full)** | 2,294 | Full benchmark |
| **SWE-bench Multimodal** | 400+ | Includes visual domains |

## Mutly Integration

### Architecture

```
SWE-bench Instance (JSONL)
        │
        ▼
  swe-bench-runner.ts
        │
        ├── Clone repo at base_commit
        ├── Run `mutly build <workspace>` via CLI
        │     └── Mutly pipeline: Ingest → Plan → Build → Review
        ├── Capture `git diff` output
        └── Compare against expected patch
              │
              ▼
        results/{instance_id}.json
```

### Prediction Format

The runner produces a JSONL predictions file compatible with SWE-bench's harness:

```json
{"instance_id": "sympy__sympy-20590", "model_name_or_path": "mutly", "model_patch": "diff --git a/..."}
```

### Integration Steps

1. **Start Mutly server** (required for API-based execution):
   ```bash
   npm run dev
   ```

2. **Run evaluation on a single instance**:
   ```bash
   npx tsx bin/swe-bench-runner.ts \
     --instance path/to/instance.jsonl \
     --output ./swe-results
   ```

3. **Batch evaluation via SWE-bench harness**:
   Generate predictions JSONL, then:
   ```bash
   python -m swebench.harness.run_evaluation \
     --dataset_name princeton-nlp/SWE-bench_Lite \
     --predictions_path swe_results/predictions.jsonl \
     --max_workers 4 \
     --run_id mutly-eval-01 \
     --cache_level instance
   ```

### Runner Script

The `bin/swe-bench-runner.ts` script:
- Reads a SWE-bench instance from JSONL
- Clones the repository at the base commit
- Runs the Mutly pipeline via CLI (`mutly build <workspace>`)
- Captures the generated diff
- Validates against the expected patch
- Writes structured results to disk

## Running

### Option A: Local Docker Evaluation (full pipeline)

```bash
# Step 1: Generate predictions
python bin/swe-batch.py --dataset SWE-bench_Lite --output ./swe_results

# Step 2: Run SWE-bench harness validation
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path ./swe_results/predictions.jsonl \
    --max_workers 4 \
    --run_id mutly-lite-01
```

### Option B: Cloud Evaluation (sb-cli)

```bash
# Submit directly to sb-cli cloud
sb submit --predictions ./swe_results/predictions.jsonl
```

### Option C: Modal Cloud Evaluation

```bash
pip install modal swebench[modal]
modal setup
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path ./swe_results/predictions.jsonl \
    --parallelism 10 \
    --modal true
```

## Cost Estimation

### Local Execution Costs
- No API costs if using local models
- Electricity + hardware depreciation only
- Time: ~5-30 min per instance × 300 instances = 25-150 hours

### API-based Execution (recommended for Mutly)

| Model | Cost/Instance | SWE-bench Lite (300) | SWE-bench Verified (500) | Full SWE-bench (2,294) |
|---|---|---|---|---|
| Gemini 2.5 Flash | $1-3 | $300-900 | $500-1,500 | $2,294-6,882 |
| Gemini 2.5 Pro | $3-8 | $900-2,400 | $1,500-4,000 | $6,882-18,352 |
| GPT-4o | $5-15 | $1,500-4,500 | $2,500-7,500 | $11,470-34,410 |

**Estimated total**: $500-2,500 for a representative run using Gemini 2.5 Flash on SWE-bench Lite.

### Optimization Tips
- Use `--cache_level instance` to reuse Docker images across runs
- Start with SWE-bench Lite (300 instances) before scaling up
- Run a small pilot (10-20 instances) to calibrate cost per instance
- Use `--max_workers` to control parallelism vs. cost tradeoff

## Measuring Results

### Key Metrics

| Metric | Description |
|---|---|
| **Resolution Rate** | % of instances where patch fixes the issue |
| **Pass@1** | % resolved on first attempt |
| **Token Cost** | Total tokens consumed per instance |
| **Time per Instance** | Wall-clock time to generate a patch |
| **Drift Score** | Mutly's internal drift metric (0-1) |

### Output Structure

```
swe_results/
├── predictions.jsonl         # All predictions for harness
├── results/
│   ├── sympy__sympy-20590.json
│   ├── sympy__sympy-20590.diff
│   ├── django__django-12345.json
│   └── ...
├── summary.json              # Aggregated results
└── logs/                     # Per-instance logs
```

### Summary Report Format

```json
{
  "run_id": "mutly-lite-01",
  "dataset": "princeton-nlp/SWE-bench_Lite",
  "total": 300,
  "resolved": 142,
  "failed": 158,
  "resolution_rate": 0.473,
  "avg_time_ms": 245000,
  "avg_tokens": 85000,
  "total_cost_usd": 1200.50,
  "model": "gemini-2.5-flash"
}
```

## Blockers & Concerns

1. **Docker not installed**: SWE-bench harness requires Docker. Install Docker Desktop with WSL2 backend.
2. **Windows compatibility**: The SWE-bench harness is primarily tested on Linux x86_64. Windows may need WSL2 or a Linux VM for full compatibility.
3. **Disk space**: Each Docker image is ~2-8GB; with 300+ instances, expect 50-120GB total.
4. **ARM64 support**: Experimental only. If running on ARM, all Docker images must be built locally (`--namespace ''`).
5. **API costs**: At $1-3/instance for Gemini Flash, a full Lite run costs $300-900.
6. **Time**: Budget 25-150+ hours of wall-clock time for a full evaluation run depending on parallelism.
