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
  // 冷启动的 vite 会在头几条用例中间做完预打包并整页 reload，撞上去要么等不到就绪旗、
  // 要么在半渲染帧上截图比出假红。预热跑一次真实加载，把那段窗口关掉（见 warmUp.mjs）。
  globalSetup: './warmUp.mjs',
  testMatch: /.*\.visual\.spec\.mjs$/,
  // 基线路径：tests/ux/design-lab/__baselines__/<屏>/<id>.png。
  // 屏这一层由 `toHaveScreenshot([screen, id + '.png'])` 的**数组形式**给出——数组的每一项是一段
  // 路径，才会真的落成目录；写成 `toHaveScreenshot('agent-panel/x.png')` 里的 `/` 会被
  // Playwright 的文件名消毒换成 `-`，出来是扁平的 `agent-panel-x.png`。
  // 刻意不带 {platform}/{projectName} 后缀——只维护一套（darwin）基线，别的平台由
  // check-design-lab.mjs 按 calibration.json 判定「不跑视觉道」，而不是让 Playwright
  // 去找一份根本不存在的 linux 基线然后报「snapshot missing」（那是假红，看不出真因）。
  snapshotPathTemplate: '{testDir}/__baselines__/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // 基线只在用户拍板后更新（pnpm run design-lab:update）；CI 上永远不许自己写基线。
  updateSnapshots: process.env.NOMI_DESIGN_LAB_UPDATE === '1' ? 'all' : 'none',
  // 容差**按屏**给（calibration.json 的 screens.<屏>.tolerance），由 spec 在每次
  // toHaveScreenshot 上显式传——一格 340×620 与一格 900×1268 差 5 倍面积，同一个"差异像素比"
  // 在大格上宽到能放过一整行控件改色（2026-09-06 实测：113 像素的真实改动在旧比例下是绿的）。
  // 这里只留与容差无关的公共项。
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
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
