// 「交给 Agent」是 v6 合同的三个入口（§2.7）：页脚「选中 N 镜 · 交给 Agent 改」/ 多选浮条 / 每行 ⋯ 菜单。
// 分镜批量方案 Q9 拍板「先不动」：本 PR 重构选择时不许把任何一个入口带走。
// 走真编辑器（harness 里是真 StoryboardPlanEditor + 真项目记录 store）：勾镜 → 点入口 → 看常驻 Agent 引用里确实挂上了这一镜。
import { test } from 'vitest'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { assertTailwindApplied, freshTailwindCss } from './_freshTailwindCss.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

freshTailwindCss()

const ENTRIES = [
  { name: '页脚入口', select: true, click: (page) => page.locator('[data-storyboard-agent-handoff="footer"]').click() },
  { name: '多选浮条入口', select: true, click: (page) => page.locator('[data-storyboard-agent-handoff="selection"]').click() },
  {
    name: '行菜单入口',
    select: false,
    click: async (page, en) => {
      await page.locator('[data-storyboard-row-menu-trigger="1"]').click()
      await page.locator('[data-storyboard-row-menu="1"]').getByRole('button', { name: en ? 'Ask Agent' : '交给 Agent', exact: true }).click()
    },
  },
]

for (const locale of ['zh-CN', 'en']) for (const entry of ENTRIES) test(`分镜「交给 Agent」${locale}：${entry.name}把这一镜挂给 Agent`, async () => {
  const en = locale === 'en'
  const cacheDir = makeTempDir('nomi-storyboard-handoff-')
  const server = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/original-storyboard-editor-harness.html?locale=${locale}`, { timeout: 120000 })
    await page.addStyleTag({ content: freshTailwindCss() })
    await assertTailwindApplied(page, 'storyboard-agent-handoff.test.mjs')
    await page.addStyleTag({ url: '/src/styles/index.css' })
    await expect(page.locator('[data-storyboard-editor]')).toBeVisible()
    const expand = page.locator('[data-storyboard-editor]').getByRole('button', { name: en ? 'Expand all' : '全部展开', exact: true })
    if (await expand.isVisible()) await expand.click()

    // 没勾任何镜：页脚入口在、但不可点（和 main 一致）。
    if (entry.name === '页脚入口') await expect(page.locator('[data-storyboard-agent-handoff="footer"]')).toBeDisabled()
    expect(await page.evaluate(() => window.originalStoryboard.agentRefs())).toEqual([])

    if (entry.select) await page.getByRole('checkbox', { name: en ? 'Select shot 1' : '选中镜 1' }).check()
    await entry.click(page, en)

    const refs = await page.evaluate(() => window.originalStoryboard.agentRefs())
    expect(refs, `${entry.name}：点了之后常驻 Agent 引用里应有且只有这一镜`).toHaveLength(1)
    expect(refs[0]).toContain('storyboard:plan:')
    expect(refs[0]).toContain('shot-a')
  } finally {
    await browser?.close()
    await server.close()
  }
}, 240000)
