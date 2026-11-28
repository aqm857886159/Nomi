import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
// 导出 MP4 顶栏规格外显与忙态原地取消契约（UX-B1 / U-21）—— R13 零额度真机走查。
// 用法: node tests/ux/preview-export-busy.walk.mjs
// 产出: tests/ux/shots/preview-export-busy/*.png（自己 Read 亲眼看）
//
// 钉死五件事，每件都带阳性对照：
//   ① 空闲态：单胶囊可点，可见文字外显「导出 MP4 · 1080p」，同时 aria-label 保持「导出 MP4」，悬停仅一层应用提示带画幅与分辨率。
//   ② 忙态翻面：点导出后同一颗胶囊原地翻面为可点击的「导出中 N% · 取消」（不新增第 2 颗按钮，不 disabled），aria-label 说清阶段、百分比与点击取消。
//   ③ 真实取消：忙态期间点击该胶囊触发真实取消，不重发第二次导出请求，主进程杀掉编码子进程并清理 .partial.mp4（exports 目录 0 产出），不弹红报错。
//   ④ 恢复与重导：取消完成后立即恢复空闲「导出 MP4 · 1080p」，再次点击完整导出成功产出 1 个非空 MP4。
//   ⑤ 进度条渲染阶段文案，且带 role=progressbar 的 aria-valuenow。
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/preview-export-busy')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = makeTempDir('nomi-export-busy-')
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const PROJECT_ID = 'export-busy'
const PROJECT_NAME = '导出忙态验收项目'
const VIDEO_NAME = 'export-busy-source.mp4'
const FPS = 30
const CLIP_FRAMES = 450 // 15 秒 1080p 动态测试源：足够让真 ffmpeg 编码窗口稳定供点击取消与二次完整导出

function encodeVideo(output) {
  const run = spawnSync(ffmpegPath, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=15:r=30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { timeout: 180_000 })
  if (run.status !== 0) throw new Error(`夹具编码失败: ${run.stderr?.toString().slice(-500)}`)
}

function seedProject() {
  const projectRoot = path.join(projectsDir, PROJECT_ID)
  const importedDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(importedDir, { recursive: true })
  encodeVideo(path.join(importedDir, VIDEO_NAME))
  const url = `nomi-local://asset/${encodeURIComponent(PROJECT_ID)}/assets/imported/${encodeURIComponent(VIDEO_NAME)}`
  const nodeId = `${PROJECT_ID}-source`
  const generationCanvas = {
    nodes: [
      {
        id: nodeId,
        kind: 'asset',
        categoryId: 'assets',
        title: '导出夹具',
        position: { x: 120, y: 120 },
        status: 'success',
        meta: { source: 'local-drop', fileName: VIDEO_NAME, uploadStatus: 'uploaded' },
        result: { id: `${nodeId}-result`, type: 'video', url, createdAt: 1 },
      },
    ],
    edges: [],
    selectedNodeIds: [],
    groups: [],
    canvasZoom: 1,
    canvasPan: { x: 0, y: 0 },
  }
  const timeline = {
    version: 1,
    fps: FPS,
    scale: 4,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: 'Image', clips: [] },
      {
        id: 'videoTrack',
        type: 'video',
        label: 'Video',
        clips: [
          {
            id: `${PROJECT_ID}-clip`,
            type: 'video',
            sourceNodeId: nodeId,
            label: '导出夹具',
            startFrame: 0,
            endFrame: CLIP_FRAMES,
            frameCount: CLIP_FRAMES,
            offsetStartFrame: 0,
            offsetEndFrame: CLIP_FRAMES,
            url,
          },
        ],
      },
      { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
    ],
    textClips: [],
    transitions: [],
  }
  const payload = {
    workbenchDocument: null,
    timeline,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const record = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    version: 2,
    createdAt: 1,
    updatedAt: 1,
    savedAt: 1,
    revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null,
    timeline,
    generationCanvas,
    payload,
  }
  const serialized = JSON.stringify(record, null, 2)
  fs.writeFileSync(path.join(projectRoot, 'project.json'), serialized)
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), serialized)
  return projectRoot
}

