// 视觉基线跑之前的**预热 + 归属断言**（Playwright globalSetup）。
//
// 为什么需要预热：`webServer.url` 只探到「`design-lab.html` 这个静态文件能取到了」就放行，
// 而那时候 vite 一个模块都还没转译过。第一次真正加载页面才会触发 esbuild 预打包依赖 +
// 转译上千个模块 + 拉 @fontsource 字体；预打包一旦发现新依赖还会让页面**整页 reload**。
// 结果是头几条用例撞上这段窗口：轻则 30 秒等不到 `__designLabReady` 超时，
// 重则在 reload 的半渲染帧上截了图，比出一张「内容只剩一行」的假红
// （2026-09-06 实测：冷跑头 5 条超时；第二趟 48s 里 3 条比出半渲染帧；服务器热了以后 46 条 21s 全绿）。
//
// 所以预热在这里做一次，而不是把每条用例的 timeout 调大——调大只是把窗口拉宽，
// 半渲染帧那种假红照样能发生；等到「页面真的就绪过一次」才是把窗口关掉。
//
// 为什么归属断言也在这里：这是整趟跑里**第一个碰到服务器的地方**，也是像素被信任之前的最后一道。
// `design-lab:update` 与手工 `npx playwright test` 都不经过门岗脚本，但都经过 globalSetup——
// 断言放这儿，三条入口一次覆盖（labServer.mjs 是那条不变量的 owner）。
import { chromium } from '@playwright/test'
import { LAB_ORIGIN } from './playwright.config.mjs'
import { assertLabPortOwnership } from './labServer.mjs'

export default async function warmUp() {
  // foreign 直接抛：在别人的服务器上截图 = 拿别的分支的 UI 当自己的基线。
  assertLabPortOwnership('visual')

  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    // 预热本身给足时间：这一次要等 vite 冷启动转译完整张模块图。
    await page.goto(`${LAB_ORIGIN}/design-lab.html?screen=agent-panel&frame=1`, { timeout: 180_000 })
    await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: 180_000 })
    // 字体是 @fontsource 按 CSS 拉的，`__designLabReady` 那面旗不等它。
    // 字体没落地时文字按 fallback 字形排版，行高与折行都不一样——基线会比在字体上，不是设计上。
    await page.evaluate(() => document.fonts.ready)
  } catch (error) {
    // 机器标记：预热挂掉时 Playwright 的 globalSetup 报错排版将来可能变，
    // 但门岗的分诊（failureTriage.mjs 的 warmup-unreachable 签名）认的是这一行，不认排版。
    console.error(`NOMI_LAB_WARMUP_UNREACHABLE ${LAB_ORIGIN} —— 预热阶段就没能加载实验室页面`)
    throw error
  } finally {
    await browser.close()
  }
}
