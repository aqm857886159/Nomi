import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 验收走查（素材库交互回归 · 2026-09-25 用户原话「拖不出图片和视频来了；项目素材只能点击一个删除，
// 点击对勾无法取消，拖出也无法复制」）。
//
// 两个项目（都放登记过的真实镜头 + 抽帧）：当前项目 A、上一个项目 B。冷启动从项目库卡片打开 A，
// 全程真实鼠标（Playwright 驱动 Chromium 原生 HTML5 拖放），验：
//   ① 全部素材：当前项目的图拖到画布 → 多一张卡
//   ② 全部素材：B 项目的图拖到画布 → 多一张卡，且卡上的地址已经是 A 项目自己的文件（复制进来，不引用别的项目）
//   ③ 项目素材：点两张卡的对勾 → 两张都选中；再点其中一张的对勾 → 取消
//   ④ 项目素材：拖一张到画布 → 多一张卡（复制）；拖到文件夹 → 归进文件夹
//   ⑤ 项目素材：点对勾选两张 → 删除按钮计数 2 → 确认 → 两张都没了（两个页签都不列；文件真进了回收站）
//   ⑥ 项目素材：删画布上那张卡的素材 → 两个页签都不再列（文件等撤销窗口过去才进回收站，这期间也不许换个名字列回来）
//   ⑦ 项目素材：删一张只被时间轴片段用着的图 → 留着，顶上说还在用、先从那里移除（2026-10-24 之前说「暂时无法删除」）
// 用法: pnpm build && node tests/ux/asset-library-interactions.walk.mjs [--locale en] [--scheme dark]
// 判据 = 断言 + 截图（tests/ux/shots/asset-library-interactions-<locale>/）人眼过。
//
// ⑤⑥ 真删：文件进系统回收站（shell.trashItem）。走查不许往跑它的这台电脑的回收站里塞测试垃圾（协调 10-23，
// tests/system/walks-never-trash-projects.test.mjs 登记了本走查）：macOS 上两个测试项目放在一个一次性的小磁盘映像卷上——
// 那个卷有自己的废纸篓（<卷>/.Trashes/<uid>），走查顺带核对文件真进了回收站；收尾卸载，映像随临时根删掉。
// CI 上照跑（runner 用完即毁）；其它系统在本机跑没有一次性的回收站，⑤⑥ 跳过并明着打 SKIP。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { canvasFitViewButton, openRailDrawer, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const require = createRequire(import.meta.url)
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path

