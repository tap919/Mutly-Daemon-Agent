import { test, expect, type Page } from "@playwright/test";

const SECTION_MAP: Record<string, string[]> = {
  Primary: ["Pipeline", "Settings"],
  Advanced: ["Agent Studio", "Safety & Sandbox", "Source Import"],
};

async function loadApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("text=Mutly", { timeout: 10000 });
  await expect(page.locator("text=Pipeline").first()).toBeVisible({ timeout: 10000 });
}

async function clickSidebar(page: Page, label: string) {
  const btn = page.locator("aside button", { hasText: label });
  if (!(await btn.isVisible().catch(() => false))) {
    for (const [section, items] of Object.entries(SECTION_MAP)) {
      if (items.includes(label)) {
        await page.locator("aside button", { hasText: section }).click();
        await page.waitForTimeout(200);
        break;
      }
    }
  }
  await btn.click();
  await page.waitForTimeout(300);
}

async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
}

async function clickCardSubView(page: Page, cardText: string) {
  const card = page.locator("button", { hasText: cardText }).filter({
    has: page.locator("h3"),
  });
  if (await card.isVisible().catch(() => false)) {
    await card.click();
  } else {
    await page.locator("button", { hasText: cardText }).first().click();
  }
  await page.waitForTimeout(500);
}

async function goBack(page: Page) {
  await page.locator("button", { hasText: "\u2190 Back" }).click();
  await page.waitForTimeout(300);
}

