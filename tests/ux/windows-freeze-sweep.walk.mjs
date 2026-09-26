// Windows 卡顿巡检 —— 发版前在 Windows 机器上跑（docs/release-process.md §4）。
//
// 为什么要它（2026-09-24）：v0.22.0 在 Windows 上一导入素材、一生图就整窗卡死一分多钟，随后显卡进程
// 崩溃、画布「加载失败」；同一天还查出同步盘占用文件会让存盘锁永久卡死。三件都只在 Windows 上发生
// （D3D11 着色器编译 / Windows 文件共享语义），而此前所有性能与验收都在 macOS 和 Linux CI 上跑——
// 没有任何一道测试在 Windows 上量过「按下去界面还动不动」。根因合同：
//   docs/fixes/2026-09-24-waiting-effect-shader-compile-freeze.root-cause.json
//   docs/fixes/2026-09-24-manifest-lock-sharing-violation.root-cause.json
// 结构评审：docs/audit/2026-09-24-electron-workspace-structure-review.md
//
// 做什么：在真 Electron 里像用户一样走一遍（新建 → 拖图 → 按钮导入 → 粘贴 → 拖视频 → 生图等待 →
// 揭示 → 3D 导演台 → 回库 → 重开 → 失焦 → 切项目），每一步同时量三处：
//   ① 渲染线程：页面内 rAF 最大帧间隔（界面有没有停下来）；
//   ② 主进程：app.evaluate 往返；
//   ③ GPU 进程：child-process-gone。
// 判红：任一步帧间隔 > FREEZE_MS、GPU 进程退出、页面出现「失败」横幅、或步骤本身报错。
//
// 素材：仓库里已提交的真实生成图 / 视频（docs/audit/…），不用合成色块。生成走本地假供应商（零额度），
// 只有供应商是假的，排队 / 等待动效 / 结果落盘全走生产代码（同 process-feedback-real-fixture）。
//
// 用法（先 pnpm build）：
//   node tests/ux/windows-freeze-sweep.walk.mjs                 # 开发构建
//   node tests/ux/windows-freeze-sweep.walk.mjs --held          # 再模拟同步盘/杀毒占用新文件（仅 Windows）
//   node tests/ux/windows-freeze-sweep.walk.mjs --label rc-0.22.1
// 产出：tests/ux/shots/windows-freeze-sweep/<label>/report.json + 截图（自己 Read 亲眼看）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { CANVAS_STAGE_SELECTOR, findCanvasBlankPoint, revealArrivals } from './_canvasHit.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { placeCharacter } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import { createProcessFixture } from './process-feedback-real-fixture.mjs'

const argv = process.argv.slice(2)
const held = argv.includes('--held')
const labelIndex = argv.indexOf('--label')
const label = `${labelIndex >= 0 ? argv[labelIndex + 1] : 'run'}${held ? '-held' : ''}`
if (held && process.platform !== 'win32') throw new Error('--held 模拟的是 Windows 文件共享语义，只能在 Windows 上跑')
const FREEZE_MS = 1000
const outDir = path.join(repoRoot, 'tests/ux/shots/windows-freeze-sweep', label)
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-windows-sweep-'))
const settingsDir = path.join(tempRoot, 'settings')
// 中文 + 空格的项目目录：用户现场就是这样，路径编码问题在这里先暴露。
const projectsDir = path.join(tempRoot, '团队 共享', '中文项目目录')
fs.mkdirSync(projectsDir, { recursive: true })
const fixture = await createProcessFixture(repoRoot, settingsDir)

const AUDIT = 'docs/audit'
const imageSources = [
  '2026-08-19-l3-w1-shot-verify/01-image-1787156695800.jpg',
  '2026-08-19-l3-w1-shot-verify/02-image-1787147676938.jpg',
  '2026-08-19-l3-w1-shot-verify/03-image-1787158633643.jpg',
  '2026-08-19-l3-w1-shot-verify/04-image-1787158670244.jpg',
  '2026-08-20-l3-f1b-reverify/02-image-1787222849717.jpg',
  '2026-08-20-l3-f1b-reverify/01-image-1787222825687.jpg',
  '2026-08-19-l3-w1-shot-verify/02-image-1787158598473.jpg',
]
const videoSources = [
  '2026-08-20-l3-f1-full-journey/08-video-1787216968985.mp4',
  '2026-08-20-l3-f1-full-journey/10-video-1787217281621.mp4',
]
const mediaDir = path.join(tempRoot, '素材 文件夹')
fs.mkdirSync(mediaDir, { recursive: true })
function stage(sources, name) {
  return sources.map((source, index) => {
    const file = path.join(mediaDir, name(index, path.extname(source)))
    fs.copyFileSync(path.join(repoRoot, AUDIT, source), file)
    return file
  })
}
const images = stage(imageSources, (index, ext) => `镜头 ${index + 1}（参考）${ext}`)
const videos = stage(videoSources, (index, ext) => `视频 ${index + 1}${ext}`)
// 失败横幅检查的阳性对照：导入一个不认得的文件，产品必须在提示区报错。
const notMedia = path.join(mediaDir, '说明.txt')
fs.writeFileSync(notMedia, 'not media')

