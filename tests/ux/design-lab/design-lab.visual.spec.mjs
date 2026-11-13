// 设计实验室 · 视觉基线（每屏每状态一张）。
//
// 这是「UI 交付 = 实验室截图拍板 + 视觉基线绿」里的**绿**那一半：
// 拍板过的那一格长什么样，逐像素钉在 `__baselines__/<屏>/<id>.png` 里；
// 谁改动了 token、间距、控件，这里当场红，并给出 -expected/-actual/-diff 三张图。
//
// 基线只从 CI 的 macOS 机器取回：`pnpm run design-lab:accept -- --run <运行号>`（见 visualMode.mjs）。
// 任何一趟（含 CI）配置里都写死 updateSnapshots:'none'，谁也不能顺手把红洗绿。
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { LAB_SCREEN_IDS, pendingApprovalScreens, readCalibration, readLabStates } from './labStates.mjs'

// Match the real macOS GPU backend for WebGL states; software shader compilation can block the page.
if (process.platform === 'darwin') test.use({ launchOptions: { args: ['--use-angle=metal'] } })
const calibration = readCalibration()
// 导演台两屏按真机走查窗口内容区取景（1280×933），格子与真机截图同尺寸才能并排比
const DIRECTOR_SCREENS = new Set(['director-3dbox', 'director-refine'])
// 「基线待用户拍板」的屏（calibration.json 的 pendingApprovalScreens）整屏跳过比对：
// 没人看过的图没有可回归的对象，比它等于把「今天碰巧长这样」钉成「应该长这样」。
// 拍板后删掉登记，CI 那一趟就会把这屏判成「快照缺失」并产出新图，用 design-lab:accept 取回。
const pending = pendingApprovalScreens()
const requestedScreen = process.env.NOMI_DESIGN_LAB_SCREEN

