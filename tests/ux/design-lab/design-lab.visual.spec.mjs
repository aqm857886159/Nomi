// 设计实验室 · 视觉基线（每屏每状态一张）。
//
// 这是「UI 交付 = 实验室截图拍板 + 视觉基线绿」里的**绿**那一半：
// 拍板过的那一格长什么样，逐像素钉在 `__baselines__/<屏>/<id>.png` 里；
// 谁改动了 token、间距、控件，这里当场红，并给出 -expected/-actual/-diff 三张图。
//
// 基线**只在用户拍板后**更新：`pnpm run design-lab:update`（走 NOMI_DESIGN_LAB_UPDATE=1）。
// 平时跑（含 CI）配置里写死 updateSnapshots:'none'，谁也不能顺手把红洗绿。
import { expect, test } from '@playwright/test'
import { LAB_SCREEN_IDS, pendingApprovalScreens, readCalibration, readLabStates } from './labStates.mjs'

const calibration = readCalibration()
// 「基线待用户拍板」的屏（calibration.json 的 pendingApprovalScreens）整屏跳过比对：
// 没人看过的图没有可回归的对象，比它等于把「今天碰巧长这样」钉成「应该长这样」。
// `design-lab:update` 跑的就是来录基线的那一趟，所以它不跳——拍板后录完记得删登记。
const UPDATING = process.env.NOMI_DESIGN_LAB_UPDATE === '1'
const pending = pendingApprovalScreens()

for (const screen of LAB_SCREEN_IDS) {
  if (pending[screen] && !UPDATING) continue
  const states = readLabStates(screen)
  // 容差按屏取（见 calibration.json 的 why.perScreenTolerance：大格用比例会宽到放过真实改动）。
  const tolerance = calibration.screens[screen]?.tolerance
  if (!tolerance) throw new Error(`calibration.json 里没有 ${screen} 屏的容差声明`)

  test.describe(`design lab · ${screen}`, () => {
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
        // 浮层类形态走 BodyPortal + fixed 定位，根本不在舞台的子树里——按元素截会截出
        // 「浮层没打开」的假证据，所以这一族改截整屏（注册项里显式声明 capture: 'viewport'）。
        if (state.capture === 'viewport') await expect(page).toHaveScreenshot([screen, `${state.id}.png`], tolerance)
        else await expect(shot).toHaveScreenshot([screen, `${state.id}.png`], tolerance)
        expect(errors, `渲染 ${state.id} 时页面抛错`).toEqual([])
      })
    }
  })
}