const projectRoot = seedProject()

const evidence = []
const check = (ok, message, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${message}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${message}${detail ? ` — ${detail}` : ''}`)
  evidence.push(message)
}

const EXPORT_BUTTON = '[data-export-busy]'

function listExportEntries() {
  const dir = path.join(projectRoot, 'exports')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
}

function countFinalMp4Exports() {
  return listExportEntries().filter((name) => name.endsWith('.mp4') && !name.endsWith('.partial.mp4')).length
}

function countPartialMp4Exports() {
  return listExportEntries().filter((name) => name.includes('.partial')).length
}

let app = null
try {
  const launched = await launchNomiApp({
    name: 'preview-export-busy',
    settingsDir,
    userDataDir,
    projectsDir,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: {
      'nomi:locale:v1': 'zh-CN',
      'nomi-color-scheme': 'light',
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
    },
    args: ['--disable-gpu', '--no-proxy-server'],
    settleMs: 1500,
  })
  app = launched.app
  const win = launched.win

  await win.waitForFunction(
    () => document.querySelectorAll('[data-project-card="true"]').length > 0,
    undefined,
    { timeout: 30_000 },
  )

  const card = win.locator('[data-project-card="true"]').filter({ hasText: PROJECT_NAME }).first()
  await expectVisible(card, '夹具项目卡出现')
  await card.click()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 20_000 })
  await win.waitForFunction(
    () => Boolean(document.querySelector('nav.nomi-stepper')),
    undefined,
    { timeout: 30_000 },
  )
  const resume = win.getByRole('button', { name: /继续创作/ }).first()
  if (await resume.isVisible().catch(() => false)) {
    await resume.click()
    await win.waitForFunction(
      () => ![...document.querySelectorAll('button')].some((el) => /继续创作/.test(el.textContent ?? '')),
      undefined,
      { timeout: 30_000 },
    )
  }

  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await expectVisible(previewTab, '预览页 tab 出现')
  await previewTab.click()
  await win.waitForFunction(
    () => document.querySelector('nav.nomi-stepper [data-mode="preview"]')?.getAttribute('aria-current') === 'page'
      && Boolean(document.querySelector('.workbench-preview-player__stage')),
    undefined,
    { timeout: 30_000 },
  )

  const exportButton = win.locator(EXPORT_BUTTON).first()
  await expectVisible(exportButton, '顶栏「导出 MP4」按钮出现')

  // ── ① 阳性对照：空闲态外显「导出 MP4 · 1080p」，同时 aria-label 保持「导出 MP4」 ─────────────
  const idleState = await exportButton.evaluate((el) => ({
    count: document.querySelectorAll('[data-shell-topbar] [data-shell-export]').length,
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    title: el.closest('span[title]')?.getAttribute('title') ?? null,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim(),
  }))
  check(
    idleState.count === 1 && idleState.busy === 'false' && !idleState.disabled,
    '阳性对照：顶栏仅单颗导出胶囊且空闲可点',
    JSON.stringify(idleState),
  )
  check(
    idleState.title === null && idleState.label === '导出 MP4' && idleState.text === '导出 MP4 · 1080p',
    '阳性对照：空闲可见文字显示「导出 MP4 · 1080p」，aria-label 保持「导出 MP4」零破坏，无原生 title',
    JSON.stringify(idleState),
  )
  await exportButton.hover()
  const tooltip = win.getByRole('tooltip')
  await expectVisible(tooltip, '悬停只显示应用 Tooltip')
  check((await tooltip.textContent())?.includes('16:9 · 1080p'), '空闲提示带导出画幅和分辨率')
  await win.mouse.move(0, 100)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-idle-enabled.png') })

  // ── 全程采样：记录导出请求数、取消请求数与忙态帧 ─────────────────────────────────────────────
  await win.evaluate((selector) => {
    window.__nomiExportSamples = []
    window.__nomiExportRequests = 0
    window.__nomiExportCancelRequests = 0
    window.addEventListener('nomi-preview-export', () => { window.__nomiExportRequests += 1 })
    window.addEventListener('nomi-preview-export-cancel', () => { window.__nomiExportCancelRequests += 1 })
    const snapshot = () => {
      const el = document.querySelector(selector)
      if (!el) return
      const bar = document.querySelector('[role="progressbar"][aria-valuenow]')
      window.__nomiExportSamples.push({
        at: Date.now(),
        pillCount: document.querySelectorAll('[data-shell-topbar] [data-shell-export]').length,
        busy: el.dataset.exportBusy,
        cancelling: el.dataset.exportCancelling ?? 'false',
        disabled: el.disabled === true,
        ariaBusy: el.getAttribute('aria-busy'),
        title: el.closest('span[title]')?.getAttribute('title') ?? null,
        label: el.getAttribute('aria-label'),
        text: el.textContent?.trim() ?? '',
        hasSpinMark: Boolean(el.querySelector('svg.animate-spin')) && el.dataset.exportBusy === 'true',
        progressNow: bar?.getAttribute('aria-valuenow') ?? null,
        progressText: bar?.getAttribute('aria-valuetext') ?? null,
        stageText: document.querySelector('.workbench-preview-player__export-progress span')?.textContent?.trim() ?? null,
      })
    }
    snapshot()
    const observer = new MutationObserver(snapshot)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    window.__nomiExportObserver = observer
  }, EXPORT_BUTTON)

  const exportsBefore = countFinalMp4Exports()

  // ── ② 第一次点击导出 → 原地翻面为可点击的「导出中 …% · 取消」 → 点击真实取消 ───────────────────
  await exportButton.click()
  await win.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector)
      return el?.dataset.exportBusy === 'true' && /导出中 \d+% · 取消/.test(el.textContent ?? '')
    },
    EXPORT_BUTTON,
    { timeout: 30_000 },
  )

  const busyBeforeCancel = await exportButton.evaluate((el) => ({
    pillCount: document.querySelectorAll('[data-shell-topbar] [data-shell-export]').length,
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim(),
    hasSpinMark: Boolean(el.querySelector('svg.animate-spin')),
  }))
  await win.screenshot({ path: path.join(shotsDir, '02-busy-cancellable.png') })

  check(
    busyBeforeCancel.pillCount === 1 && busyBeforeCancel.busy === 'true' && !busyBeforeCancel.disabled && busyBeforeCancel.hasSpinMark,
    '②忙态单胶囊原地翻面可点击（不新增第 2 颗按钮、不 disabled、带旋转加载图标）',
    JSON.stringify(busyBeforeCancel),
  )
  check(
    /导出中 \d+% · 取消/.test(busyBeforeCancel.text ?? '') && /正在导出（.+ · \d+%）· 点击取消导出/.test(busyBeforeCancel.label ?? ''),
    '②忙态可见文字为「导出中 N% · 取消」，无障碍说明含真实阶段与点击取消提示',
    JSON.stringify(busyBeforeCancel),
  )

  const cancelClickStartedAt = Date.now()
  await exportButton.click()

  await win.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.exportBusy === 'false',
    EXPORT_BUTTON,
    { timeout: 30_000 },
  )
  const cancelSettledMs = Date.now() - cancelClickStartedAt
  // 短暂稳定窗口确认被杀进程绝不补写文件
  await win.waitForTimeout(300)

  const afterCancel = await win.evaluate((selector) => {
    const el = document.querySelector(selector)
    return {
      busy: el?.dataset.exportBusy,
      disabled: el?.disabled === true,
      label: el?.getAttribute('aria-label'),
      text: el?.textContent?.trim(),
      exportRequests: window.__nomiExportRequests,
      cancelRequests: window.__nomiExportCancelRequests,
      errorBanner: document.querySelector('[data-preview-export-error]')?.textContent ?? null,
    }
  }, EXPORT_BUTTON)

  check(
    afterCancel.exportRequests === 1 && afterCancel.cancelRequests === 1,
    '③忙态点击胶囊只发取消请求，不重发第二次导出请求',
    JSON.stringify(afterCancel),
  )
  check(
    countFinalMp4Exports() === exportsBefore && countPartialMp4Exports() === 0,
    '③真实中止子进程并清理半截文件：取消后 exports 目录 0 新增成片、0 残留 .partial.mp4',
    `entries=${JSON.stringify(listExportEntries())} settleMs=${cancelSettledMs}`,
  )
  check(
    afterCancel.busy === 'false' && !afterCancel.disabled && afterCancel.label === '导出 MP4'
      && afterCancel.text === '导出 MP4 · 1080p' && afterCancel.errorBanner === null,
    '③取消完成后干净回到空闲「导出 MP4 · 1080p」，不弹红报错条',
    JSON.stringify(afterCancel),
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '03-cancelled-back-to-idle.png') })

  // ── ④ 取消后再次点击导出 → 正常完整跑完并产出有效 MP4 ───────────────────────────────────────
  await exportButton.click()
  await win.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.exportBusy === 'true',
    EXPORT_BUTTON,
    { timeout: 30_000 },
  )
  await win.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.exportBusy === 'false',
    EXPORT_BUTTON,
    { timeout: 240_000 },
  )
  const deadline = Date.now() + 60_000
  while (countFinalMp4Exports() <= exportsBefore && Date.now() < deadline) {
    await win.waitForTimeout(300)
  }

  const { samples, exportRequests, cancelRequests } = await win.evaluate(() => {
    window.__nomiExportObserver?.disconnect()
    return {
      samples: window.__nomiExportSamples ?? [],
      exportRequests: window.__nomiExportRequests,
      cancelRequests: window.__nomiExportCancelRequests,
    }
  })
  fs.writeFileSync(path.join(shotsDir, 'busy-samples.json'), JSON.stringify(samples, null, 2))
  const busySamples = samples.filter((sample) => sample.busy === 'true')

  check(
    exportRequests === 2 && cancelRequests === 1 && countFinalMp4Exports() === exportsBefore + 1 && countPartialMp4Exports() === 0,
    '④取消后二次导出完整成功：产出一个非空 MP4 且无 .partial 残留',
    `exports=${JSON.stringify(listExportEntries())}`,
  )
  const mp4Name = listExportEntries().find((name) => name.endsWith('.mp4'))
  const mp4Size = mp4Name ? fs.statSync(path.join(projectRoot, 'exports', mp4Name)).size : 0
  check(mp4Size > 0, '④二次导出的 MP4 文件字节数 > 0', `${mp4Name} (${mp4Size} bytes)`)

  const stages = [...new Set(busySamples.map((s) => (s.label ?? '').match(/（(.+?) ·/)?.[1]).filter(Boolean))]
  check(
    stages.length > 0 && stages.every((stage) => ['准备素材', '录制画面', '转码封装'].includes(stage)),
    '⑤忙态说明带真实阶段名（准备素材 / 录制画面 / 转码封装）',
    JSON.stringify(stages),
  )
  const withProgress = busySamples.filter((sample) => sample.progressNow !== null)
  check(
    withProgress.length > 0 && withProgress.every((sample) => Number.isFinite(Number(sample.progressNow)))
      && withProgress.some((sample) => /准备素材|录制画面|转码封装/.test(sample.stageText ?? '')),
    '⑤进度条带 role=progressbar 的 aria-valuenow 与阶段文案',
    JSON.stringify(withProgress[0] ?? null),
  )

  const idleAfterSecond = await exportButton.evaluate((el) => ({
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim(),
  }))
  check(
    idleAfterSecond.busy === 'false' && !idleAfterSecond.disabled
      && idleAfterSecond.label === '导出 MP4' && idleAfterSecond.text === '导出 MP4 · 1080p',
    '④二次导出结束后按钮恢复「导出 MP4 · 1080p」可点态',
    JSON.stringify(idleAfterSecond),
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '04-second-export-complete.png') })

  console.log(`\n证据 ${evidence.length} 条，取消收尾耗时 ${cancelSettledMs}ms，截图在 ${shotsDir}`)
} finally {
  if (app) await app.close().catch(() => {})
  cleanupTestTemp(tempRoot)
}
