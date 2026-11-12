// Run after starting the repository's Vite server on port 5189.
import assert from 'node:assert/strict';
import { readFile, access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const origin = 'http://127.0.0.1:5189';
const url = `${origin}/docs/design/proposals/2026-11-09-tripo-3d/exploration.html`;
const files = ['README.md', 'api-contract.md', 'interaction.md', 'evaluation.md', 'sources.md'];
for (const file of files) {
  const markdown = await readFile(path.join(dir, file), 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (target && !/^https?:/.test(target)) await access(path.resolve(dir, target));
  }
}
const rows = (await readFile(path.join(dir, 'evaluation-cases.csv'), 'utf8')).trim().split('\n').map(row => row.split(','));
assert.equal(rows.length, 13);
for (const row of rows.slice(1)) {
  assert.equal(row.length, rows[0].length, `CSV columns: ${row[0]}`);
  assert.equal(row.at(-1), 'not_run');
  assert.ok(row.slice(2, -1).every(value => value === ''), 'No invented scores');
}

await mkdir(path.join(dir, 'preview'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let scenarios = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1040 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    assert.equal(new URL(request.url()).origin, origin, 'No external service requests');
    assert.equal(request.method(), 'GET', 'No submission or mutation');
  });
  for (const lang of ['zh', 'en']) for (const scheme of ['light', 'dark']) {
    await page.goto(`${url}?lang=${lang}&scheme=${scheme}`, { waitUntil: 'networkidle' });
    await page.locator('.viewer[data-loaded="true"]').waitFor();
    await page.screenshot({ path: path.join(dir, 'preview', `exploration-${lang}-${scheme}.png`), fullPage: true });
    const canvas = page.locator('canvas');
    const before = await canvas.evaluate(node => node.toDataURL());
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    assert.notEqual(await canvas.evaluate(node => node.toDataURL()), before, 'Orbit changes real GLB rendering');
    for (const step of ['prepare', 'connect', 'run', 'inspect', 'scene']) {
      await page.locator(`[data-step="${step}"]`).click();
      assert.equal(await page.locator('[aria-current="step"]').count(), 1);
      for (const state of ['ready', 'failed', 'stopped', 'unavailable']) {
        await page.locator('#state').selectOption(state);
        assert.equal(await page.locator('#state').inputValue(), state);
        assert.ok((await page.locator('#screenTitle').innerText()).length);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
        if (['inspect', 'scene'].includes(step)) await page.locator('.viewer[data-loaded="true"]').waitFor();
        if (lang === 'zh' && scheme === 'light' && state === 'ready') {
          await page.screenshot({ path: path.join(dir, 'preview', `flow-${step}.png`), fullPage: true });
        }
        scenarios++;
      }
    }
    await page.locator('[data-step="run"]').click();
    await page.locator('[data-action="stop"]').click();
    assert.equal(await page.locator('#state').inputValue(), 'stopped');
    await page.locator('[data-action="query"]').click();
    assert.equal(await page.locator('#state').inputValue(), 'ready');
    for (const width of [390, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('[data-step="inspect"]').click();
      await page.locator('.viewer[data-loaded="true"]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Narrow page overflow');
      if (width === 390) await page.screenshot({ path: path.join(dir, 'preview', `narrow-${lang}-${scheme}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1360, height: 1040 });
  }
  assert.deepEqual(errors, [], 'No page errors');
  console.log(JSON.stringify({ scenarios, localeThemeCombinations: 4, widths: [390, 800, 1360], localOnly: true, csvRows: rows.length - 1, status: 'passed' }, null, 2));
} finally {
  await browser.close();
}