const { app, win: firstWin, mainLogTail } = await launchNomiApp({
  name: 'windows-freeze-sweep',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 0,
  env: { NOMI_DISABLE_AUTO_UPDATE: '1' },
  // 被别的窗口挡住时 Chromium 会把 rAF 降到 1Hz、懒加载停摆——那是测试环境的假卡顿，不是 Nomi。
  args: ['--no-proxy-server', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  initialLocalStorage: {
    'nomi:locale:v1': 'zh-CN',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    __nomiE2E: '1',
  },
})
let win = firstWin
await app.evaluate(({ app: electronApp }) => {
  globalThis.__sweepGone = []
  electronApp.on('child-process-gone', (_event, details) => globalThis.__sweepGone.push({ type: details.type, reason: details.reason, exitCode: details.exitCode }))
})
const pageErrors = []
const watch = (page) => page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 240)))
watch(win)
app.on('window', watch)

async function installFrameProbe() {
  await win.evaluate(() => {
    if (window.__sweepProbe) return
    const probe = { max: 0, last: performance.now() }
    const tick = (now) => { probe.max = Math.max(probe.max, now - probe.last); probe.last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__sweepProbe = probe
  }).catch(() => {})
}

let current = null
let sampling = true
const sampler = (async () => {
  while (sampling) {
    const started = Date.now()
    await app.evaluate(() => 1).catch(() => {})
    if (current) current.maxMain = Math.max(current.maxMain, Date.now() - started)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
})()

const steps = []
/** 产品报错的地方：项目横幅、节点错误、导入反馈都挂 role=alert|status。 */
const liveRegions = () => win.locator('[role="alert"], [role="status"]')
let bannerProof = null
async function step(name, run, settleMs = 1500) {
  await installFrameProbe()
  await win.evaluate(() => { const probe = window.__sweepProbe; if (probe) { probe.max = 0; probe.last = performance.now() } }).catch(() => {})
  current = { maxMain: 0 }
  const started = Date.now()
  let error = null
  try {
    await run()
  } catch (caught) {
    error = String(caught?.message || caught).split('\n')[0].slice(0, 240)
  }
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  const frameGap = await win.evaluate(() => Math.round(window.__sweepProbe?.max ?? -1)).catch(() => null)
  const gpuGone = await app.evaluate(() => globalThis.__sweepGone.splice(0)).catch(() => [])
  // 失败只从提示区读（项目横幅 / 节点错误 / 导入反馈都是 role=alert|status），不扫整页文字——
  // 整页里有用户自己的提示词、文件名，扫它会把「文稿里写着失败」也算成失败（check:walkthroughs）。
  // 「没看到失败」要有基线：bannerProof 由第一步里那次「导入不认得的文件」证过探针看得见真实的失败提示。
  const failureBanners = liveRegions().filter({ hasText: /失败|请检查/ })
  const banners = bannerProof
    ? await expectAbsent(failureBanners, { provenBy: bannerProof, message: `「${name}」之后不该有失败横幅` }).then(
      () => [], () => failureBanners.allInnerTexts().then((texts) => texts.slice(0, 3), () => ['（横幅在，但读不到文字）']))
    : ['（失败横幅检查没有基线：第一步的阳性对照没成立）']
  const result = { name, ms: Date.now() - started, frameGap, maxMain: current.maxMain, gpuGone, banners, error }
  result.ok = !error && gpuGone.length === 0 && banners.length === 0 && frameGap !== null && frameGap <= FREEZE_MS
  steps.push(result)
  const shot = `${String(steps.length).padStart(2, '0')}.png`
  await win.screenshot({ path: path.join(outDir, shot) }).catch(() => {})
  console.log(`${result.ok ? '✓' : '✖'} ${name} — 帧间隔 ${frameGap}ms · 主进程 ${current.maxMain}ms${gpuGone.length ? ` · GPU 退出 ${JSON.stringify(gpuGone)}` : ''}${banners.length ? ` · 横幅 ${JSON.stringify(banners)}` : ''}${error ? ` · 报错 ${error}` : ''}  [${shot}]`)
  current = null
}

function projectWindow() {
  const live = app.windows().filter((page) => !page.isClosed())
  return live.find((page) => /projectId=/.test(page.url())) || live[live.length - 1]
}

/** 真实磁盘文件经 setInputFiles 挂到 File 上（与从资源管理器拖进来的是同一种对象），在落点派发 drop。 */
async function dropFile(filePath, point) {
  await win.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.dataset.sweepDrop = '1'; input.style.display = 'none'; document.body.appendChild(input) })
  await win.locator('input[data-sweep-drop="1"]').setInputFiles(filePath)
  await win.evaluate(({ x, y }) => {
    const input = document.querySelector('input[data-sweep-drop="1"]')
    const transfer = new DataTransfer()
    transfer.items.add(input.files[0])
    const target = document.elementFromPoint(x, y)
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }
    target.dispatchEvent(new DragEvent('dragenter', init))
    target.dispatchEvent(new DragEvent('dragover', init))
    target.dispatchEvent(new DragEvent('drop', init))
    input.remove()
  }, point)
}

