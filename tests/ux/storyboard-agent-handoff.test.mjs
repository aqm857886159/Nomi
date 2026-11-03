// 2026-11-02 拍板：Agent 交接只保留选中浮条，选一镜也可用。
// 走真编辑器（harness 里是真 StoryboardPlanEditor + 真项目记录 store）：勾镜 → 点入口 → 看常驻 Agent 引用里确实挂上了这一镜。
import { test } from 'vitest'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { assertTailwindApplied, freshTailwindCss } from './_freshTailwindCss.mjs'
import { useBrowserFixture } from './_browserFixture.mjs'

freshTailwindCss()
const HARNESS = 'tests/ux/fixtures/original-storyboard-editor-harness.html'
const fixture = useBrowserFixture({ entries: [HARNESS], browserType: chromium })

for (const locale of ['zh-CN', 'en']) for (const count of [1, 3]) test(`分镜「交给 Agent」${locale}：选中浮条挂上 ${count} 镜并打开面板`, async () => {
  const en = locale === 'en'
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 1000 } })
  try {
    await page.goto(fixture.url(HARNESS, `?locale=${locale}${count === 3 ? '&many' : ''}`))
    await page.addStyleTag({ content: freshTailwindCss() })
    await assertTailwindApplied(page, 'storyboard-agent-handoff.test.mjs')
    await page.addStyleTag({ url: '/src/styles/index.css' })
    await expect(page.locator('[data-storyboard-editor]')).toBeVisible()
    const expand = page.locator('[data-storyboard-editor]').getByRole('button', { name: en ? 'Expand all' : '全部展开', exact: true })
    if (await expand.isVisible()) await expand.click()

    expect(await page.evaluate(() => window.originalStoryboard.agentRefs())).toEqual([])
    await page.evaluate(() => window.originalStoryboard.collapseAgent())
    expect(await page.evaluate(() => window.originalStoryboard.agentCollapsed())).toBe(true)

    for (let index = 1; index <= count; index += 1) await page.getByRole('checkbox', { name: en ? `Select shot ${index}` : `选中镜 ${index}` }).check()
    await page.locator('[data-storyboard-agent-handoff="selection"]').click()

    const refs = await page.evaluate(() => window.originalStoryboard.agentRefs())
    expect(refs, '常驻 Agent 引用应有且只有选中的镜头').toHaveLength(count)
    for (let index = 1; index <= count; index += 1) {
      expect(refs[index - 1]).toContain('storyboard:plan:')
      expect(refs[index - 1]).toContain(count === 1 ? 'shot-a' : `shot-a-${index}`)
    }
    expect(await page.evaluate(() => window.originalStoryboard.agentCollapsed())).toBe(false)
    await page.locator('[data-storyboard-agent-handoff="selection"]').click()
    expect(await page.evaluate(() => window.originalStoryboard.agentCollapsed())).toBe(false)
    expect(await page.evaluate(() => window.originalStoryboard.agentRefs())).toHaveLength(count)
  } finally {
    await page.close()
  }
})
