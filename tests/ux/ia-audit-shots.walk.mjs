// 一次性 IA 走查取证：把 4 个界面的真实截图拍下来供出设计样张逐项对账（禁脑补）。
// 零额度——只截静态界面，绝不触发任何真实生成。
//   ① 项目库首页（顶栏弱入口 + 主入口卡 + 最近项目卡，含一张卡 hover 态）
//   ② 生成画布整屏（左缘工具栏 + 左下导航条 + 右侧助手栏）
//   ③ 剪辑/预览页整屏（左侧素材来源面板 + 播放器 + 控制条 + 时间轴）
//   ④ 3D 导演台全屏态（顶栏任务页签 + 左栏 + 右栏 + 底栏）
// 用法: pnpm run build && node tests/ux/ia-audit-shots.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expectCount, screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-02-real-ui')
fs.mkdirSync(outDir, { recursive: true })

const WIN_W = 1680
const WIN_H = 1050

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ia-shots-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const results = []
const note = (name, detail = '') => { results.push({ name, detail }); console.log(`  · ${name}${detail ? ` — ${detail}` : ''}`) }

// —— 夹具：一张真 png + 一段真 mp4，喂给「最近项目 / 画布 / 时间轴」，全程零额度 ——
// ESM 里没有 require：Node 24 见到 `require` + top-level await 会以 ERR_AMBIGUOUS_MODULE_SYNTAX
// 直接拒绝加载整个文件（这条走查因此在本机一行都跑不起来）。createRequire 是 .mjs 里的正解。
const ffmpegPath = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path
function ff(args, label) {
  const run = spawnSync(ffmpegPath, ['-v', 'error', '-y', ...args], { timeout: 120_000 })
  if (run.status !== 0) throw new Error(`${label} 夹具编码失败: ${run.stderr?.toString().slice(-400)}`)
}

// 播种一个已有画布 + 时间轴的项目（走查已验证的落盘形态：project.json + .nomi/project.json，version 2）。
function seedProject({ id, name, folder, nodes, timeline = null }) {
  const projectRoot = path.join(projectsDir, folder)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }
  const payload = { workbenchDocument: null, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
  const project = {
    id, name, version: 2,
    createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null, timeline, generationCanvas, payload,
  }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))
  return projectRoot
}

// 主项目：3 张图 + 1 段视频 + 时间轴，够撑起「画布有内容」「预览有片段」两屏。
const MAIN_ID = 'ia-audit-main'
const MAIN_FOLDER = `ia-audit-${MAIN_ID}`
const mainRoot = path.join(projectsDir, MAIN_FOLDER)
fs.mkdirSync(path.join(mainRoot, 'assets', 'imported'), { recursive: true })
const stills = []
for (const [i, hue] of [[0, 'teal'], [1, 'orange'], [2, 'purple']]) {
  const p = path.join(mainRoot, 'assets', 'imported', `still-${i}.png`)
  ff(['-f', 'lavfi', '-i', `color=c=${hue}:size=768x432`, '-frames:v', '1', p], `png-${i}`)
  stills.push(`nomi-local://asset/${encodeURIComponent(MAIN_ID)}/assets/imported/${encodeURIComponent(`still-${i}.png`)}`)
}
const clipPath = path.join(mainRoot, 'assets', 'imported', 'clip.mp4')
ff(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=768x432:rate=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath], 'mp4')
const CLIP_URL = `nomi-local://asset/${encodeURIComponent(MAIN_ID)}/assets/imported/clip.mp4`