/** 画面外的卡不挂 <img>（延迟媒体队列），所以从画布数据数：已落盘成 nomi-local 的素材节点。 */
async function waitLanded(count, timeout = 90_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await win.evaluate(() => {
      const nodes = window.__nomiCanvasStore?.getState().nodes || []
      return {
        landed: nodes.filter((node) => /^nomi-local:/.test(String(node.result?.url || '')) && node.meta?.uploadStatus !== 'uploading').length,
        uploading: nodes.filter((node) => node.meta?.uploadStatus === 'uploading').length,
      }
    }).catch(() => ({ landed: 0, uploading: 1 }))
    if (state.landed >= count && state.uploading === 0) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`导入后画布上的素材一直没到 ${count} 个`)
}

let holder = null
function startHandleHolder(root) {
  // 同步盘 / 杀毒的共享方式：新文件一出现就以「只许别人读、不许删除或改名」打开 300ms。
  const script = `$ErrorActionPreference='SilentlyContinue'; $root='${root.replace(/'/g, "''")}'; $seen=@{}
while ($true) { Get-ChildItem -LiteralPath $root -Recurse -Force | ForEach-Object { $key=$_.FullName + '|' + $_.LastWriteTimeUtc.Ticks; if (-not $seen.ContainsKey($key)) { $seen[$key]=1; if (-not $_.PSIsContainer) { try { $handle=[System.IO.File]::Open($_.FullName,'Open','Read','Read'); Start-Sleep -Milliseconds 300; $handle.Close() } catch {} } } }; Start-Sleep -Milliseconds 40 }`
  holder = spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
}

