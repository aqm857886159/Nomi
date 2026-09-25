// R13 验收走查（素材库交互回归 · 2026-09-25 用户原话「拖不出图片和视频来了；项目素材只能点击一个删除，
// 点击对勾无法取消，拖出也无法复制」）。
//
// 两个项目（都放登记过的真实镜头 + 抽帧）：当前项目 A、上一个项目 B。冷启动从项目库卡片打开 A，
// 全程真实鼠标（Playwright 驱动 Chromium 原生 HTML5 拖放），验：
//   ① 全部素材：当前项目的图拖到画布 → 多一张卡
//   ② 全部素材：B 项目的图拖到画布 → 多一张卡，且卡上的地址已经是 A 项目自己的文件（复制进来，不引用别的项目）
//   ③ 项目素材：点两张卡的对勾 → 两张都选中；再点其中一张的对勾 → 取消
//   ④ 项目素材：拖一张到画布 → 多一张卡（复制）；拖到文件夹 → 归进文件夹
//   ⑤ 项目素材：点对勾选两张 → 删除按钮计数 2 → 确认 → 两张都没了
// 用法: pnpm build && node tests/ux/asset-library-interactions.walk.mjs [--locale en]
// 判据 = 断言 + 截图（tests/ux/shots/asset-library-interactions-<locale>/）人眼过。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'

const require = createRequire(import.meta.url)
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path

const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'zh-CN'
const shotsDir = path.join(repoRoot, `tests/ux/shots/asset-library-interactions-${locale}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-asset-interactions-'))
const projectsDir = path.join(tempRoot, 'projects')

const localUrl = (projectId, relative) =>
  `nomi-local://asset/${encodeURIComponent(projectId)}/${relative.split('/').map(encodeURIComponent).join('/')}`

const { assets: realMedia } = requireRealMediaAssets(['video-ai-shot-640x360', 'image-ai-shot-frame-png'])
const realVideo = realMedia.get('video-ai-shot-640x360').file

/** 写一个项目：真实镜头 + 若干抽帧进 assets/imported；可选在画布上放一张引用第一帧的卡。 */
function writeProject({ id, name, frames, withCanvasNode }) {
  const root = path.join(projectsDir, `walk-${id}`)
  const importedDir = path.join(root, 'assets', 'imported')
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  fs.mkdirSync(importedDir, { recursive: true })
  fs.copyFileSync(realVideo, path.join(importedDir, `${id}-shot.mp4`))
  const files = frames.map(({ name: fileName, at }) => {
    const relative = `assets/imported/${fileName}`
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', realVideo, '-frames:v', '1', path.join(root, relative)], { stdio: 'pipe' })
    return { relative, url: localUrl(id, relative) }
  })
  const nodes = withCanvasNode
    ? [{
        id: `${id}-node-1`, kind: 'image', title: '画布上的卡', prompt: '', categoryId: 'shots', references: [], runs: [],
        status: 'success', position: { x: 520, y: 160 }, size: { width: 320, height: 180 },
        result: { id: `${id}-r1`, type: 'image', url: files[0].url, createdAt: 1 },
        history: [{ id: `${id}-r1`, type: 'image', url: files[0].url, createdAt: 1 }],
        meta: { imageWidth: 640, imageHeight: 360, imageAspectRatio: 640 / 360 },
      }]
    : []
  const now = Date.now()
  const record = {
    id, name, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
    payload: {
      timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [] },
      generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] },
    },
  }
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify(record, null, 1))
  // 一个空文件夹，给「拖到文件夹归类」那一步用。
  fs.writeFileSync(path.join(root, '.nomi', 'folders.json'), JSON.stringify({ version: 1, folders: [{ id: 'folder-cast', label: locale === 'en' ? 'Cast' : '角色', order: 0 }], assignments: {} }))
  return { id, name, root, files }
}

const projectB = writeProject({ id: 'walk-asset-b', name: locale === 'en' ? 'Last project' : '上一个项目', frames: [{ name: 'b-city.png', at: '3.7' }], withCanvasNode: false })
const projectA = writeProject({
  id: 'walk-asset-a',
  name: locale === 'en' ? 'Asset interactions' : '素材交互验收',
  frames: [{ name: 'a-hero.png', at: '0.5' }, { name: 'a-street.png', at: '1.3' }, { name: 'a-night.png', at: '2.1' }, { name: 'a-spare.png', at: '2.9' }],
  withCanvasNode: true,
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
}
/** 「不存在」断言走共享的 expectAbsent（先证明同一个探针找得到活的那张），失败记一条而不是中断整条走查。 */
async function checkAbsent(name, locator, proof, message) {
  try {
    await expectAbsent(locator, { provenBy: proof, message })
    check(name, true)
  } catch (error) {
    check(name, false, String(error?.message || error).split('\n')[0])
  }
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }).catch((e) => console.log(`  [snap-fail] ${name}: ${e.message}`))
  console.log(`  [shot] ${name}`)
}

