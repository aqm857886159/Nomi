import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, clickOrFail } from './_assert.mjs'

// Start Vite separately; the specimen reads the real Electron host, not fabricated DTOs.
const base = process.env.NOMI_SKILL_UI_DEV_URL || 'http://127.0.0.1:5297'
const output = path.resolve('docs/design/verification/2026-09-09-skill-library')
const run = await launchNomiApp({ name: 'skill-library-specimen', settleMs: 0, env: { NOMI_RENDERER_URL: base, VITE_DEV_SERVER_URL: base } })
try {
  await expectVisible(run.win.getByRole('button', { name: '新建空白项目', exact: false }).first(), '真实 Electron 宿主已就绪')
  await run.win.goto(`${base}/docs/design/verification/2026-09-09-skill-library/specimen.html`)
  const window = await run.app.browserWindow(run.win)
  await window.evaluate(w => w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }))
  const card = run.win.locator('[data-skill-card="skill:curated-multi-view"]')
  await card.scrollIntoViewIfNeeded()
  await expect.poll(() => card.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await run.win.screenshot({ path: path.join(output, 'specimen-library.png') })
  await clickOrFail(card, '打开真实多视图技能详情')
  await expectVisible(run.win.getByRole('heading', { name: '配方', exact: true }), '详情正文使用 Markdown 标题')
  await run.win.screenshot({ path: path.join(output, 'specimen-detail.png') })
} finally { await run.close() }