const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'zh-CN'
// 两个页签的名字按键从词典取（不抄文案）。
const PROJECT_TAB = uiText(locale, 'assetLibrary.projectAssets')
const ALL_TAB = uiText(locale, 'assetLibrary.allAssets')
// 明 / 暗：走生产路径（用户偏好 nomi-color-scheme），默认明；暗色截图另放一个目录。
const scheme = process.argv.includes('--scheme') ? process.argv[process.argv.indexOf('--scheme') + 1] : 'light'
if (scheme !== 'light' && scheme !== 'dark') throw new Error(`--scheme 只认 light / dark，收到 ${scheme}`)
const runName = `asset-library-interactions-${locale}${scheme === 'dark' ? '-dark' : ''}`
const shotsDir = process.env.WALK_OUT_DIR || path.join(repoRoot, `tests/ux/shots/${runName}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
if (process.env.WALK_OUT_DIR) process.chdir(shotsDir)

const tempRoot = makeTempDir('nomi-asset-interactions-')
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' })
/** macOS：一次性的小磁盘映像卷当项目所在的盘（它自己的废纸篓）；其它系统 null。 */
function attachDisposableVolume() {
  if (process.platform !== 'darwin') return null
  const name = `NomiAssetWalk-${process.pid}`
  const mount = `/Volumes/${name}`
  const image = path.join(tempRoot, 'trash-volume')
  run('hdiutil', ['create', '-size', '64m', '-fs', 'APFS', '-volname', name, '-type', 'SPARSE', image])
  run('hdiutil', ['attach', '-nobrowse', '-owners', 'on', '-mountpoint', mount, `${image}.sparseimage`])
  return { mount, trashDir: path.join(mount, '.Trashes', String(process.getuid())) }
}
const volume = attachDisposableVolume()
let volumeAttached = Boolean(volume)
function detachDisposableVolume() {
  if (!volumeAttached) return
  for (const args of [[], ['-force'], ['-force']]) {
    try {
      run('hdiutil', ['detach', ...args, volume.mount])
      volumeAttached = false
      return
    } catch (error) {
      console.log(`  [cleanup] 映像卷卸载重试：${String(error?.message || error).split('\n')[0]}`)
    }
  }
  console.log(`  [cleanup] 映像卷没能卸载，请手动 hdiutil detach -force ${volume.mount}`)
}
// 走查中途崩了也要卸载（临时根在进程退出时删，映像文件跟着走）。
process.once('exit', detachDisposableVolume)
/** 真删会不会进这台电脑真实的回收站：有一次性映像卷、或在 CI 的一次性 runner 上，才跑 ⑤⑥ 的真删。 */
const disposableTrash = Boolean(volume) || Boolean(process.env.CI)
const binned = () => (volume && fs.existsSync(volume.trashDir) ? fs.readdirSync(volume.trashDir).filter((name) => name !== '.DS_Store') : [])
const projectsDir = volume ? path.join(volume.mount, 'projects') : path.join(tempRoot, 'projects')

const localUrl = (projectId, relative) =>
  `nomi-local://asset/${encodeURIComponent(projectId)}/${relative.split('/').map(encodeURIComponent).join('/')}`

const { assets: realMedia } = requireRealMediaAssets(['video-ai-shot-640x360', 'image-ai-shot-frame-png'])
const realVideo = realMedia.get('video-ai-shot-640x360').file

/**
 * 写一个项目：真实镜头 + 若干抽帧进 assets/imported；可选在画布上放一张引用第一帧的卡；
 * 可选把某一帧放上时间轴图片轨（和从素材库加到时间轴同款：sourceNodeId = asset:<相对路径>），画布上不放它。
 */
function writeProject({ id, name, frames, withCanvasNode, onTimeline }) {
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
  const timelineFile = onTimeline ? files.find((file) => file.relative.endsWith(`/${onTimeline}`)) : null
  const tracks = timelineFile
    ? [{
        id: 'imageTrack', type: 'image', label: 'image',
        clips: [{
          id: `clip-asset:${timelineFile.relative}-image-0`, type: 'image', sourceNodeId: `asset:${timelineFile.relative}`, label: onTimeline,
          startFrame: 0, endFrame: 90, frameCount: 90, offsetStartFrame: 0, offsetEndFrame: 0, url: timelineFile.url,
        }],
      }]
    : []
  const now = Date.now()
  const record = {
    id, name, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
    payload: {
      timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks },
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
  frames: [{ name: 'a-hero.png', at: '0.5' }, { name: 'a-street.png', at: '1.3' }, { name: 'a-night.png', at: '2.1' }, { name: 'a-spare.png', at: '2.9' }, { name: 'a-onclip.png', at: '1.7' }],
  withCanvasNode: true,
  onTimeline: 'a-onclip.png',
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
  await canvasFitViewButton(page).click().catch(() => {})
  await page.waitForTimeout(600)
  return page.locator('.react-flow__node').count()
}
const canvasNodeUrls = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.react-flow__node img, .react-flow__node video')].map((el) => el.getAttribute('src') || ''))

let app
let win
try {
  ;({ app, win } = await launchNomiApp({
    name: runName,
    tempRoot,
    projectsDir,
    settleMs: 0,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: {
      'nomi:locale:v1': locale,
      'nomi-color-scheme': scheme,
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      __nomiE2E: '1',
    },
    args: ['--no-proxy-server'],
  }))

  await win.locator('[data-project-card]', { hasText: projectA.name }).first().click({ timeout: stationTimeout() })
  await win.waitForTimeout(500)
  for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout() })
  const stage = win.locator('.react-flow__pane').first()
  if (!(await stage.isVisible().catch(() => false))) await switchWorkspace(win, 'generation')
  await stage.waitFor({ state: 'visible', timeout: stationTimeout() })

  // 侧栏「素材库」
  await openRailDrawer(win, 'assets', '侧栏「素材库」')
  await win.waitForTimeout(1200)
  await snap(win, '01-all-assets')

  const tile = (name) => win.locator(`[role="button"][aria-label="${name}"]`).first()
  const dropPoint = async (dx, dy) => {
    const box = await stage.boundingBox()
    return { x: Math.round(box.width * dx), y: Math.round(box.height * dy) }
  }

  const clickTick = async (name) => {
    const box = await tile(name).boundingBox()
    await win.mouse.click(box.x + box.width - 16, box.y + 16)
  }
  const selectedCount = () => win.locator('[aria-selected="true"][role="button"]').count()
  const VIDEO = 'walk-asset-a-shot.mp4'
  const deleteButton = win.locator('button', { has: win.locator('svg.tabler-icon-trash') }).filter({ hasText: /\d/ }).first()
  const selectedTile = (name) => win.locator(`[aria-selected="true"][role="button"][aria-label="${name}"]`)
  if (!process.env.NOMI_WALK_DELETE_ONLY) {
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
  await win.locator('[role="tab"]', { hasText: PROJECT_TAB }).first().click()
  await win.waitForTimeout(1000)
  await snap(win, '04-project-tab')
  // 对勾在卡片右上角：像用户一样点那个位置（改前它只是装饰，改后它是开关）。
  await tile('a-night.png').hover()
  await clickTick('a-night.png')
  await tile(VIDEO).hover()
  await clickTick(VIDEO)
  await win.waitForTimeout(300)
  check('③ 点两张卡的对勾：两张都选中', (await selectedCount()) === 2, `selected=${await selectedCount()}`)
  check('③ 删除钮计数 2', ((await deleteButton.textContent()) ?? '').trim() === '2', `text=${(await deleteButton.textContent())?.trim()}`)
  await snap(win, '05-project-tab-two-selected')
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

  }

  const confirmDelete = () => win.locator('[role="dialog"] button, [role="alertdialog"] button', { hasText: locale === 'en' ? 'Delete' : '删除' }).last().click()
  // 确认框关掉的过场里内容已经清空：等它整个退场再拍「删完以后」，截图里留的是稳定的结果。
  const confirmDialogGone = () => win.locator('[data-confirm-dialog-cancel]').first().waitFor({ state: 'hidden', timeout: stationTimeout() })
  const feedbackLine = win.locator('[data-asset-library-feedback]').first()
  const importedFile = (name) => path.join(projectA.root, 'assets', 'imported', name)

  // ⑤ 多选删除：选两张 → 删两张
  await win.keyboard.press('Escape').catch(() => {})
  // Esc 同时是外壳抽屉的收起键：抽屉被收起了就重开（抽屉是浮层，读完要重开，别假设它常驻）。
  await openRailDrawer(win, 'assets', '重开素材库抽屉')
  if (!disposableTrash) {
    console.log('  SKIP ⑤⑥ 真删：这台机器上删掉的文件会进你真实的回收站（只有 macOS 的一次性映像卷 / CI 的一次性 runner 才跑）')
  } else {
    // 重开后抽屉回到默认的「全部素材」页签：删之前先证明这两张在这里也列着，删完要两个页签都不列。
    const spareAllProof = await proveProbe(tile('a-spare.png'), '删除前全部素材里有 a-spare.png')
    const videoAllProof = await proveProbe(tile(VIDEO), '删除前全部素材里有这条视频')
    await win.locator('[role="tab"]', { hasText: PROJECT_TAB }).first().click()
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
    await confirmDelete()
    await checkAbsent('⑤ 删两张：a-spare.png 没了', tile('a-spare.png'), spareProof, '确认删除后 a-spare.png 不该还在')
    await checkAbsent('⑤ 删两张：视频也没了', tile(VIDEO), videoProof, '确认删除后这条视频不该还在')
    await confirmDialogGone()
    await snap(win, '10-after-delete-two')
    check('⑤ 两个文件已不在项目目录里', !fs.existsSync(importedFile('a-spare.png')) && !fs.existsSync(importedFile(VIDEO)))
    // 确认框说「落盘文件会移到系统回收站」：在一次性映像卷上核对它们真在回收站里（不是被永久删掉）。
    if (volume) check('⑤ 两个文件进了回收站（一次性映像卷的废纸篓）', ['a-spare.png', VIDEO].every((name) => binned().includes(name)), binned().join(', '))
    // 「全部素材」是另一份清单（所有项目扫盘）：删两张 = 两次删除广播紧挨着到，这一份也要刷新到删完以后。
    await win.locator('[role="tab"]', { hasText: ALL_TAB }).first().click()
    await checkAbsent('⑤ 全部素材里 a-spare.png 也没了', tile('a-spare.png'), spareAllProof, '删掉的 a-spare.png 不该还在全部素材里')
    await checkAbsent('⑤ 全部素材里视频也没了', tile(VIDEO), videoAllProof, '删掉的视频不该还在全部素材里')
    await snap(win, '10b-all-tab-after-delete-two')

    // ⑥ 删画布上那张卡的素材：画布结果摘掉（⌘Z 能撤），文件等撤销窗口过去才进回收站——这期间两个页签都不许把它列回来。
    const CANVAS_CARD = '画布上的卡'
    const HERO = 'a-hero.png'
    const heroProof = await proveProbe(tile(HERO), '删除前全部素材里有 a-hero.png')
    await win.locator('[role="tab"]', { hasText: PROJECT_TAB }).first().click()
    const cardProof = await proveProbe(tile(CANVAS_CARD), '删除前项目素材里有画布上那张卡')
    await tile(CANVAS_CARD).hover()
    await clickTick(CANVAS_CARD)
    await win.waitForTimeout(300)
    check('⑥ 只选中画布上那张卡', (await selectedCount()) === 1, `selected=${await selectedCount()}`)
    await deleteButton.click()
    await win.waitForTimeout(500)
    await confirmDelete()
    await checkAbsent('⑥ 删画布上的卡：项目素材里没了', tile(CANVAS_CARD), cardProof, '确认删除后画布那张卡的素材不该还在')
    await checkAbsent('⑥ 文件没有换成文件名回到项目素材', tile(HERO), heroProof, '删掉的素材不该以文件名 a-hero.png 回到项目素材')
    await confirmDialogGone()
    await snap(win, '11-after-delete-canvas-card')
    await win.locator('[role="tab"]', { hasText: ALL_TAB }).first().click()
    await checkAbsent('⑥ 全部素材里也没了', tile(HERO), heroProof, '删掉的素材不该还在全部素材里')
    await snap(win, '12-all-tab-after-delete-canvas-card')
  }

  // ⑦ 只被时间轴片段用着的图：不删、格子留着，顶上说还在用、先从那里移除。
  const ON_CLIP = 'a-onclip.png'
  await win.locator('[role="tab"]', { hasText: PROJECT_TAB }).first().click()
  await proveProbe(tile(ON_CLIP), '删除前项目素材里有 a-onclip.png')
  await tile(ON_CLIP).hover()
  await clickTick(ON_CLIP)
  await win.waitForTimeout(300)
  check('⑦ 只选中时间轴上那张图', (await selectedCount()) === 1, `selected=${await selectedCount()}`)
  await deleteButton.click()
  await win.waitForTimeout(500)
  await confirmDelete()
  const keptMessage = uiText(locale, 'assetLibrary.keptInUse_one')
  try {
    await expect(feedbackLine, '删一张时间轴在用的图，顶上要说还在用').toContainText(keptMessage, { timeout: stationTimeout() })
    check('⑦ 顶上说还在时间轴上用着', true, keptMessage)
  } catch (error) {
    check('⑦ 顶上说还在时间轴上用着', false, String(error?.message || error).split('\n')[0])
  }
  try {
    await expect(tile(ON_CLIP), '时间轴在用的图不该被删掉').toBeVisible({ timeout: stationTimeout() })
    check('⑦ 时间轴在用的图留着', true)
  } catch (error) {
    check('⑦ 时间轴在用的图留着', false, String(error?.message || error).split('\n')[0])
  }
  check('⑦ 文件还在盘上', fs.existsSync(importedFile(ON_CLIP)))
  await confirmDialogGone()
  await snap(win, '13-kept-in-use')
} catch (error) {
  console.log(`  FAIL walk crashed: ${error?.stack || error}`)
  results.push({ name: 'crash', ok: false })
  if (win) await snap(win, '99-crash')
} finally {
  await app?.close().catch(() => {})
  detachDisposableVolume()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed · shots: ${path.relative(repoRoot, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
