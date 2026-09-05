// 设计实验室视觉基线的 Playwright 配置。
//
// 用现役标准件（`toHaveScreenshot`）而不是自写像素 diff：稳定性等待（连续两帧一致才比）、
// 容差语义（YIQ 感知色差 + 差异像素比）、差异图产出（-expected/-actual/-diff）都是它自带的，
// 自写一份等于重造一个更差的轮子（R20）。
//
// 只跑视觉道；结构/覆盖检查在 `scripts/check-design-lab.mjs` 里，不需要浏览器。
import { defineConfig } from '@playwright/test'
import { readCalibration } from './labStates.mjs'

const calibration = readCalibration()

export const LAB_PORT = 5197
export const LAB_ORIGIN = `http://127.0.0.1:${LAB_PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.visual\.spec\.mjs$/,
  // 基线路径：tests/ux/design-lab/__baselines__/agent-panel/<id>.png。
  // `agent-panel/` 这一层写在模板里而不是 toHaveScreenshot 的 name 里——name 里的 `/`
  // 会被 Playwright 的文件名消毒换成 `-`，出来是 `agent-panel-<id>.png`（扁平），不是目录。
  // 刻意不带 {platform}/{projectName} 后缀——只维护一套（darwin）基线，别的平台由
  // check-design-lab.mjs 按 calibration.json 判定「不跑视觉道」，而不是让 Playwright
  // 去找一份根本不存在的 linux 基线然后报「snapshot missing」（那是假红，看不出真因）。
  snapshotPathTemplate: '{testDir}/__baselines__/agent-panel/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // 基线只在用户拍板后更新（pnpm run design-lab:update）；CI 上永远不许自己写基线。
  updateSnapshots: process.env.NOMI_DESIGN_LAB_UPDATE === '1' ? 'all' : 'none',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: calibration.tolerance.threshold,
      maxDiffPixelRatio: calibration.tolerance.maxDiffPixelRatio,
    },
  },
  use: {
    baseURL: LAB_ORIGIN,
    viewport: { width: calibration.viewport.width, height: calibration.viewport.height },
    deviceScaleFactor: calibration.viewport.deviceScaleFactor,
    colorScheme: calibration.colorScheme,
  },
  webServer: {
    // Tailwind 产物是 dev server 中间件从 public/ 读的，不先生成就整页无样式——
    // 那会渲染出一套「所有 token 都不在」的基线，比红更糟。
    command: `node scripts/build-tailwind.mjs && npx vite --host 127.0.0.1 --port ${LAB_PORT} --strictPort`,
    cwd: '../../..',
    url: `${LAB_ORIGIN}/design-lab.html?screen=agent-panel&frame=1`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
