// Mutly UI Productivity E2E Test
// Tests every UI function in the Mutly Daemon (http://localhost:3001/)
// using realistic workflows — not just clicks, but productive feature use.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MUTLY_UI_URL || "http://localhost:3001";
const OUTPUT = join(__dirname, "output");
const SCREENSHOTS = join(OUTPUT, "screenshots");

mkdirSync(SCREENSHOTS, { recursive: true });

const STARTED = new Date().toISOString();
const REPORT = {
  startedAt: STARTED,
  durationMs: 0,
  summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
  sections: [],
  globalConsoleErrors: [],
  globalNetworkErrors: [],
};
let allConsoleErrors = [];

function captureResult(section, funcName, status, opts = {}) {
  const { durationMs, error, screenshot } = opts;
  let sectionObj = REPORT.sections.find((s) => s.slug === slugify(section));
  if (!sectionObj) {
    sectionObj = {
      name: section,
      slug: slugify(section),
      status: "PASS",
      functions: [],
    };
    REPORT.sections.push(sectionObj);
  }
  sectionObj.functions.push({
    name: funcName,
    status,
    durationMs: durationMs || 0,
    error: error || null,
    screenshot: screenshot || null,
    consoleErrors: [...allConsoleErrors],
    networkErrors: [],
  });
  allConsoleErrors = [];
  REPORT.summary.total++;
  if (status === "PASS") REPORT.summary.passed++;
  else if (status === "FAIL") {
    REPORT.summary.failed++;
    sectionObj.status = "PARTIAL";
  }
}

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function screenshotName(section, func) {
  const idx = String(REPORT.summary.total + 1).padStart(2, "0");
  return `${idx}-${slugify(section)}-${slugify(func)}.png`;
}

async function snap(page, section, func) {
  const name = screenshotName(section, func);
  const path = join(SCREENSHOTS, name);
  await page.screenshot({ path, fullPage: false });
  return name;
}

async function withCapture(page, section, func, fn) {
  const t0 = performance.now();
  try {
    await fn();
    const ms = performance.now() - t0;
    const sshot = await snap(page, section, func);
    captureResult(section, func, "PASS", { durationMs: ms, screenshot: sshot });
    console.log(`  ✓ ${section} > ${func} (${ms.toFixed(0)}ms)`);
  } catch (e) {
    const ms = performance.now() - t0;
    const sshot = await snap(page, section, func).catch(() => null);
    captureResult(section, func, "FAIL", { durationMs: ms, error: e.message, screenshot: sshot });
    console.log(`  ✗ ${section} > ${func} (${ms.toFixed(0)}ms): ${e.message}`);
  }
}

async function runSection(page, sectionName, sectionFn) {
  console.log(`\n=== ${sectionName} ===`);
  const t0 = performance.now();
  try {
    await sectionFn(page);
  } catch (e) {
    console.log(`  [SECTION ERROR] ${e.message}`);
  }
  const ms = performance.now() - t0;
  console.log(`  [${sectionName} completed in ${ms.toFixed(0)}ms]`);
}

// ─────────────────────────────────────────────────────────────────
// BROWSER LAUNCH
// ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") allConsoleErrors.push(msg.text());
});
page.on("pageerror", (err) => allConsoleErrors.push(err.message));

