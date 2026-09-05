// Agent 面板 · 视觉基线（每个状态一张）。
//
// 这是「UI 交付 = 实验室截图拍板 + 视觉基线绿」里的**绿**那一半：
// 拍板过的那一格长什么样，逐像素钉在 `__baselines__/agent-panel/<id>.png` 里；
// 谁改动了 token、间距、控件，这里当场红，并给出 -expected/-actual/-diff 三张图。
//
// 基线**只在用户拍板后**更新：`pnpm run design-lab:update`（走 NOMI_DESIGN_LAB_UPDATE=1）。
// 平时跑（含 CI）配置里写死 updateSnapshots:'none'，谁也不能顺手把红洗绿。
import { expect, test } from '@playwright/test'
import { readLabStates } from './labStates.mjs'

const states = readLabStates()

test.describe('design lab · agent panel', () => {
  test('注册表与活页面一致（这把源码正则还活着的唯一证据）', async ({ page }) => {
    await page.goto(`/design-lab.html?screen=agent-panel&frame=1&state=${states[0].id}`)
    await page.waitForFunction(() => window.__designLabReady === true)
    const live = await page.evaluate(() => window.__designLabStates)
    expect(live).toEqual(states.map((state) => state.id))
  })

  for (const state of states) {
    test(`状态 ${state.id} · ${state.name}`, async ({ page }) => {
      const errors = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.goto(`/design-lab.html?screen=agent-panel&frame=1&state=${state.id}`)
      await page.waitForFunction(() => window.__designLabReady === true)
      const shot = page.locator(`[data-design-lab-shot="${state.id}"]`)
      await expect(shot).toBeVisible()
      await expect(shot).toHaveScreenshot(`${state.id}.png`)
      expect(errors, `渲染 ${state.id} 时页面抛错`).toEqual([])
    })
  }
})
