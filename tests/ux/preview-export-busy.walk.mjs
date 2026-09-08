// 导出 MP4 忙态契约（设计系统 §1.6 C1）—— R13 零额度真机走查。
// 用法: node tests/ux/preview-export-busy.walk.mjs
// 产出: tests/ux/shots/preview-export-busy/*.png（自己 Read 亲眼看）
//
// 背景（2026-09-07 体检 P0 第一条）：顶栏「导出 MP4」既不 disabled、也没有 loading、也没有 title，
// 而导出的忙态 `exportBusy` 住在跨组件的 TimelinePreview 里，按钮根本拿不到。
// 于是点第二次被 `if (exportBusy) return` **静默吞掉**——正是 §1.6 C1 举的那个原型
// （「显示」下拉 if 短路、界面不解释）的同构复发。
//
// 这条走查钉死四件事，每件都带阳性对照（先证明空闲态是另一副样子，断言才不恒真）：
//   ① 阳性对照：空闲时按钮**可点**、title 是「导出 MP4」、无 loading。
//   ② 点下去后按钮变 disabled，并且 title / aria-label 说清「为什么现在点不了」（阶段 + 百分比）。
//   ③ 忙态期间再点无害：在观察者里原子地真点第二下，一次导出请求都没多发，且全程只产出一个 MP4。
//   ④ 进度条渲染阶段文案，且带 role=progressbar 的 aria-valuenow。
// 忙态用 MutationObserver 全程采样（不是事后瞄一眼），短窗口也抓得到。
// 导出走生产路径的真 ffmpeg，素材是本地编码的真 MP4，零额度、零网络。
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/preview-export-busy')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-export-busy-'))
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const PROJECT_ID = 'export-busy'
const PROJECT_NAME = '导出忙态验收项目'
const VIDEO_NAME = 'export-busy-source.mp4'
const FPS = 30
const CLIP_FRAMES = 240 // 8 秒：足够让 preparing/recording/converting 三态各自可观测