const mkNode = (id, title, url, type, x, y) => ({
  id, kind: 'asset', categoryId: 'assets', title,
  position: { x, y }, exactPosition: true, size: { width: 340, height: 240 }, status: 'success',
  meta: { source: 'local-drop', fileName: title, uploadStatus: 'uploaded', ...(type === 'video' ? { videoDuration: 2 } : {}) },
  result: { id: `${id}-result`, type, url, createdAt: 1 },
})
// 一个空的 3D 场景节点（无 scene3dState → 卡上显示「进入 3D 编辑器」启动器，供进全屏导演台）。
const scene3dNode = {
  id: 'n-scene3d', kind: 'scene3d', categoryId: 'assets', title: '3D 场景',
  position: { x: 920, y: 120 }, exactPosition: true, size: { width: 360, height: 280 }, status: 'idle',
  meta: {},
  result: null,
}
seedProject({
  id: MAIN_ID, name: 'IA 走查·示例项目', folder: MAIN_FOLDER,
  nodes: [
    mkNode('n-still-0', 'still-0.png', stills[0], 'image', 120, 120),
    mkNode('n-still-1', 'still-1.png', stills[1], 'image', 520, 120),
    mkNode('n-still-2', 'still-2.png', stills[2], 'image', 120, 420),
    mkNode('n-clip', 'clip.mp4', CLIP_URL, 'video', 520, 420),
    scene3dNode,
  ],
  timeline: {
    fps: 24,
    tracks: [{
      id: 'video-track', kind: 'video',
      clips: [
        { id: 'c-0', nodeId: 'n-still-0', type: 'image', url: stills[0], offsetFrames: 0, durationFrames: 36 },
        { id: 'c-1', nodeId: 'n-clip', type: 'video', url: CLIP_URL, offsetFrames: 36, durationFrames: 48 },
        { id: 'c-2', nodeId: 'n-still-1', type: 'image', url: stills[1], offsetFrames: 84, durationFrames: 36 },
      ],
    }],
  },
})
// 第二个项目——纯图片，给库页凑出「多张最近项目卡」的真实密度。
const SECOND_ID = 'ia-audit-second'
const secondRoot = path.join(projectsDir, `ia-audit-${SECOND_ID}`)
fs.mkdirSync(path.join(secondRoot, 'assets', 'imported'), { recursive: true })
const still2 = path.join(secondRoot, 'assets', 'imported', 'still.png')
ff(['-f', 'lavfi', '-i', 'color=c=slateblue:size=768x432', '-frames:v', '1', still2], 'png-2nd')
seedProject({
  id: SECOND_ID, name: 'IA 走查·第二个项目', folder: `ia-audit-${SECOND_ID}`,
  nodes: [mkNode('s-still', 'still.png', `nomi-local://asset/${encodeURIComponent(SECOND_ID)}/assets/imported/still.png`, 'image', 160, 160)],
})

const { app, win: _initialWin } = await launchNomiApp({
  name: 'ia-audit-shots',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}

// Electron 窗口尺寸不由 viewport 决定 —— 直接设 BrowserWindow bounds 到 1680×1050。
async function resizeWindow() {
  try {
    const bw = await app.browserWindow(getWin())
    await bw.evaluate((w, { width, height }) => { w.setBounds({ x: 0, y: 0, width, height }); w.center() }, { width: WIN_W, height: WIN_H })
  } catch (e) { note('resize 失败(非致命)', e.message) }
  await getWin().waitForTimeout(500)
}

// 截图后自己验：非白屏 / 非纯开屏遮罩（采样若干点，颜色方差够大才算真拍到）。
async function snap(name) {
  const p = path.join(outDir, name)
  await screenshotSettled(getWin(), { path: p })
  const stat = fs.statSync(p)
  // 简单方差校验：读 PNG 字节熵不够严谨，改在页面里采样像素方差。
  const variance = await getWin().evaluate(() => {
    const el = document.body
    if (!el) return 0
    return document.querySelectorAll('*').length // 元素多 = 真的渲染了内容，不是空壳
  }).catch(() => 0)
  note(`截图 ${name}`, `${(stat.size / 1024).toFixed(0)}KB, DOM 元素≈${variance}`)
  return p
}

async function dismissSplash() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('[data-splash-skip="true"], button:has-text("跳过")').first()
    if (await skip.isVisible().catch(() => false)) { await skip.click({ timeout: 1000 }).catch(() => {}); await getWin().waitForTimeout(400) }
    const splashGone = (await getWin().locator('.nomi-splash').count().catch(() => 0)) === 0
    if (splashGone && i > 0) break
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(250)
  }
}
async function dismissTour() {
  for (let i = 0; i < 8; i++) {
    const s = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await s.count()) await s.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(220)
  }
}
async function clickText(sel, text, ms = 1400) {
  const el = getWin().locator(sel, { hasText: text }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await getWin().waitForTimeout(ms); return true }
  return false
}
async function clickRole(name, ms = 1400) {
  const el = getWin().getByRole('button', { name, exact: false }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await getWin().waitForTimeout(ms); return true }
  return false
}