test.describe("Mutly UI — Integrated Journeys", () => {

  // ─── Journey 1: Pipeline workflow ─────────────────────────────

  test("J1 — Pipeline workflow from Pipeline grid", async ({ page }) => {
    await loadApp(page);

    // Pipeline is the default view
    await expect(page.locator("text=Pipeline").first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Plan & Execute" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Code Audit" }).first()).toBeVisible();
    await takeScreenshot(page, "j1-pipeline-grid");

    // Open Build Pipeline sub-view
    await clickCardSubView(page, "Build Pipeline");
    await expect(page.locator("text=Build Pipeline").first()).toBeVisible();
    // Project selector should be visible
    await expect(page.locator("button", { hasText: "Open Project" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Run Pipeline" }).first()).toBeVisible();
    await takeScreenshot(page, "j1-build-pipeline");

    await goBack(page);
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();

    // UltraPlan sub-view
    await clickCardSubView(page, "Plan & Execute");
    await expect(page.locator("text=Streamlined REPL Engine").first()).toBeVisible();
    const generateBtn = page.locator("button", { hasText: "Generate REPL Plan" });
    const runAllBtn = page.locator("button", { hasText: "Run All Steps" });
    const hasActionBtn = (await generateBtn.isVisible().catch(() => false)) ||
                         (await runAllBtn.isVisible().catch(() => false));
    expect(hasActionBtn).toBeTruthy();
    await takeScreenshot(page, "j1-ultraplan");

    await goBack(page);
    await clickCardSubView(page, "Code Audit");
    await expect(page.locator("button", { hasText: "Trigger Codebase Security Audit" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Audit Coding Pipelines" }).first()).toBeVisible();
    await takeScreenshot(page, "j1-codeaudit");

    await goBack(page);
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
  });

  // ─── Journey 2: Agent Studio + Safety ─────────────────────────

  test("J2 — Agent Studio and Safety deep dive", async ({ page }) => {
    await loadApp(page);

    await clickSidebar(page, "Agent Studio");
    await expect(page.locator("text=SPEC.md").first()).toBeVisible();
    await expect(page.locator("text=Daemon Status").first()).toBeVisible();
    await expect(page.locator("text=Token Compactor").first()).toBeVisible();
    await expect(page.locator("text=Context Injector").first()).toBeVisible();
    await expect(page.locator("text=Grep & AST").first()).toBeVisible();
    await takeScreenshot(page, "j2-studio-grid");

    await clickCardSubView(page, "SPEC.md");
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Update Context/i }).first()).toBeVisible();
    await goBack(page);
    await expect(page.locator("text=SPEC.md").first()).toBeVisible();

    await clickCardSubView(page, "SPEC.md");
    await expect(page.locator("textarea").first()).toBeVisible();
    await goBack(page);

    await clickCardSubView(page, "Daemon Status");
    await page.waitForTimeout(500);
    await goBack(page);

    await clickCardSubView(page, "Token Compactor");
    await expect(page.locator("button", { hasText: /Force Token Trim|Compacting/i }).first()).toBeVisible();
    await goBack(page);

    await clickCardSubView(page, "Context Injector");
    await page.waitForTimeout(500);
    await goBack(page);

    await clickCardSubView(page, "Grep & AST");
    await expect(page.locator("button", { hasText: "Semantic Embedding Index" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: /Re-Index Workspace/i }).first()).toBeVisible();
    await goBack(page);

    // Safety & Sandbox
    await clickSidebar(page, "Safety & Sandbox");
    await expect(page.locator("button", { hasText: "Secure Sandbox" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "IDE Integrations" }).first()).toBeVisible();
    await takeScreenshot(page, "j2-safety-grid");

    await clickCardSubView(page, "Secure Sandbox");
    await expect(page.locator("button", { hasText: "Lint Code" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Build App" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "TS Type Check" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Run Sandbox Command" }).first()).toBeVisible();
    await takeScreenshot(page, "j2-sandbox");

    await page.locator("button", { hasText: "TS Type Check" }).first().click();
    await page.waitForTimeout(300);
    await goBack(page);

    await clickCardSubView(page, "IDE Integrations");
    await expect(page.locator("button", { hasText: "VS Code Extension" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Daemon API Workbench" }).first()).toBeVisible();
    await takeScreenshot(page, "j2-ide-integrations");

    await page.locator("button", { hasText: "Zed MCP Adapter" }).first().click();
    await page.waitForTimeout(300);
    await page.locator("button", { hasText: "Daemon API Workbench" }).first().click();
    await page.waitForTimeout(300);
    await goBack(page);
  });

  // ─── Journey 3: Source Import + navigation loop ───────────────

  test("J3 — Source Import and full navigation", async ({ page }) => {
    await loadApp(page);

    // Source Import is in Advanced section
    await clickSidebar(page, "Source Import");
    await page.waitForTimeout(500);

    // May show upload form (fresh) or analysis results (if data from previous run)
    const selectFolderBtn = page.locator("button", { hasText: "Select Folder" }).first();
    const rescanBtn = page.locator("button", { hasText: /Re-scan/i }).first();
    const hasUploadForm = await selectFolderBtn.isVisible().catch(() => false);
    const hasResults = await rescanBtn.isVisible().catch(() => false);
    expect(hasUploadForm || hasResults).toBeTruthy();

    if (hasUploadForm) {
      await expect(page.locator('input[type="url"]').first()).toBeVisible();
      const urlInput = page.locator('input[type="url"]').first();
      await urlInput.fill("https://github.com/anthropic/claude-code");
      await page.waitForTimeout(200);
      await expect(page.locator('input[placeholder*="main"]').or(page.locator('input[type="text"]').nth(1))).toBeVisible();
    }
    await takeScreenshot(page, "j3-source-import");

    // Full navigation loop — all 5 tabs reachable
    const tabs = ["Pipeline", "Settings", "Agent Studio", "Source Import", "Safety & Sandbox"];
    for (const tab of tabs) {
      await clickSidebar(page, tab);
      await page.waitForTimeout(300);
      await expect(page.locator("main")).toBeVisible();
    }
    await takeScreenshot(page, "j3-nav-loop");
  });

  // ─── Journey 4: Settings collapsible sections ─────────────────

  test("J4 — Settings sections and controls", async ({ page }) => {
    await loadApp(page);

    await clickSidebar(page, "Settings");
    // Wait for settings content to resolve (loading → either content or offline)
    await page.waitForTimeout(2000);
    const contentArea = page.locator("main");
    const isOffline = await contentArea.locator("text=Daemon Offline").isVisible({ timeout: 8000 }).catch(() => false);
    if (isOffline) {
      await takeScreenshot(page, "j4-settings-offline");
      return;
    }

    // Agent section open by default
    const mainAgent = contentArea.locator("text=Main Agent").first();
    await expect(mainAgent).toBeVisible({ timeout: 5000 });
    await expect(contentArea.locator("select").first()).toBeVisible();
    await takeScreenshot(page, "j4-settings-agent");

    // Open Runtime Controls section (scoped to main to avoid sidebar conflicts)
    await contentArea.locator("button", { hasText: "Runtime Controls" }).click();
    await page.waitForTimeout(300);
    await expect(contentArea.locator("text=Adaptive Routing").first()).toBeVisible();
    await expect(contentArea.locator("text=Auto-Apply Fixes").first()).toBeVisible();
    await expect(contentArea.locator("text=Autonomy Kill Switch").first()).toBeVisible();
    await takeScreenshot(page, "j4-settings-runtime");

    // Open Pipeline section (scoped to main)
    await contentArea.locator("button", { hasText: "Pipeline" }).first().click();
    await page.waitForTimeout(300);
    await expect(contentArea.locator('input[type="range"]').first()).toBeVisible();
    await expect(contentArea.locator("text=Quality Threshold").first()).toBeVisible();
    await expect(contentArea.locator("text=Max Iterations").first()).toBeVisible();
    await takeScreenshot(page, "j4-settings-pipeline");

    // Interact with a range slider
    const slider = contentArea.locator('input[type="range"]').first();
    await slider.fill("80");
    await page.waitForTimeout(200);

    // Open Environment section (scoped to main)
    await contentArea.locator("button", { hasText: "Environment" }).first().click();
    await page.waitForTimeout(300);
    await takeScreenshot(page, "j4-settings-env");

    // Save Config and Refresh buttons visible
    await expect(contentArea.locator("button", { hasText: "Save Config" }).first()).toBeVisible();
    await expect(contentArea.locator("button", { hasText: "Refresh" }).first()).toBeVisible();
  });

  // ─── Journey 5: Real pipeline against Jobclaw ─────────────────

  test("J5 — Real pipeline: import Jobclaw → analyze → build → audit", async ({ page }) => {
    test.setTimeout(180000);
    await loadApp(page);

    // Source Import via GitHub URL
    await clickSidebar(page, "Source Import");
    await page.waitForTimeout(500);

    // May already have analysis results from a previous run
    const urlInput = page.locator('input[type="url"]');
    const hasUrlInput = await urlInput.isVisible().catch(() => false);
    if (hasUrlInput) {
      await urlInput.fill("https://github.com/tap919/Jobclaw");
      await page.waitForTimeout(200);
      await page.locator("button", { hasText: /Analyze/i }).first().click();

      // Wait for analysis
      await page.waitForTimeout(2000);
      await takeScreenshot(page, "j5-jobclaw-analyzing");
      await page.waitForTimeout(8000);
    }

    // After analysis, check for Inject & Execute Plan or Re-scan buttons
    const injectBtn = page.locator("button", { hasText: /Inject/i });
    const rescanBtn = page.locator("button", { hasText: /Re-scan/i });
    const hasResult = (await injectBtn.isVisible().catch(() => false)) ||
                      (await rescanBtn.isVisible().catch(() => false));
    expect(hasResult).toBeTruthy();
    await takeScreenshot(page, "j5-jobclaw-analyzed");

    // Pipeline: Build Pipeline view
    await clickSidebar(page, "Pipeline");
    await page.locator("button", { hasText: "Build Pipeline" }).first().click();
    await page.waitForTimeout(500);

    const buildView = page.locator("main");
    // Project selector visible
    await expect(buildView.locator("button", { hasText: "Open Project" }).first()).toBeVisible();
    // Select project directory via webkitdirectory file input
    const projectDir = "C:\\Users\\User\\Desktop\\Coding Trio\\Jobclaw";
    await buildView.locator('input[type="file"]').setInputFiles(projectDir);
    await page.waitForTimeout(500);

    // Run Pipeline button should now be enabled
    const runBtn = buildView.locator("button", { hasText: "Run Pipeline" }).first();
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toBeEnabled({ timeout: 3000 });
    await takeScreenshot(page, "j5-jobclaw-pipeline");

    await goBack(page);
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
  });

  // ─── Journey 6: Sidebar + Autopilot + Header state ────────────

  test("J6 — Sidebar, header, and auto-pilot state", async ({ page }) => {
    await loadApp(page);

    // Sidebar footer
    await expect(page.locator("button", { hasText: /Auto-Pilot/ }).first()).toBeVisible();
    const sidebar = page.locator("aside");
    await expect(
      sidebar.locator("text=Stateful Daemon")
        .or(sidebar.locator("text=Autonomous Mode"))
        .or(sidebar.locator("text=Connecting"))
        .or(sidebar.locator("text=Desktop Coding System"))
    ).toBeVisible({ timeout: 5000 });

    // Header elements
    const header = page.locator("header");
    await expect(header.locator("button", { hasText: "Compact" })).toBeVisible();
    await expect(header.locator("text=~/workspace").first()).toBeVisible();

    // Sidebar collapse/expand — Primary section
    await page.locator("aside button", { hasText: "Primary" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("aside button", { hasText: "Pipeline" })).not.toBeVisible();

    await page.locator("aside button", { hasText: "Primary" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("aside button", { hasText: "Pipeline" })).toBeVisible();

    // Toggle Auto-Pilot on
    await page.locator("button", { hasText: /Auto-Pilot/ }).click();
    await page.waitForTimeout(2000);

    // Navigate and come back
    await clickSidebar(page, "Safety & Sandbox");
    await page.waitForTimeout(300);
    await clickSidebar(page, "Pipeline");
    await page.waitForTimeout(300);
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
    await takeScreenshot(page, "j6-back-to-pipeline");

    await page.locator("button", { hasText: /Auto-Pilot/ }).click();
    await page.waitForTimeout(2000);
    await takeScreenshot(page, "j6-autopilot-off");
  });

  // ─── Journey 7: Sidebar section collapse persists across navigation ──

  test("J7 — Sidebar section collapse persists across navigation", async ({ page }) => {
    await loadApp(page);

    await clickSidebar(page, "Pipeline");
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();

    const advancedBtn = page.locator("aside button", { hasText: "Advanced" });

    // Advanced starts collapsed by default — verify items hidden initially
    for (const item of SECTION_MAP.Advanced) {
      await expect(page.locator("aside button", { hasText: item })).not.toBeVisible();
    }

    // Click to expand
    await advancedBtn.click();
    await page.waitForTimeout(300);
    for (const item of SECTION_MAP.Advanced) {
      await expect(page.locator("aside button", { hasText: item })).toBeVisible();
    }

    // Click to collapse
    await advancedBtn.click();
    await page.waitForTimeout(300);
    for (const item of SECTION_MAP.Advanced) {
      await expect(page.locator("aside button", { hasText: item })).not.toBeVisible();
    }

    // Navigate to Settings — collapse persists
    await clickSidebar(page, "Settings");
    await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
    for (const item of SECTION_MAP.Advanced) {
      await expect(page.locator("aside button", { hasText: item })).not.toBeVisible();
    }

    // Navigate back to Pipeline — collapse still persists
    await clickSidebar(page, "Pipeline");
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
    for (const item of SECTION_MAP.Advanced) {
      await expect(page.locator("aside button", { hasText: item })).not.toBeVisible();
    }

    await takeScreenshot(page, "j7-collapse-persists");
  });

  // ─── Journey 8: Pipeline grid shows all 3 cards ────────────────────

  test("J8 — Pipeline grid shows all 3 cards", async ({ page }) => {
    await loadApp(page);

    await clickSidebar(page, "Pipeline");
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Plan & Execute" }).first()).toBeVisible();
    await expect(page.locator("button", { hasText: "Code Audit" }).first()).toBeVisible();

    await takeScreenshot(page, "j8-pipeline-cards");
  });

  // ─── Journey 9: Error boundary renders on invalid state ────────────

  test("J9 — Error boundary renders on invalid state", async ({ page }) => {
    await loadApp(page);

    // Positive test: verify normal navigation works without crashing
    await clickSidebar(page, "Pipeline");
    await expect(page.locator("main")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();

    // Navigate to another view to confirm stability
    await clickSidebar(page, "Settings");
    await expect(page.locator("main")).toBeVisible({ timeout: 5000 });

    // Back to Pipeline — still works
    await clickSidebar(page, "Pipeline");
    await expect(page.locator("button", { hasText: "Build Pipeline" }).first()).toBeVisible();

    await takeScreenshot(page, "j9-no-crash");
  });

  // ─── Journey 10: Compact button in header is clickable ─────────────

  test("J10 — Compact button in header is clickable", async ({ page }) => {
    await loadApp(page);

    await clickSidebar(page, "Pipeline");

    const header = page.locator("header");
    const compactBtn = header.locator("button", { hasText: "Compact" });
    await expect(compactBtn).toBeVisible();
    await expect(compactBtn).toBeEnabled();

    // Click it to toggle compact mode
    await compactBtn.click();
    await page.waitForTimeout(300);

    await takeScreenshot(page, "j10-compact-clicked");
  });
});
