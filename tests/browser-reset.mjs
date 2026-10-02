import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../src/lib/browserReset.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  let clears = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/browserReset.js') return route.fulfill({ contentType: 'text/javascript', body: source });
    if (url.pathname === '/browser-reset.json') { clears++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Reset fixture</body></html>' });
  });
  await page.goto('https://millersawdust.app');
  await page.evaluate(async () => {
    localStorage.setItem('miller_jwt', 'old-token');
    localStorage.setItem('miller_refresh_token', 'old-refresh');
    sessionStorage.setItem('old-ui', 'stale');
    await caches.open('old-cache');
    await new Promise(resolve => { const r = indexedDB.open('old-db'); r.onsuccess = () => { r.result.close(); resolve(); }; });
  });
  await page.evaluate(() => { import('/browserReset.js').then(m => m.resetBrowserOnce()); });
  await page.waitForURL('**/DriverLogin?siteReset=*');
  const state = await page.evaluate(async () => ({ token: localStorage.getItem('miller_jwt'), refresh: localStorage.getItem('miller_refresh_token'), marker: localStorage.getItem('miller_browser_reset'), session: sessionStorage.length, caches: await caches.keys(), dbs: await indexedDB.databases() }));
  assert.equal(state.token, null); assert.equal(state.refresh, null); assert.equal(state.session, 0);
  assert.equal(state.marker, 'domain-move-2026-10-02'); assert.deepEqual(state.caches, []); assert.deepEqual(state.dbs, []);
  await page.evaluate(() => localStorage.setItem('miller_jwt', 'new-login'));
  assert.equal(await page.evaluate(async () => (await import('/browserReset.js')).resetBrowserOnce()), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('miller_jwt')), 'new-login');
  assert.equal(clears, 1);
  await page.goto('https://dev.millersawdust.app');
  await page.evaluate(() => localStorage.setItem('miller_jwt', 'dev-login'));
  assert.equal(await page.evaluate(async () => (await import('/browserReset.js')).resetBrowserOnce()), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('miller_jwt')), 'dev-login');
  console.log('PASS: old auth/storage/cache cleared, login redirect, one-time reset, new login retained, dev untouched');
} finally { await browser.close(); }