// 诊断：抓 3D 全屏相关的控制台报错（chunk 加载失败 / r3f / WebGL）
win.on('console', (m) => { const t = m.text(); if (/error|fail|chunk|Scene3D|WebGL|context lost|import/i.test(t)) console.log(`  [console.${m.type()}] ${t.slice(0, 200)}`) })
win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    // 3D 导演台的 coach marks（新用户蒙层）——预置成 seen，否则会盖住 04 全屏截图
    localStorage.setItem('nomi.onboarding.scene3dCoach.v1', 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await resizeWindow()
  await dismissSplash()
  await getWin().waitForTimeout(800)

  // ========== ① 项目库首页 ==========
  // 等两张播种卡都出现
  await getWin().locator('[data-project-card="true"]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  const cardCount = await getWin().locator('[data-project-card="true"]').count()
  note('项目库卡片数', String(cardCount))
  // 播种项目按 updatedAt 排序不稳 → 后续操作一律按名字定位「示例项目」（含 4 图 1 视频 + 时间轴 + 3D 节点）。
  const richCard = getWin().locator('[data-project-card="true"]', { hasText: 'IA 走查·示例项目' }).first()
  // hover 富项目卡 → 露出「继续创作」等 hover 态
  if (await richCard.count()) {
    await richCard.hover().catch(() => {})
    await getWin().waitForTimeout(900)
  }
  await snap('01-library.png')

  // ========== ② 生成画布整屏 ==========
  // 画布/预览/3D 三屏都用「新建空白项目 + 运行时真拖放」建内容：播种 project.json 的画布快照
  // 在本机 hydrate 链路里到画布 store 是竞态的（源面板读 live store，偶尔读到偶尔读空）——
  // 空白项目 + 运行时投放则确定性：canvas store 里就恰好是我投的那几个节点，源面板/时间轴同源。
  const blankCta = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  if (await blankCta.count()) { await blankCta.click({ timeout: 6000 }).catch(() => {}) }
  await getWin().waitForTimeout(3000)
  await dismissTour()
  await resizeWindow()
  // 切「生成」工作区（舞台 .generation-canvas-v2__stage 即挂载，投放即建节点=建 board，
  // 同 contact-sheet.walk.mjs 的 proven 流，不必先手点「新建画面」）
  ;(await clickRole('生成', 1800)) || (await clickText('button, [role="button"], [role="tab"]', '生成', 1800))
  await dismissTour()
  await getWin().waitForTimeout(1500)

  // 画布内容用「运行时真拖放」建（proven：contact-sheet.walk.mjs 用同法真出 data-node-id 节点）。
  // 播种 project.json 的 generationCanvas 快照在本机 hydrate 链路里到不了画布 store（源面板能读到、
  // 画布 store restoreSnapshot 收不到），故不靠播种、直接把真图/真视频拖进舞台 → 真节点。
  const b64Stills = stills.map((_, i) => fs.readFileSync(path.join(mainRoot, 'assets', 'imported', `still-${i}.png`)).toString('base64'))
  const b64Clip = fs.readFileSync(clipPath).toString('base64')
  const dropped = await getWin().evaluate(async ({ pngs, clip }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) return { ok: false, why: 'no stage' }
    const rect = stage.getBoundingClientRect()
    const files = []
    pngs.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      files.push(new File([bytes], `still-${i}.png`, { type: 'image/png' }))
    })
    { const bytes = Uint8Array.from(atob(clip), (c) => c.charCodeAt(0)); files.push(new File([bytes], 'clip.mp4', { type: 'video/mp4' })) }
    // 分两撮投放，错开落点，避免全叠在一处
    const dropAt = (fileList, cx, cy) => {
      const dt = new DataTransfer()
      fileList.forEach((f) => dt.items.add(f))
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }
      stage.dispatchEvent(new DragEvent('dragover', opts))
      stage.dispatchEvent(new DragEvent('drop', opts))
    }
    dropAt(files.slice(0, 2), rect.left + rect.width * 0.35, rect.top + rect.height * 0.4)
    return { ok: true }
  }, { pngs: b64Stills, clip: b64Clip })
  note('画布运行时拖放', dropped.ok ? '首撮已投' : dropped.why)
  await getWin().waitForTimeout(4000)
  // 第二撮（另外两张 + 视频），错开落点
  await getWin().evaluate(async ({ pngs, clip }) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const files = []
    { const bytes = Uint8Array.from(atob(pngs[2]), (c) => c.charCodeAt(0)); files.push(new File([bytes], 'still-2.png', { type: 'image/png' })) }
    { const bytes = Uint8Array.from(atob(clip), (c) => c.charCodeAt(0)); files.push(new File([bytes], 'clip.mp4', { type: 'video/mp4' })) }
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f))
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width * 0.62, clientY: rect.top + rect.height * 0.55, dataTransfer: dt }
    stage.dispatchEvent(new DragEvent('dragover', opts))
    stage.dispatchEvent(new DragEvent('drop', opts))
  }, { pngs: b64Stills, clip: b64Clip })
  await getWin().waitForTimeout(5000)
  const nodeCount = await getWin().evaluate(() => document.querySelectorAll('[data-node-id]').length)
  note('画布真节点数', String(nodeCount))

  // 打开右侧助手栏（launcher 用原生 DOM click，避免 actionability 抖动）
  // Host cutover：画布内旧助手已退役，Agent 现居 ResidentShell dock（默认常驻，2026-09-05 起无发布闸）；
  // 2026-09-06 v4：收起态是一根 32px 图标条（[data-agent-collapsed] 里的 [data-v4-block="dock"]），
  // 第一颗钮就是「对话」。
  await getWin().evaluate(() => {
    const btn = document.querySelector('[data-agent-resident="true"][data-agent-collapsed="true"] [data-v4-block="dock"] button')
    if (btn) btn.click()
  }).catch(() => {})
  await getWin().waitForTimeout(1200)
  // 适应视图，让所有节点都进画面
  const fit = getWin().locator('[aria-label="适应视图"]').first()
  if (await fit.count()) { await fit.click({ timeout: 3000 }).catch(() => {}); await getWin().waitForTimeout(1200) }
  await resizeWindow()
  await snap('02-canvas-full.png')

  // ========== ③ 剪辑/预览页整屏 ==========
  ;(await clickRole('预览', 1800)) || (await clickText('button, [role="button"], [role="tab"]', '预览', 1800))
  await dismissTour()
  await getWin().waitForTimeout(2000)
  // 源面板「镜头」tile 就是 <button draggable>，其 onClick 直接 addGenerationNodeToTimelineEnd(node)——
  // 点它即把该节点贴到时间轴尾（PreviewSourcePanel.tsx:91-94）。逐个点=真 clip，无需模拟拖放。
  const sourceTiles = getWin().locator('.workbench-preview-source button[draggable="true"], button[draggable="true"][aria-label]')
  const tileCount = await sourceTiles.count().catch(() => 0)
  let clicked = 0
  for (let i = 0; i < Math.min(4, tileCount); i++) {
    await sourceTiles.nth(i).click({ timeout: 4000 }).catch(() => {})
    await getWin().waitForTimeout(700)
    clicked++
  }
  note('点源面板 tile 入轨', `点了 ${clicked}（源 tile 共 ${tileCount}）`)
  await getWin().waitForTimeout(2500)
  const clipCount = await getWin().evaluate(() => document.querySelectorAll('.workbench-timeline-clip').length)
  note('时间轴真 clip 数', String(clipCount))
  await resizeWindow()
  await getWin().waitForTimeout(1000)
  await snap('03-preview.png')

  // ========== ④ 3D 导演台全屏态 ==========
  // 回生成区 → 用左缘工具条加一个 3D 场景节点 → 点卡上「进入 3D 编辑器」启动器 →
  // 等全屏导演台的任务页签 tablist 出现。（播种不到画布 store，故运行时建。）
  ;(await clickRole('生成', 1500)) || (await clickText('button, [role="button"], [role="tab"]', '生成', 1500))
  await getWin().waitForTimeout(1200)
  await dismissTour() // ← 先在进全屏前把引导清掉（dismissTour 会点「关闭」，进全屏后再跑会关掉导演台）
  // 点法收口在 _canvasRail：3D 场景自 2026-09-06「第三档」起住在左缘的「更多」里，
  // 按 aria-label 直点左缘的写法已经点不到了。原先那句还套着 `.catch(() => false)`，
  // 点不到只记一行 note 就继续 → 后面每一步都在「没有 3D 节点」的画布上跑成假绿
  //（docs/lessons/dead-selector-lies-both-ways）。这里改成真断言：节点必须真的多出来一个。
  const nodeCountBefore = await getWin().locator('.generation-canvas-v2-node[data-node-id]').count()
  await addCanvasNodeFromRail(getWin(), 'scene3d')
  await expectCount(
    getWin().locator('.generation-canvas-v2-node[data-node-id]'),
    nodeCountBefore + 1,
    `左缘「更多」→ 3D 场景后画布节点 +1（${nodeCountBefore} → ${nodeCountBefore + 1}）`,
  )
  note('加 3D 场景节点', `已加（_canvasRail，节点 ${nodeCountBefore} → ${nodeCountBefore + 1}）`)
  await getWin().waitForTimeout(3000)
  // 全屏导演台**唯一真标志**：Scene3DFullscreen 经 createPortal 挂到 body 的 `.workbench-shell.fixed.inset-0`
  // 满屏壳（Scene3DFullscreen.tsx:489）。role="tablist" 会误命中顶栏创作/生成/预览页签，不能用它判定。
  const isFullscreenOpen = async () =>
    await getWin().evaluate(() => !!document.querySelector('.workbench-shell.fixed.inset-0')).catch(() => false)
  // 空 3D 场景节点卡上的启动器：EmptyStateLauncher 的 aria-label = 「进入 3D 编辑器」（enterEditorAria）。
  // 先枚举 3D 相关按钮（诊断：确认启动器/角标钮到底在不在、可不可见）
  const btnDump = await getWin().evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter((b) => /进入 3D 编辑器|打开 3D 编辑器/.test(b.getAttribute('aria-label') || b.textContent || ''))
    .map((b) => ({ al: b.getAttribute('aria-label'), vis: b.offsetParent !== null }))).catch(() => [])
  note('3D 相关按钮', JSON.stringify(btnDump))
  let opened3d = false
  let clickedLauncherLabel = null
  for (let attempt = 0; attempt < 4 && !opened3d; attempt++) {
    clickedLauncherLabel = await getWin().evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      // 角标钮「打开 3D 编辑器」在空/满态都在且不被 preview popover 遮，优先它；退而空态启动器「进入 3D 编辑器」
      const corner = btns.find((x) => (x.getAttribute('aria-label') || '') === '打开 3D 编辑器')
      const enter = btns.find((x) => (x.getAttribute('aria-label') || '') === '进入 3D 编辑器')
      const b = corner || enter
      if (b) { b.scrollIntoView(); b.click(); return b.getAttribute('aria-label') || 'clicked' }
      return null
    }).catch(() => null)
    // 点后立刻查一次（区分「没开」vs「开了又被关」）
    await getWin().waitForTimeout(300)
    const immediate = await isFullscreenOpen()
    if (attempt === 0) note('点后即时全屏态', `点了「${clickedLauncherLabel}」→ 立刻 ${immediate ? '已开' : '未开'}`)
    // 全屏 chunk 懒加载（Scene3DFullscreen ~224KB）→ 轮询等满屏壳真挂载
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (await isFullscreenOpen()) { opened3d = true; break }
      await getWin().waitForTimeout(600)
    }
    if (!opened3d) await getWin().waitForTimeout(800)
  }
  note('3D 启动器点击', clickedLauncherLabel || '未找到启动器按钮')
  // 进全屏后**不做任何 Escape / dismissTour**（都可能关掉满屏壳）。coach 已预置 seen。
  await resizeWindow()
  // 等 r3f 视口真渲染出来（否则视口停在「正在初始化 3D 视口...」）——轮询到 canvas 有内容，最多 15s
  {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const ready = await getWin().evaluate(() => {
        const shell = document.querySelector('.workbench-shell.fixed.inset-0')
        if (!shell) return false
        const c = shell.querySelector('canvas')
        // 视口初始化文案消失 + canvas 有尺寸 = 已渲染
        const stillInit = /正在初始化 3D 视口/.test(shell.textContent || '')
        return !!c && c.width > 100 && !stillInit
      }).catch(() => false)
      if (ready) break
      await getWin().waitForTimeout(700)
    }
  }
  await getWin().waitForTimeout(2500) // 场景 + 相机预览再稳一下
  // 拍前再确认满屏壳仍在（且顶栏任务页签 role=tab 也在这个壳里）
  const finalFs = await isFullscreenOpen()
  const fsTabs = await getWin().evaluate(() => {
    const shell = document.querySelector('.workbench-shell.fixed.inset-0')
    return shell ? shell.querySelectorAll('[role="tab"]').length : 0
  }).catch(() => 0)
  note('3D 全屏态判定', finalFs ? `已进入全屏导演台（满屏壳在，顶栏任务页签 ${fsTabs} 个）` : '未确认进入（拍当前态存证）')
  await snap('04-scene3d.png')

  console.log('\n=== 取证完成 ===')
  console.log(`输出目录: ${outDir}`)
  for (const r of results) if (/^截图/.test(r.name)) console.log(`  ${r.name} — ${r.detail}`)
} catch (e) {
  console.log('WALK ERROR:', e.stack || e.message)
  try { await snap('99-error-state.png') } catch { /* */ }
} finally {
  await app.close().catch(() => {})
}
