@echo off
echo ========================================
echo   Mutly UI E2E Journey — Playwright
echo ========================================
echo.

echo [1/4] Killing old daemon...
taskkill /f /im node.exe >nul 2>&1
timeout /t 3 /nobreak >nul

echo [2/4] Starting Mutly daemon...
start /b cmd /c "cd /d %~dp0 && set PORT=3000 && set NODE_ENV=development && set LOG_LEVEL=error && npx tsx server.ts > daemon.log 2>&1"

echo [3/4] Waiting for daemon...
:waitloop
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:3000/health >nul 2>&1
if %errorlevel% neq 0 goto waitloop
echo   Daemon is ready!

echo [4/4] Running Playwright E2E tests...
npx playwright test tests/e2e/ui-journey.spec.ts --project=chromium --reporter=list

echo.
echo ========================================
echo   Done! Check test-results/ for screenshots
echo ========================================
pause