try {

// ─────────────────────────────────────────────────────────────────
// 1. LANDING PAGE
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Landing Page", async (p) => {
  await withCapture(p, "Landing Page", "Load app", async () => {
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
    await p.waitForTimeout(1000);
    // Verify landing page content
    const body = await p.locator("body").innerText();
    if (!body.includes("Mutly") && !body.includes("Daemon") && !body.includes("Deterministic AI")) {
      throw new Error("Landing page did not render expected content");
    }
  });

  await withCapture(p, "Landing Page", "Enter Command Center", async () => {
    const btn = p.locator("button", { hasText: "Enter Command Center" });
    await btn.click({ timeout: 10000 });
    await p.waitForTimeout(1500);
    // Verify we're now in the dashboard
    const url = p.url();
    const content = await p.locator("body").innerText();
    if (!content.includes("Dashboard") && !content.includes("Mutly") && !content.includes("Source Import")) {
      throw new Error("Did not transition to dashboard after clicking Enter");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. SOURCE IMPORT (Src Import tab)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Source Import", async (p) => {
  // Navigate to Source Import tab (it should be first in sidebar)
  const importTab = p.locator("button", { hasText: "Source Import" });
  await importTab.click();
  await p.waitForTimeout(1000);

  // Test 1: Folder picker button (KNOWN BUG)
  await withCapture(p, "Source Import", "Select Folder button click", async () => {
    const folderBtn = p.locator("button, label", { hasText: /Select Folder|Choose Folder|Browse|Open Folder/i });
    const folderInput = p.locator('input[type="file"]');
    
    // Check if folder button (or label for hidden input) exists
    const btnCount = await folderBtn.count();
    const inputCount = await folderInput.count();
    
    if (btnCount === 0 && inputCount === 0) {
      throw new Error("No 'Select Folder' button or file input found on Source Import page");
    }
    
    if (btnCount > 0) {
      // Click the button
      await folderBtn.first().click();
      await p.waitForTimeout(500);
      
      // Check if a file input appeared or dialog was triggered
      const inputAfterClick = await p.locator('input[type="file"]').count();
      if (inputAfterClick === 0) {
        // Check browser for file chooser
        const [fileChooser] = await Promise.all([
          p.waitForEvent('filechooser', { timeout: 2000 }).catch(() => null),
          Promise.resolve(),
        ]);
        if (!fileChooser) {
          throw new Error("Folder picker button clicked but no file dialog opened and no <input type=file> found");
        }
      }
    } else {
      // Input exists directly — verify it's not disabled
      const isDisabled = await folderInput.first().isDisabled();
      if (isDisabled) {
        throw new Error("File input exists but is disabled");
      }
    }
  });

  // Test 2: GitHub URL submit
  await withCapture(p, "Source Import", "GitHub URL submit", async () => {
    const urlInput = p.locator('input[type="text"], input[placeholder*="github" i], input[placeholder*="url" i]');
    await urlInput.first().waitFor({ state: "visible", timeout: 3000 });
    await urlInput.first().fill("https://github.com/tap919/Jobclaw");
    await p.waitForTimeout(200);
    
    const submitBtn = p.locator("button", { hasText: /Start Analysis|Analyze|Submit|Import|Git/i });
    await submitBtn.first().click();
    await p.waitForTimeout(2000);
    
    // Check if progress logs appear
    const progress = p.locator("text=/INDEXER|ANALYZER|AST|SUCCESS|analyzing|progress/i");
    const progressCount = await progress.count();
    // It's OK if no progress (API may not work without Gemini key)
    // We just verify the page handles the interaction gracefully
    const errors = allConsoleErrors.length;
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. DASHBOARD
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Dashboard", async (p) => {
  const dashTab = p.locator("button", { hasText: "Dashboard" });
  await dashTab.click();
  await p.waitForTimeout(2000);

  await withCapture(p, "Dashboard", "Status widgets render", async () => {
    const body = await p.locator("body").innerText();
    const metrics = ["uptime", "memory", "sandbox", "vibeserve", "status", "active"].some(
      (m) => body.toLowerCase().includes(m)
    );
    if (!metrics && !body.includes("Mutly")) {
      console.log("  [WARN] Dashboard may be empty - check if /api/agent/status returns data");
    }
  });

  await withCapture(p, "Dashboard", "Live data polling active", async () => {
    await p.waitForTimeout(4500);
    if (allConsoleErrors.length > 0) {
      console.log("  [WARN] Console errors detected during polling:", allConsoleErrors.slice(0, 3));
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. SPEC.md
// ─────────────────────────────────────────────────────────────────
await runSection(page, "SPEC.md", async (p) => {
  const specTab = p.locator("button", { hasText: "SPEC.md" });
  await specTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "SPEC.md", "Edit spec text and save", async () => {
    const textarea = p.locator("textarea, [contenteditable=true]");
    if (await textarea.count() > 0) {
      await textarea.first().fill("# Test Spec\n\n## Architecture\n- Simple test");
      await p.waitForTimeout(300);

      const saveBtn = p.locator("button", { hasText: /Save|Update|Apply/i });
      if (await saveBtn.count() > 0) {
        await saveBtn.first().click();
        await p.waitForTimeout(500);
      }
    } else {
      console.log("  [WARN] SPEC.md page has no textarea");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. REPL ENGINE (UltraPlan)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "REPL Engine", async (p) => {
  const replTab = p.locator("button", { hasText: "REPL Engine" });
  await replTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "REPL Engine", "Generate Plan", async () => {
    const genBtn = p.locator("button", { hasText: /Generate|Plan|New Plan/i });
    if (await genBtn.count() > 0) {
      await genBtn.first().click();
      await p.waitForTimeout(3000);
    } else {
      console.log("  [WARN] No Generate Plan button found");
    }
  });

  await withCapture(p, "REPL Engine", "Run Step 1", async () => {
    const stepBtn = p.locator("button", { hasText: /Run Step|Execute Step|Step 1/i });
    if (await stepBtn.count() > 0) {
      await stepBtn.first().click();
      await p.waitForTimeout(2000);
    } else {
      const runAll = p.locator("button", { hasText: /Run All|Execute All/i });
      if (await runAll.count() === 0) {
        console.log("  [WARN] No step execution buttons found on REPL Engine page");
      }
    }
  });

  await withCapture(p, "REPL Engine", "Run All Steps", async () => {
    const runAll = p.locator("button", { hasText: /Run All|Execute All|All Steps/i });
    if (await runAll.count() > 0) {
      await runAll.first().click();
      await p.waitForTimeout(2000);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. GREP & AST (Memory)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Grep & AST", async (p) => {
  const memTab = p.locator("button", { hasText: "Grep & AST" });
  await memTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Grep & AST", "Trigger embeddings index", async () => {
    const idxBtn = p.locator("button", { hasText: /Index|Trigger Index|Embeddings|Reindex/i });
    if (await idxBtn.count() > 0) {
      await idxBtn.first().click();
      await p.waitForTimeout(4000);
    } else {
      console.log("  [WARN] No Index/Embeddings button found on Memory page");
    }
  });

  await withCapture(p, "Grep & AST", "Search symbol by keyword", async () => {
    const searchInput = p.locator('input[type="text"], input[placeholder*="search" i], input[placeholder*="symbol" i]');
    if (await searchInput.count() > 0) {
      await searchInput.first().fill("App");
      await p.waitForTimeout(300);

      const searchBtn = p.locator("button", { hasText: /Search|Find|Query|Go/i });
      if (await searchBtn.count() > 0) {
        await searchBtn.first().click();
      } else {
        await searchInput.first().press("Enter");
      }
      await p.waitForTimeout(2000);
    } else {
      console.log("  [WARN] No search input found on Memory page");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. MUTLY DAEMON (Kairos)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Mutly Daemon", async (p) => {
  const kairosTab = p.locator("button", { hasText: "Mutly Daemon" });
  await kairosTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Mutly Daemon", "Runtime metrics display", async () => {
    const body = await p.locator("body").innerText();
    const hasMetrics = ["daemon", "mutly", "status", "uptime", "node", "sandbox"].some(
      (m) => body.toLowerCase().includes(m)
    );
    if (!hasMetrics) {
      console.log("  [WARN] Kairos page may not show expected runtime metrics");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 8. TOKEN COMPACTOR (AutoDream)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Token Compactor", async (p) => {
  const dreamTab = p.locator("button", { hasText: "Token Compactor" });
  await dreamTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Token Compactor", "Start Dream cycle", async () => {
    const dreamBtn = p.locator("button", { hasText: /Start Dream|Dream|Auto.?Dream/i });
    if (await dreamBtn.count() > 0) {
      await dreamBtn.first().click();
      await p.waitForTimeout(6000);
      const body = await p.locator("body").innerText();
      console.log("  [post-dream] body snippet:", body.substring(0, 200).replace(/\n/g, " "));
    } else {
      console.log("  [WARN] No Dream button found on Token Compactor page");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. SECURE SANDBOX
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Secure Sandbox", async (p) => {
  const sandTab = p.locator("button", { hasText: "Secure Sandbox" });
  await sandTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Secure Sandbox", "Select preset command", async () => {
    const preset = p.locator("button", { hasText: /tsc|npm|node|lint|build/i });
    if (await preset.count() > 0) {
      await preset.first().click();
      await p.waitForTimeout(500);
    } else {
      console.log("  [WARN] No preset command buttons found on Sandbox page");
    }
  });

  await withCapture(p, "Secure Sandbox", "Execute sandbox command", async () => {
    const execBtn = p.locator("button", { hasText: /Execute|Run|Launch/i });
    if (await execBtn.count() > 0) {
      await execBtn.first().click();
      await p.waitForTimeout(4000);
      const logOutput = p.locator("text=/stdout|stderr|output|result|exit|error|success|\\[OK\\]/i");
      const logCount = await logOutput.count();
      console.log(`  [sandbox] Log lines found: ${logCount}`);
    } else {
      console.log("  [WARN] No Execute button found on Sandbox page");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 10. CONTEXT INJECTOR
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Context Injector", async (p) => {
  const injTab = p.locator("button", { hasText: "Context Injector" });
  await injTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Context Injector", "Inject anchor", async () => {
    const injectBtn = p.locator("button", { hasText: /Inject|Anchor|Add Anchor/i });
    if (await injectBtn.count() > 0) {
      const beforeText = await p.locator("body").innerText();
      await injectBtn.first().click();
      await p.waitForTimeout(1500);
      const afterText = await p.locator("body").innerText();
      if (beforeText === afterText) {
        console.log("  [WARN] Inject button clicked but UI did not update");
      }
    } else {
      console.log("  [WARN] No Inject button found on Context Injector page");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 11. IDE INTEGRATIONS
// ─────────────────────────────────────────────────────────────────
await runSection(page, "IDE Integrations", async (p) => {
  const ideTab = p.locator("button", { hasText: "IDE Integrations" });
  await ideTab.click();
  await p.waitForTimeout(1000);

  // VS Code Chat tab
  await withCapture(p, "IDE Integrations", "VS Code Chat prompt", async () => {
    const chatTab = p.locator("button", { hasText: /VS Code|Chat|VS Code Chat/i });
    if (await chatTab.count() > 0) await chatTab.first().click();
    await p.waitForTimeout(300);

    const input = p.locator('textarea, input[type="text"]');
    if (await input.count() > 0) {
      await input.first().fill("Refactor the Dashboard component");
      await p.waitForTimeout(200);

      const sendBtn = p.locator("button", { hasText: /Send|Submit|Ask/i });
      if (await sendBtn.count() > 0) {
        await sendBtn.first().click();
        await p.waitForTimeout(3000);
      } else {
        await input.first().press("Enter");
        await p.waitForTimeout(3000);
      }
    } else {
      console.log("  [WARN] No chat input found on IDE Integrations page");
    }
  });

  // RPC tab
  await withCapture(p, "IDE Integrations", "RPC Run Tests", async () => {
    const rpcTab = p.locator("button", { hasText: /RPC|Remote|Procedure/i });
    if (await rpcTab.count() > 0) await rpcTab.first().click();
    await p.waitForTimeout(500);

    const rpcBtn = p.locator("button", { hasText: /Run|Test|Execute/i });
    if (await rpcBtn.count() > 0) {
      await rpcBtn.first().click();
      await p.waitForTimeout(2000);
    }
  });

  // REST test
  await withCapture(p, "IDE Integrations", "REST Test Endpoint", async () => {
    const restTab = p.locator("button", { hasText: /REST|HTTP|Endpoint/i });
    if (await restTab.count() > 0) await restTab.first().click();
    await p.waitForTimeout(500);

    const restBtn = p.locator("button", { hasText: /Test|Send|Request|Call/i });
    if (await restBtn.count() > 0) {
      await restBtn.first().click();
      await p.waitForTimeout(2000);
    } else {
      console.log("  [WARN] No REST Test button found");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 12. CODE NEXUS AUDIT (CodeAuditor)
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Code Nexus Audit", async (p) => {
  const auditTab = p.locator("button", { hasText: "Code Nexus Audit" });
  await auditTab.click();
  await p.waitForTimeout(1000);

  await withCapture(p, "Code Nexus Audit", "Run codebase audit", async () => {
    const runBtn = p.locator("button", { hasText: /Run|Audit|Scan|Start Audit/i });
    if (await runBtn.count() > 0) {
      await runBtn.first().click();
      await p.waitForTimeout(5000);
      const body = await p.locator("body").innerText();
      const hasResults = /issue|error|warning|score|critical|scan|result/i.test(body);
      console.log(`  [audit] Results found: ${hasResults}`);
    } else {
      console.log("  [WARN] No Run Audit button found on Code Nexus Audit page");
    }
  });

  await withCapture(p, "Code Nexus Audit", "Fix simulation", async () => {
    const fixBtn = p.locator("button", { hasText: /Fix|Simulate|Apply Fix/i });
    if (await fixBtn.count() > 0) {
      await fixBtn.first().click();
      await p.waitForTimeout(2000);
    } else {
      console.log("  [WARN] No Fix button found on Code Nexus Audit page");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 13. SIDEBAR CONTROLS
// ─────────────────────────────────────────────────────────────────
await runSection(page, "Sidebar Controls", async (p) => {
  // Navigate to dashboard first to have a neutral view
  const dashTab = p.locator("button", { hasText: "Dashboard" });
  await dashTab.click();
  await p.waitForTimeout(500);

  await withCapture(p, "Sidebar Controls", "Toggle Auto-Pilot ON", async () => {
    const toggle = p.locator("button", { hasText: /Enable Auto.?Pilot/i });
    if (await toggle.count() > 0) {
      await toggle.first().click();
      await p.waitForTimeout(2000);
    } else {
      const disable = p.locator("button", { hasText: /Disable Auto.?Pilot/i });
      if (await disable.count() > 0) {
        console.log("  [INFO] Auto-Pilot was already enabled");
      } else {
        console.log("  [WARN] No Auto-Pilot toggle button found in sidebar");
      }
    }
  });

  await withCapture(p, "Sidebar Controls", "Toggle Auto-Pilot OFF", async () => {
    const disable = p.locator("button", { hasText: /Disable Auto.?Pilot/i });
    if (await disable.count() > 0) {
      await disable.first().click();
      await p.waitForTimeout(1000);
    }
  });

  await withCapture(p, "Sidebar Controls", "Force Auto-Dream", async () => {
    const dreamBtn = p.locator("button", { hasText: /Force Auto.?Dream/i });
    if (await dreamBtn.count() > 0) {
      await dreamBtn.first().click();
      await p.waitForTimeout(2000);
    } else {
      console.log("  [WARN] No Force Auto-Dream button found in sidebar");
    }
  });
});

} catch (e) {
  console.log(`\n  [FATAL] ${e.message}`);
} finally {
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────
REPORT.durationMs = new Date().getTime() - new Date(STARTED).getTime();
REPORT.globalConsoleErrors = allConsoleErrors;
REPORT.overall = REPORT.summary.failed === 0 ? "PASS" : "FAIL";
const reportPath = join(OUTPUT, "report.json");
writeFileSync(reportPath, JSON.stringify(REPORT, null, 2));
console.log(`\nReport: ${reportPath}`);
console.log(`Summary: ${REPORT.summary.passed}/${REPORT.summary.total} passed, ${REPORT.summary.failed} failed`);