try {
  for (let index = 0; index < 3; index += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(120) }
  await step('新建空白项目 → 进生成画布', async () => {
    await win.getByRole('button', { name: /新建空白项目/ }).click({ timeout: stationTimeout({ operations: 2 }) })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && !app.windows().some((page) => /projectId=/.test(page.url()))) await new Promise((resolve) => setTimeout(resolve, 200))
    win = projectWindow()
    await win.getByRole('button', { name: '生成', exact: true }).click({ timeout: stationTimeout({ operations: 2 }) })
    await win.locator(CANVAS_STAGE_SELECTOR).first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    // 阳性对照：用户真会做的一件事——导入一个不认得的文件。产品必须在提示区报错；
    // 看得见它，后面每一步的「没有失败横幅」才不是恒真的空话。看完点掉，不留在界面上。
    const chooser = win.waitForEvent('filechooser', { timeout: stationTimeout({ operations: 1 }) })
    await win.getByRole('button', { name: '导入文件' }).first().click()
    await (await chooser).setFiles([notMedia])
    const notice = liveRegions().filter({ hasText: '不是 Nomi 认得的媒体格式' })
    bannerProof = await proveProbe(notice, '导入 .txt 时提示区报「不是 Nomi 认得的媒体格式」')
    await notice.first().locator('button').last().click()
  })
  if (held) startHandleHolder(projectsDir)
  const box = await win.locator(CANVAS_STAGE_SELECTOR).first().boundingBox()
  let landed = 0
  await step('拖入 4 张图（逐张 1.2s）', async () => {
    for (let index = 0; index < 4; index += 1) { await dropFile(images[index], { x: Math.round(box.x + 140 + index * 160), y: Math.round(box.y + 180) }); await win.waitForTimeout(1200) }
    await waitLanded(landed += 4)
  }, 3000)
  await step('工具栏「导入文件」选 2 张', async () => {
    const chooser = win.waitForEvent('filechooser', { timeout: stationTimeout({ operations: 1 }) })
    await win.getByRole('button', { name: '导入文件' }).first().click()
    await (await chooser).setFiles([images[4], images[5]])
    await waitLanded(landed += 2)
  }, 3000)
  await step('复制图片 → Ctrl+V 粘贴', async () => {
    await app.evaluate(({ clipboard, nativeImage }, file) => clipboard.writeImage(nativeImage.createFromPath(file)), images[6])
    const blank = await findCanvasBlankPoint(win)
    await win.mouse.click(blank.x, blank.y)
    await win.keyboard.press('Control+V')
    await waitLanded(landed += 1)
  }, 3000)
  await step('拖入 2 段视频', async () => {
    for (let index = 0; index < videos.length; index += 1) { await dropFile(videos[index], { x: Math.round(box.x + 160 + index * 170), y: Math.round(box.y + 360) }); await win.waitForTimeout(1500) }
    await waitLanded(landed += videos.length)
  }, 4000)
  let generatedId = null
  await step('新建图片节点 → 生成（等待动效在跑）', async () => {
    // 新节点按画布数据前后差出来：DOM 顺序不等于创建顺序，「最后一张卡」可能是别的节点。
    const nodeIds = () => win.evaluate(() => (window.__nomiCanvasStore?.getState().nodes || []).map((node) => node.id))
    const before = new Set(await nodeIds())
    await win.keyboard.press('Escape')
    const blank = await findCanvasBlankPoint(win)
    await win.mouse.click(blank.x, blank.y, { button: 'right' })
    await win.locator('.generation-canvas-v2__context-node-menu [role=menuitem]').filter({ hasText: '图片' }).first().click()
    const nodeDeadline = Date.now() + 10_000
    while (Date.now() < nodeDeadline && !generatedId) {
      generatedId = (await nodeIds()).find((id) => !before.has(id)) ?? null
      if (!generatedId) await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!generatedId) throw new Error('右键新建图片节点后画布上没有新节点')
    // 画布被导入的大图铺满时，右键那一点放不下一张新卡，它会落到屏外、舞台边出「新节点在…」提示——人会点提示过去。
    await revealArrivals(win)
    const node = win.locator(`article[data-node-id="${generatedId}"]`)
    await node.click({ position: { x: 40, y: 15 } })
    await win.locator('[contenteditable=true]:visible').first().fill('傍晚河边，一位女孩望向远处的桥，电影画面。')
    const jobsBefore = fixture.jobs.length
    await win.getByRole('button', { name: '生成素材', exact: true }).click()
    // 用户自己点的单份生成不弹付费确认卡（2026-09-25 拍板，判据按份数不按入口）；若中间弹卡而不点，
    // 请求永远发不出去——下面假供应商收到这一单（fixture.jobs +1）就是证据。
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && fixture.jobs.length < jobsBefore + 1) await new Promise((resolve) => setTimeout(resolve, 200))
    if (fixture.jobs.length !== jobsBefore + 1) throw new Error(`点「生成素材」后假供应商应收到 1 单，实际 ${fixture.jobs.length - jobsBefore} 单`)
    await win.locator(`article[data-node-id="${generatedId}"] [data-process-fx]`).waitFor({ timeout: stationTimeout({ operations: 2 }) })
  }, 6000)
  await step('生成完成 → 结果揭示', async () => {
    fixture.jobs[0].done = true
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      const status = await win.evaluate((id) => window.__nomiCanvasStore?.getState().nodes.find((node) => node.id === id)?.status, generatedId).catch(() => null)
      if (status === 'success') break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    await win.locator(`article[data-node-id="${generatedId}"] [data-generation-waiting]`).waitFor({ state: 'detached', timeout: stationTimeout({ operations: 1 }) })
  }, 3000)
  await step('进入 3D 导演台 → 放一个角色 → 退出', async () => {
    await addCanvasNodeFromRail(win, 'director')
    await revealArrivals(win)
    await win.locator('[data-testid="director-node-open"]').first().click({ timeout: stationTimeout({ operations: 2 }) })
    await win.locator('[data-testid="director-editor"]').waitFor({ timeout: stationTimeout({ operations: 4 }) })
    await win.waitForFunction(() => {
      const bridge = window.__nomiDirectorE2E
      const point = bridge && typeof bridge.projectPoint === 'function' ? bridge.projectPoint(0, 0, 0) : null
      return Boolean(point && Number.isFinite(point.x))
    }, null, { timeout: stationTimeout({ operations: 4 }) })
    const lab = { page: win, bridge: (method, ...args) => win.evaluate(([name, list]) => window.__nomiDirectorE2E?.[name]?.(...list) ?? null, [method, args]) }
    await placeCharacter(lab, 'female', 0, 0)
    await win.locator('[data-testid="director-outliner-row"]', { hasText: '角色' }).first().waitFor({ timeout: stationTimeout({ operations: 4 }) })
    await win.locator('[data-testid="director-exit"]').first().click()
    // 确认框带入场动画：等它真出现再点，别在它出现前的那一帧判成「没有确认框」。
    const confirmExit = win.getByRole('dialog').getByRole('button', { name: '退出', exact: true })
    await confirmExit.waitFor({ timeout: stationTimeout({ operations: 1 }) }).then(() => confirmExit.click(), () => {})
    await win.locator('[data-testid="director-editor"]').waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 2 }) })
  }, 3000)
  await step('回项目库', async () => {
    await win.getByText('项目库', { exact: true }).first().click()
    await win.getByRole('button', { name: /新建空白项目/ }).waitFor({ timeout: stationTimeout({ operations: 2 }) })
  })
  await step('重新打开这个项目', async () => {
    await win.locator('[data-project-card]').first().click()
    await win.locator(CANVAS_STAGE_SELECTOR).first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    await waitLanded(landed)
  }, 3000)
  await step('窗口失焦再聚焦（触发项目清单重读）', async () => {
    const browserWindow = await app.browserWindow(win)
    for (let index = 0; index < 3; index += 1) { await browserWindow.evaluate((target) => { target.blur(); target.focus() }); await win.waitForTimeout(400) }
  })
  await step('回库 → 新建第二个项目 → 切回第一个', async () => {
    await win.getByText('项目库', { exact: true }).first().click()
    await win.getByRole('button', { name: /新建空白项目/ }).click({ timeout: stationTimeout({ operations: 2 }) })
    await win.getByRole('button', { name: '生成', exact: true }).first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    await win.getByText('项目库', { exact: true }).first().click()
    await win.locator('[data-project-card]').nth(1).click({ timeout: stationTimeout({ operations: 2 }) })
    await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
    await win.locator(CANVAS_STAGE_SELECTOR).first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  }, 3000)
} finally {
  sampling = false
  await sampler
  if (holder) holder.kill()
  // 占用结束后项目目录里不许残留锁：它会被同步盘带到另一台电脑，挡住那边保存。
  const leftoverLocks = []
  for (const root of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
    const nomiDir = path.join(projectsDir, root, '.nomi')
    if (!fs.existsSync(nomiDir)) continue
    for (const name of fs.readdirSync(nomiDir)) if (name === 'manifest-transaction.lock') leftoverLocks.push(path.join(root, '.nomi', name))
  }
  const failed = steps.filter((result) => !result.ok)
  const report = { label, held, platform: `${process.platform}-${os.release()}`, freezeMs: FREEZE_MS, steps, leftoverLocks, pageErrors: pageErrors.slice(0, 20), mainLogTail: mainLogTail().filter((line) => /error|fail|busy|EPERM|EBUSY|EACCES|gpu/i.test(line) && !/\[nomi:events\] append-failed/.test(line)).slice(-60) }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  await app.close().catch(() => {})
  await fixture.close()
  console.log(`\n${failed.length === 0 && leftoverLocks.length === 0 ? '✅' : '✖'} ${steps.length} 步，红 ${failed.length} 步，残留锁 ${leftoverLocks.length} 个 · 报告 ${path.relative(repoRoot, path.join(outDir, 'report.json'))}`)
  if (failed.length > 0 || leftoverLocks.length > 0 || steps.length < 12) process.exitCode = 1
}
