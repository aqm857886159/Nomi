// 设计实验室 · 视觉基线（每屏每状态一张）。
//
// 这是「UI 交付 = 实验室截图拍板 + 视觉基线绿」里的**绿**那一半：
// 拍板过的那一格长什么样，逐像素钉在 `__baselines__/<屏>/<id>.png` 里；
// 谁改动了 token、间距、控件，这里当场红，并给出 -expected/-actual/-diff 三张图。
//
// 基线**只在用户拍板后**更新：`pnpm run design-lab:update`（走 NOMI_DESIGN_LAB_UPDATE=1）。
// 平时跑（含 CI）配置里写死 updateSnapshots:'none'，谁也不能顺手把红洗绿。
//
// **待拍板的屏整屏跳过**（`pendingApproval`）：它一张基线都没有，跑进来只会得到一串
// 「snapshot missing」——那既不是设计回归也不是工具坏了，是还没到录基线的时候。
// 跳过是明说出来的（test.skip 会在报告里留一行），不是静默不跑。
import { expect, test } from '@playwright/test'
import { LAB_SCREEN_IDS, readLabStates, screenIsPendingApproval } from './labStates.mjs'

for (const screen of LAB_SCREEN_IDS) {
  const states = readLabStates(screen)
  const pending = screenIsPendingApproval(screen)

  test.describe(`design lab · ${screen}`, () => {
    test.skip(pending, `${screen} 待用户拍板，还没有基线可比`)

    test('注册表与活页面一致（这把源码正则还活着的唯一证据）', async ({ page }) => {
      await page.goto(`/design-lab.html?screen=${screen}&frame=1&state=${states[0].id}`)
      await page.waitForFunction(() => window.__designLabReady === true)
      const live = await page.evaluate(() => window.__designLabStates)
      expect(live).toEqual(states.map((state) => state.id))
    })

    for (const state of states) {
      test(`状态 ${state.id} · ${state.name}`, async ({ page }) => {
        const errors = []
        page.on('pageerror', (error) => errors.push(String(error)))
        await page.goto(`/design-lab.html?screen=${screen}&frame=1&state=${state.id}`)
        await page.waitForFunction(() => window.__designLabReady === true)
        const shot = page.locator(`[data-design-lab-shot="${state.id}"]`)
        await expect(shot).toBeVisible()
        // 屏这一层由数组形式给出——写成 `'<屏>/<id>.png'` 里的 `/` 会被 Playwright 的
        // 文件名消毒换成 `-`，出来是扁平的 `<屏>-<id>.png`，不是目录。
        await expect(shot).toHaveScreenshot([screen, `${state.id}.png`])
        expect(errors, `渲染 ${state.id} 时页面抛错`).toEqual([])
      })
    }
  })
}