function encodeVideo(output) {
  const filter = [
    'color=c=0x24405C:s=1280x720:d=8:r=30',
    'drawbox=x=120:y=110:w=420:h=500:color=white:t=fill',
    'drawbox=x=640:y=180:w=480:h=160:color=0xF2C14E:t=fill',
  ].join(',')
  const run = spawnSync(ffmpegPath, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', filter,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
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

function countExports() {
  const dir = path.join(projectRoot, 'exports')
  if (!fs.existsSync(dir)) return 0
  return fs.readdirSync(dir).filter((name) => name.endsWith('.mp4')).length
}

let app = null
try {
  const launched = await launchNomiApp({
    name: 'preview-export-busy',
    settingsDir,
    userDataDir,
    projectsDir,
    args: ['--disable-gpu', '--no-proxy-server'],
    settleMs: 1800,
  })
  app = launched.app
  const win = launched.win
  const browserWindow = await app.browserWindow(win)
  // ≥1600px 才显示按钮文字（顶栏 max-[1600px] 收成纯图标）——走查要让人眼看得见「导出中 N%」。
  await browserWindow.evaluate((ref) => ref.setBounds({ x: 0, y: 0, width: 1800, height: 1000 }))

  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  // 真信号：项目库列表渲染出来了（不是「睡够 2 秒大概好了」）。
  await win.waitForFunction(
    () => document.querySelectorAll('[data-project-card="true"]').length > 0,
    undefined,
    { timeout: 30_000 },
  )

  const card = win.locator('[data-project-card="true"]').filter({ hasText: PROJECT_NAME }).first()
  await expectVisible(card, '夹具项目卡出现')
  await card.dblclick()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 20_000 })
  // 真信号：工作区外壳（顶栏 + 阶段导航）挂上了。
  await win.waitForFunction(
    () => Boolean(document.querySelector('nav.nomi-stepper')),
    undefined,
    { timeout: 30_000 },
  )
  const resume = win.getByRole('button', { name: /继续创作/ }).first()
  if (await resume.isVisible().catch(() => false)) {
    await resume.click()
    // 真信号：恢复卡消失。
    await win.waitForFunction(
      () => ![...document.querySelectorAll('button')].some((el) => /继续创作/.test(el.textContent ?? '')),
      undefined,
      { timeout: 30_000 },
    )
  }

  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await expectVisible(previewTab, '预览页 tab 出现')
  await previewTab.click()
  // 真信号：预览页 tab 变成当前页，且预览舞台挂上了。
  await win.waitForFunction(
    () => document.querySelector('nav.nomi-stepper [data-mode="preview"]')?.getAttribute('aria-current') === 'page'
      && Boolean(document.querySelector('.workbench-preview-player__stage')),
    undefined,
    { timeout: 30_000 },
  )

  const exportButton = win.locator(EXPORT_BUTTON).first()
  await expectVisible(exportButton, '顶栏「导出 MP4」按钮出现')

  // ── ① 阳性对照：空闲时它就该是可点的、没有忙态说明 ─────────────────────────────
  const idleState = await exportButton.evaluate((el) => ({
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    title: el.closest('span[title]')?.getAttribute('title') ?? null,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim(),
  }))
  check(
    idleState.busy === 'false' && !idleState.disabled,
    '阳性对照：空闲时按钮可点（证明下面的 disabled 断言不恒真）',
    JSON.stringify(idleState),
  )
  check(
    idleState.title === '导出 MP4' && idleState.label === '导出 MP4',
    '阳性对照：空闲时 title / aria-label 都只是「导出 MP4」，不带忙态说明',
    JSON.stringify(idleState),
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '01-idle-enabled.png') })

  // ── 全程采样：忙态窗口可能很短，事后瞄一眼会漏 ─────────────────────────────────
  await win.evaluate((selector) => {
    window.__nomiExportSamples = []
    // 导出请求计数：顶栏按钮点一下就是往 window 发一次 PREVIEW_EXPORT_EVENT。
    // ③ 用它证明「忙态期间再点」根本没有产生第二次请求（不是产生了然后被 if 吞掉）。
    window.__nomiExportRequests = 0
    window.addEventListener('nomi-preview-export', () => { window.__nomiExportRequests += 1 })
    window.__nomiSecondClick = null
    const snapshot = () => {
      const el = document.querySelector(selector)
      if (!el) return
      const bar = document.querySelector('[role="progressbar"][aria-valuenow]')
      // 忙态窗口只有几百毫秒，第二次点击必须在观察者里**原子地**做掉：
      // 先记下此刻的 disabled 与请求数，立刻真点一次，再记请求数。中间没有任何异步缝隙。
      if (el.dataset.exportBusy === 'true' && !window.__nomiSecondClick) {
        const before = window.__nomiExportRequests
        const wasDisabled = el.disabled === true
        el.click()
        window.__nomiSecondClick = { wasDisabled, before, after: window.__nomiExportRequests }
      }
      window.__nomiExportSamples.push({
        at: Date.now(),
        busy: el.dataset.exportBusy,
        disabled: el.disabled === true,
        ariaBusy: el.getAttribute('aria-busy'),
        title: el.closest('span[title]')?.getAttribute('title') ?? null,
        label: el.getAttribute('aria-label'),
        text: el.textContent?.trim() ?? '',
        hasLoadingMark: Boolean(el.querySelector('svg, [data-nomi-loading-mark]')) && el.dataset.exportBusy === 'true',
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

  const exportsBefore = countExports()
  await exportButton.click()

  await win.waitForFunction(
    () => (window.__nomiExportSamples ?? []).some((sample) => sample.busy === 'true'),
    undefined,
    { timeout: 30_000 },
  )

  // ── ②③④ 忙态取证 ─────────────────────────────────────────────────────────────
  const busyNow = await exportButton.evaluate((el) => ({
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true,
    title: el.closest('span[title]')?.getAttribute('title') ?? null,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim(),
  }))
  await screenshotSettled(win, { path: path.join(shotsDir, '02-busy-disabled.png') })

  // 等按钮**真的**回到空闲：ffmpeg 会边转码边写文件，所以「exports 目录里出现 mp4」不等于导出结束。
  await win.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.exportBusy === 'false',
    EXPORT_BUTTON,
    { timeout: 240_000 },
  )
  const deadline = Date.now() + 60_000
  while (countExports() <= exportsBefore && Date.now() < deadline) {
    await win.waitForTimeout(500)
  }
  // 让「再点一下会不会多出一个文件」有机会暴露：短轮询看计数是否稳定，不用长 sleep 当信号。
  for (let i = 0; i < 4; i += 1) await win.waitForTimeout(400)

  const { samples, secondClick } = await win.evaluate(() => {
    window.__nomiExportObserver?.disconnect()
    return { samples: window.__nomiExportSamples ?? [], secondClick: window.__nomiSecondClick }
  })
  fs.writeFileSync(path.join(shotsDir, 'busy-samples.json'), JSON.stringify(samples, null, 2))
  const busySamples = samples.filter((sample) => sample.busy === 'true')

  check(busySamples.length > 0, '采到了真实忙态窗口', `samples=${samples.length} busy=${busySamples.length}`)
  check(
    busySamples.every((sample) => sample.disabled === true),
    '②忙态期间按钮始终 disabled（不再假装可点）',
    JSON.stringify(busySamples[0]),
  )
  check(
    busySamples.every((sample) => /正在导出/.test(sample.title ?? '') && /完成后才能再点/.test(sample.title ?? '')),
    '②禁用的同时说清「为什么现在点不了」（§1.6 C1 的 title 出口）',
    busySamples[0]?.title ?? 'null',
  )
  const stages = [...new Set(busySamples.map((s) => (s.title ?? '').match(/（(.+?) ·/)?.[1]).filter(Boolean))]
  check(
    stages.length > 0 && stages.every((stage) => ['准备素材', '录制画面', '转码封装'].includes(stage)),
    '②忙态说明里带的是真实阶段名（不是笼统的「处理中」）',
    JSON.stringify(stages),
  )
  check(
    busySamples.some((sample) => /导出中 \d+%/.test(sample.text ?? '')) &&
      busySamples.every((sample) => sample.ariaBusy === 'true'),
    '②按钮自身有 loading 表现（文案换成「导出中 N%」+ aria-busy）',
    busySamples.find((s) => /导出中/.test(s.text ?? ''))?.text ?? 'none',
  )
  check(
    Boolean(secondClick) && secondClick.wasDisabled === true && secondClick.after === secondClick.before,
    '③忙态期间真点第二下：按钮自己挡住，一次导出请求都没多发（不再靠 if 短路静默吞掉）',
    JSON.stringify(secondClick),
  )
  check(
    countExports() === exportsBefore + 1,
    '③再点无害：全程只产出一个 MP4',
    `before=${exportsBefore} after=${countExports()}`,
  )
  const withProgress = busySamples.filter((sample) => sample.progressNow !== null)
  check(
    withProgress.length > 0 &&
      withProgress.every((sample) => Number.isFinite(Number(sample.progressNow))),
    '④进度条带 role=progressbar 的 aria-valuenow',
    JSON.stringify(withProgress[0] ?? null),
  )
  check(
    withProgress.some((sample) => /准备素材|录制画面|转码封装/.test(sample.stageText ?? '')),
    '④进度条上方渲染出阶段文案（三态此前算出来了却从没显示）',
    withProgress.map((s) => s.stageText).find(Boolean) ?? 'none',
  )

  const idleAfter = await exportButton.evaluate((el) => ({
    busy: el.dataset.exportBusy,
    disabled: el.disabled === true,
    title: el.closest('span[title]')?.getAttribute('title') ?? null,
  }))
  check(
    idleAfter.busy === 'false' && !idleAfter.disabled && idleAfter.title === '导出 MP4',
    '导出结束后按钮恢复可点（忙态不会卡死）',
    JSON.stringify(idleAfter),
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '03-idle-again.png') })

  console.log(`\n证据 ${evidence.length} 条，截图在 ${shotsDir}`)
  console.log(`  busyNow=${JSON.stringify(busyNow)}`)
} finally {
  if (app) await app.close().catch(() => {})
}
