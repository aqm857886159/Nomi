// R13 验收走查（引导示例图的构建产物地址 · 2026-09-25 用户 Mac 控制台：
// `Not allowed to load local resource: file:///Applications/Nomi.app/…/app.asar/dist/assets/kid-Bv5PJ3l5.jpg`、
// `Loading the image 'http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/kid.jpg' violates … img-src`、
// `[NomiImage] 图片加载失败`）。
//
// 预埋一个 v0.16.7–v0.18.0 留下的「示例：修好一个小机器人」项目：画布卡的结果 / 历史、时间轴 clip、提示词 @ 引用里
// 存的是用户控制台里那两条原样地址。冷启动 → 项目库（封面）→ 打开项目（画布），验：
//   ① 项目库封面出图；② 画布上的卡全部出图；③ 控制台没有那三类报错；④ 磁盘上的 project.json 已不含构建产物地址。
// 用法: pnpm build && node tests/ux/build-artifact-url-migration.walk.mjs [--locale en]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'zh-CN'
const shotsDir = path.join(repoRoot, `tests/ux/shots/build-artifact-url-migration-${locale}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const PACKAGED_KID = 'file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/kid-Bv5PJ3l5.jpg'
const DEV_KID = 'http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/kid.jpg'
const PACKAGED_SHOT = 'file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/shot-3-Qw3rTy12.jpg'
const DEV_ROBOT = 'http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/robot.jpg'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-build-artifact-walk-'))
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'walk-legacy-demo'
const projectName = locale === 'en' ? 'Example: fix a little robot' : '示例：修好一个小机器人'
const projectRoot = path.join(projectsDir, 'walk-legacy-demo')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const card = (id, title, url, x, history = [url]) => ({
  id, kind: 'image', title, prompt: '', categoryId: 'shots', references: [], runs: [], status: 'success',
  position: { x, y: 160 }, size: { width: 300, height: 170 },
  result: { id: `demo-${id}`, type: 'image', url, createdAt: 1 },
  history: history.map((entry, index) => ({ id: `demo-${id}-${index}`, type: 'image', url: entry, createdAt: 1 })),
  meta: { imageWidth: 720, imageHeight: 405, imageAspectRatio: 720 / 405 },
})
const now = Date.now()
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify({
  id: projectId, name: projectName, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(projectRoot),
  seedKey: 'onboarding-demo',
  payload: {
    timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [{ id: 'imageTrack', type: 'image', label: 'image', clips: [{ id: 'c1', type: 'image', sourceNodeId: 'shot-3', label: 'shot-3', startFrame: 0, endFrame: 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0, url: PACKAGED_SHOT }] }] },
    generationCanvas: {
      nodes: [
        card('kid', '小女孩', PACKAGED_KID, 80, [DEV_KID, PACKAGED_KID]),
        card('robot', '小机器人', DEV_ROBOT, 460),
        { ...card('shot-3', '镜头 3', PACKAGED_SHOT, 840), prompt: `参考 @[asset:${encodeURIComponent(DEV_KID)}] 修机器人` },
      ],
      edges: [], groups: [], selectedNodeIds: [],
    },
  },
}, null, 1))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
}
const snap = async (page, name) => {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }).catch(() => {})
  console.log(`  [shot] ${name}`)
}
const BAD_CONSOLE = /Not allowed to load local resource|violates the following Content Security Policy directive: "img-src|NomiImage|图片加载失败/i

let app
let win
const consoleErrors = []
try {
  ;({ app, win } = await launchNomiApp({
    name: `build-artifact-url-migration-${locale}`,
    tempRoot,
    projectsDir,
    settleMs: 0,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
  }))
  const watch = (page) => page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text()) })
  watch(win)
  const projectCard = win.locator('[data-project-card]', { hasText: projectName }).first()
  await projectCard.waitFor({ timeout: stationTimeout() })
  await win.waitForTimeout(2500)
  const cover = await projectCard.evaluate((el) => [...el.querySelectorAll('img')].map((img) => ({ src: img.getAttribute('src') || '', loaded: img.complete && img.naturalWidth > 0 })))
  await snap(win, '01-library-cover')
  check('① 项目库封面出图（不是构建产物地址）', cover.length > 0 && cover.every((img) => img.loaded && !/app\.asar|:5273\/src\//.test(img.src)), JSON.stringify(cover.map((img) => ({ ...img, src: img.src.slice(0, 60) }))))

  await projectCard.click()
  for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  watch(win)
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout() })
  const stage = win.locator('.react-flow__pane').first()
  if (!(await stage.isVisible().catch(() => false))) await win.locator('.nomi-stepper__step[data-mode="generation"]').first().click()
  await stage.waitFor({ state: 'visible', timeout: stationTimeout() })
  await win.locator(`button[aria-label="${locale === 'en' ? 'Fit view' : '适应视图'}"]`).first().click().catch(() => {})
  await win.waitForTimeout(3000)
  const images = await win.evaluate(() => [...document.querySelectorAll('.react-flow__node img')].map((img) => ({ src: img.getAttribute('src') || '', loaded: img.complete && img.naturalWidth > 0 })))
  await snap(win, '02-canvas-cards')
  check('② 画布上的示例卡全部出图', images.length >= 3 && images.every((img) => img.loaded), JSON.stringify(images.map((img) => ({ loaded: img.loaded, src: img.src.slice(0, 70) }))))
  check('② 卡上的地址是本项目的 nomi-local 资产', images.length > 0 && images.every((img) => img.src.startsWith(`nomi-local://asset/${projectId}/`)))

  const onDisk = fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8')
  check('④ 磁盘上的 project.json 已不含构建产物地址（含 @ 引用）', !/app\.asar|127\.0\.0\.1:5273|127\.0\.0\.1%3A5273/.test(onDisk))
} catch (error) {
  console.log(`  FAIL walk crashed: ${error?.stack || error}`)
  results.push({ name: 'crash', ok: false })
  if (win) await snap(win, '99-crash')
} finally {
  const bad = consoleErrors.filter((text) => BAD_CONSOLE.test(text))
  check('③ 控制台没有「不许加载本地资源 / img-src 违规 / 图片加载失败」', bad.length === 0, bad.slice(0, 3).map((text) => text.slice(0, 140)).join(' | '))
  await app?.close().catch(() => {})
}
const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed · shots: ${path.relative(repoRoot, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