for (const screen of LAB_SCREEN_IDS) {
  if (requestedScreen && screen !== requestedScreen) continue
  if (pending[screen]) continue
  const states = readLabStates(screen)
  // 容差按屏取（见 calibration.json 的 why.perScreenTolerance：大格用比例会宽到放过真实改动）。
  const tolerance = calibration.screens[screen]?.tolerance
  if (!tolerance) throw new Error(`calibration.json 里没有 ${screen} 屏的容差声明`)

  test.describe(`design lab · ${screen}`, () => {
    test('注册表与活页面一致（这把源码正则还活着的唯一证据）', async ({ page }) => {
      if (DIRECTOR_SCREENS.has(screen)) await page.setViewportSize({ width: 1280, height: 933 })
      await page.goto(`/design-lab.html?screen=${screen}&frame=1&state=${states[0].id}`)
      await expect.poll(() => page.evaluate(() => window.__designLabReady === true)).toBe(true)
      const live = await page.evaluate(() => window.__designLabStates)
      expect(live).toEqual(states.map((state) => state.id))
    })

    for (const state of states) {
      test(`状态 ${state.id} · ${state.name}`, async ({ page }, testInfo) => {
        if (DIRECTOR_SCREENS.has(screen)) await page.setViewportSize({ width: 1280, height: 933 })
        if (screen === 'storyboard' && state.id === 'sb-row-06-generating') {
          // Fix only Date: real animation/timers still run, while elapsed narration is deterministic.
          await page.clock.setFixedTime(new Date('2026-09-10T00:00:00Z'))
        }
        if (screen === 'primitives-surfaces' && state.id === 'ps-28-feedback-dialog') {
          // 反馈卡第一行印「这次对话停下了 · 时:分」，取的是当前时间——不固定时钟，这一格每趟都差几十个像素。
          await page.clock.setFixedTime(new Date('2026-09-10T00:00:00Z'))
        }
        const errors = []
        page.on('pageerror', (error) => errors.push(String(error)))
        if (screen === 'process-feedback') {
          await page.clock.install({ time: new Date('2026-09-08T11:59:59Z') })
          await page.clock.pauseAt(new Date('2026-09-08T12:00:00Z'))
          await page.addInitScript(() => {
            let seed = 658
            Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
          })
        }
        await page.goto(`/design-lab.html?screen=${screen}&frame=1&state=${state.id}`)
        await expect.poll(async () => {
          if (screen === 'process-feedback') await page.clock.runFor(32)
          return page.evaluate(() => window.__designLabReady === true)
        }, { intervals: [32] }).toBe(true)
        const shot = page.locator(`[data-design-lab-shot="${state.id}"]`)
        if (state.capture !== 'viewport') await expect(shot).toBeVisible()
        if (screen === 'process-feedback') {
          await page.clock.runFor(state.id === 'pf-fx-final-reveal' ? 400 : state.id === 'pf-fx-done-clean' ? 3201 : 1000)
          // Cross-surface acceptance runs in the real App: process-feedback-electron.e2e.mjs.
          // 导入中的卡没有生成状态药丸（它本来就不是生成）——这两条跨面断言只对生成态成立。
          if (!state.id.startsWith('pf-import') && !state.id.includes('preview') && !['pf-fx-final-reveal', 'pf-fx-done-clean'].includes(state.id)) {
            await expect(page.locator('[data-node-id] [data-generation-status]')).not.toContainText('%')
            await expect(page.locator('[data-process-lab-ready]')).not.toContainText(/前面\s*\d+\s*个/)
          }
        }
        // 格子里的画布节点卡必须以格子内的元素为定位祖先（2026-10-18）：生产里卡在 React Flow 外壳里是 relative；
        // 实验室裸放时会吃到全局的 absolute，去找格子外的祖先、撑出格子，截出来的不是真样子却照样能录成基线
        // （拆解表就这样丢了底栏）。宿主用 src/devlab/designLab/labCanvasViewport.tsx 的 LabCanvasNodeHost。
        if (state.capture !== 'viewport') {
          const escaped = await shot.evaluate((cell) => [...cell.querySelectorAll('.generation-canvas-v2-node')]
            .filter((node) => ['absolute', 'fixed'].includes(getComputedStyle(node).position) && !(node.offsetParent && cell.contains(node.offsetParent)))
            .map((node) => node.getAttribute('data-node-id') || node.getAttribute('data-kind') || 'unknown'))
          expect(escaped, `${state.id}：节点卡按格子外的元素定位，会撑出格子——用 LabCanvasNodeHost 包住`).toEqual([])
        }
        // 浮层类形态走 BodyPortal + fixed 定位，根本不在舞台的子树里——按元素截会截出
        // 「浮层没打开」的假证据，所以这一族改截整屏（注册项里显式声明 capture: 'viewport'）。
        const target = state.capture === 'viewport' ? page : shot
        // 新状态的第一张基线（2026-11-13）：配置写死 updateSnapshots:'none'，这时缺基线只会报
        // 「A snapshot doesn't exist」、不落 -actual.png，CI 产物里没有图可取，新状态就永远拿不到基线
        //（两个界面 PR 因此挂了 4 天）。这里只在基线文件不存在时把这一格存成 design-lab:accept 认的那个
        // 路径；下面的比对照旧判红，基线仍然只能经 accept、由人看过后提交。
        // 动作弹窗右侧是实时 3D 预览：模型异步加载、加载完就一直在动，这一块的像素每趟都不同
        //（加载中 / 不同的动画帧）。这一格钉的是弹窗在最小窗口里的布局，预览区整块遮住不比。
        const mask = screen === 'primitives-surfaces' && state.id === 'ps-33-action-dialog' ? [page.getByRole('dialog').locator('div.bg-nomi-ink')] : undefined
        // 遮罩按预览区的底色类名找：预览容器哪天换了类名，遮罩会悄悄一个都遮不到、这一格重新变得每趟不同——先断言遮得到。
        if (mask) await expect(mask[0], `${state.id}：遮罩没找到预览区`).toHaveCount(1)
        if (!fs.existsSync(testInfo.snapshotPath(screen, `${state.id}.png`))) {
          await target.screenshot({ path: testInfo.outputPath(screen, `${state.id}-actual.png`), animations: 'disabled', caret: 'hide', scale: 'css', mask })
        }
        await expect(target).toHaveScreenshot([screen, `${state.id}.png`], mask ? { ...tolerance, mask } : tolerance)
        expect(errors, `渲染 ${state.id} 时页面抛错`).toEqual([])
      })
    }
  })
}
