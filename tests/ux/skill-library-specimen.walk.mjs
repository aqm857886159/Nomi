import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, clickOrFail } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'

// Start Vite separately; the specimen reads the real Electron host, not fabricated DTOs.
const base = process.env.NOMI_SKILL_UI_DEV_URL || 'http://127.0.0.1:5297'
const output = path.resolve('docs/design/verification/2026-09-09-skill-library')
const run = await launchNomiApp({ name: 'skill-library-specimen', settleMs: 0, env: { NOMI_RENDERER_URL: base, VITE_DEV_SERVER_URL: base } })
try {
  await expectVisible(newProjectEntry(run.win), '真实 Electron 宿主已就绪')
  await run.win.goto(`${base}/docs/design/verification/2026-09-09-skill-library/specimen.html`)
  const window = await run.app.browserWindow(run.win)
  await window.evaluate(w => w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }))
  // 2026-10-24 boards: the specimen shows the wide page and the 280px drawer side by side (both real hosts of the same content).
  // The home view shows one row per group, so the card under test is the first real skill that has a cover image.
  await expectVisible(run.win.locator('[data-library-host="drawer"] [data-skill-card]').first(), 'board:SkillLibrary/library.devlab-specimen')
  const card = run.win.locator('[data-library-host="page"] [data-skill-card]:has(img)').first()
  await card.scrollIntoViewIfNeeded()
  await expect.poll(() => card.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await run.win.screenshot({ path: path.join(output, 'specimen-library.png') })
  // 技能详情按角色 + 名字找：名字就是卡片上的技能名。
  const cardTitle = (await card.locator('[data-library-entry-title]').textContent())?.trim() ?? ''
  await clickOrFail(card, '打开真实技能详情')
  await expectVisible(run.win.getByRole('dialog', { name: cardTitle, exact: true }), '技能详情弹窗打开')
  await run.win.screenshot({ path: path.join(output, 'specimen-detail.png') })
} finally { await run.close() }