// 画布开着 onlyRenderVisibleElements：视口外的卡不进 DOM。先「适应视图」把全部卡收进视口再数。
const canvasNodeCount = async (page) => {
  await page.locator(`button[aria-label="${locale === 'en' ? 'Fit view' : '适应视图'}"]`).first().click().catch(() => {})
  await page.waitForTimeout(600)
  return page.locator('.react-flow__node').count()
}
const canvasNodeUrls = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.react-flow__node img, .react-flow__node video')].map((el) => el.getAttribute('src') || ''))

let app
let win
try {
  ;({ app, win } = await launchNomiApp({
    name: `asset-library-interactions-${locale}`,
    tempRoot,
    projectsDir,
    settleMs: 0,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: {
      'nomi:locale:v1': locale,
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      __nomiE2E: '1',
    },
    args: ['--no-proxy-server'],
  }))
  const consoleErrors = []
  const watch = (page) => page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })

  await win.locator('[data-project-card]', { hasText: projectA.name }).first().click({ timeout: stationTimeout() })
  await win.waitForTimeout(500)
  for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  watch(win)
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout() })
  const stage = win.locator('.react-flow__pane').first()
  if (!(await stage.isVisible().catch(() => false))) await win.locator('.nomi-stepper__step[data-mode="generation"]').first().click()
  await stage.waitFor({ state: 'visible', timeout: stationTimeout() })

  // 侧栏「素材库」
  const assetRail = win.locator(`aside nav button[aria-label="${locale === 'en' ? 'Asset library' : '素材库'}"]`).first()
  await assetRail.click()
  await win.waitForTimeout(1200)
  await snap(win, '01-all-assets')

  const tile = (name) => win.locator(`[role="button"][aria-label="${name}"]`).first()
  const dropPoint = async (dx, dy) => {
    const box = await stage.boundingBox()
    return { x: Math.round(box.width * dx), y: Math.round(box.height * dy) }
  }

  // ① 全部素材：当前项目的图 → 画布
  const before1 = await canvasNodeCount(win)
  await tile('a-street.png').dragTo(stage, { targetPosition: await dropPoint(0.55, 0.3) })
  await win.waitForTimeout(1200)
  const after1 = await canvasNodeCount(win)
  check('① 全部素材：当前项目图拖到画布多一张卡', after1 === before1 + 1, `${before1} → ${after1}`)
  await snap(win, '02-all-tab-drag-current-project')

  // ② 全部素材：别的项目的图 → 画布（复制进当前项目）
  const before2 = await canvasNodeCount(win)
  await tile('b-city.png').dragTo(stage, { targetPosition: await dropPoint(0.75, 0.55) })
  await win.waitForTimeout(2500)
  const after2 = await canvasNodeCount(win)
  const urls2 = await canvasNodeUrls(win)
  check('② 全部素材：别的项目的图拖到画布多一张卡', after2 === before2 + 1, `${before2} → ${after2}`)
  check('② 新卡指向当前项目自己的文件（复制进来）', urls2.some((url) => url.includes(encodeURIComponent(projectA.id)) && /b-city/.test(decodeURIComponent(url))) && !urls2.some((url) => url.includes(encodeURIComponent(projectB.id))), urls2.map((url) => decodeURIComponent(url).slice(-60)).join(' | '))
  const copiedIntoA = fs.readdirSync(path.join(projectA.root, 'assets'), { recursive: true }).some((file) => /b-city/.test(String(file)))
  check('② B 的文件真的复制进了 A 的项目目录', copiedIntoA)
  await snap(win, '03-all-tab-drag-other-project')

  // ③ 项目素材：点对勾多选 + 再点取消
  await win.locator('[role="tab"]', { hasText: locale === 'en' ? 'Project assets' : '项目素材' }).first().click()
  await win.waitForTimeout(1000)
  await snap(win, '04-project-tab')
  // 对勾在卡片右上角：像用户一样点那个位置（改前它只是装饰，改后它是开关）。
  const clickTick = async (name) => {
    const box = await tile(name).boundingBox()
    await win.mouse.click(box.x + box.width - 16, box.y + 16)
  }
  const selectedCount = () => win.locator('[aria-selected="true"][role="button"]').count()
  // 项目素材按地址去重、画布上的名字优先：a-hero.png 在这里叫「画布上的卡」，a-street.png 被①拖上画布后叫 a-street。
  const VIDEO = 'walk-asset-a-shot.mp4'
  await tile('a-night.png').hover()
  await clickTick('a-night.png')
  await tile(VIDEO).hover()
  await clickTick(VIDEO)
  await win.waitForTimeout(300)
  check('③ 点两张卡的对勾：两张都选中', (await selectedCount()) === 2, `selected=${await selectedCount()}`)
  const deleteButton = win.locator('button', { has: win.locator('svg.tabler-icon-trash') }).filter({ hasText: /\d/ }).first()
  check('③ 删除钮计数 2', ((await deleteButton.textContent()) ?? '').trim() === '2', `text=${(await deleteButton.textContent())?.trim()}`)
  await snap(win, '05-project-tab-two-selected')
  const selectedTile = (name) => win.locator(`[aria-selected="true"][role="button"][aria-label="${name}"]`)
  // 基线：同一个「已选中」探针此刻找得到这张视频卡，后面「它不在已选中里」才不是空话。
  const videoSelectedProof = await proveProbe(selectedTile(VIDEO), '点过对勾的视频卡处于已选中')
  await clickTick(VIDEO)
  await checkAbsent('③ 再点对勾：这一张取消选中', selectedTile(VIDEO), videoSelectedProof, '再点对勾后这张视频卡不该还在已选中里')
  check('③ 另一张仍然选中（只取消点的那一张）', (await selectedTile('a-night.png').count()) === 1)
  await snap(win, '06-project-tab-toggle-off')

  // ④ 项目素材：拖到画布 = 复制一张卡；拖到文件夹 = 归类
  const before4 = await canvasNodeCount(win)
  await tile('a-night.png').dragTo(stage, { targetPosition: await dropPoint(0.6, 0.75) })
  await win.waitForTimeout(1200)
  const after4 = await canvasNodeCount(win)
  check('④ 项目素材：拖到画布多一张卡', after4 === before4 + 1, `${before4} → ${after4}`)
  await snap(win, '07-project-tab-drag-to-canvas')
  const folder = win.locator('[role="button"]', { hasText: locale === 'en' ? 'Cast' : '角色' }).first()
  await tile('a-street').dragTo(folder)
  await win.waitForTimeout(1200)
  const folderText = (await folder.textContent()) ?? ''
  check('④ 项目素材：拖到文件夹归类', /1\s*$/.test(folderText.trim()), `folder=${folderText.trim()}`)
  await snap(win, '08-project-tab-drag-to-folder')

  // ⑤ 多选删除：选两张 → 删两张
  await win.keyboard.press('Escape').catch(() => {})
  // 删两张只在项目里、没上过画布的素材（上过画布的那张删除＝删卡上的结果，文件另算，是既有语义）。
  for (const name of ['a-spare.png', VIDEO]) {
    await tile(name).hover()
    if (!(await selectedTile(name).count())) await clickTick(name)
  }
  await win.waitForTimeout(300)
  const beforeDeleteSelected = await selectedCount()
  check('⑤ 点对勾选中两张待删', beforeDeleteSelected === 2, `selected=${beforeDeleteSelected}`)
  // 基线：删除前同一个格子探针找得到这两张。
  const spareProof = await proveProbe(tile('a-spare.png'), '删除前项目素材里有 a-spare.png')
  const videoProof = await proveProbe(tile(VIDEO), '删除前项目素材里有这条视频')
  await deleteButton.click()
  await win.waitForTimeout(500)
  await snap(win, '09-confirm-delete-two')
  await win.locator('[role="dialog"] button, [role="alertdialog"] button', { hasText: locale === 'en' ? 'Delete' : '删除' }).last().click()
  await checkAbsent('⑤ 删两张：a-spare.png 没了', tile('a-spare.png'), spareProof, '确认删除后 a-spare.png 不该还在')
  await checkAbsent('⑤ 删两张：视频也没了', tile(VIDEO), videoProof, '确认删除后这条视频不该还在')
  await snap(win, '10-after-delete-two')
} catch (error) {
  console.log(`  FAIL walk crashed: ${error?.stack || error}`)
  results.push({ name: 'crash', ok: false })
  if (win) await snap(win, '99-crash')
} finally {
  await app?.close().catch(() => {})
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed · shots: ${path.relative(repoRoot, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
