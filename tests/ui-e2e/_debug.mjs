import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

const buttons = await page.locator('button').all();
for (const btn of buttons) {
  const text = await btn.innerText();
  if (text.trim()) {
    console.log('button:', JSON.stringify(text.trim()), 'visible:', await btn.isVisible());
  }
}

console.log('\n--- Matching tests ---');
let c1 = await page.locator('button').filter({ hasText: 'Enter Command Center' }).count();
console.log('filter hasText string:', c1);
let c2 = await page.locator('button').filter({ hasText: /Enter Command Center/ }).count();
console.log('filter hasText regex:', c2);
let c3 = await page.locator('button[class*=indigo]').count();
console.log('indigo class buttons:', c3);

await browser.close();