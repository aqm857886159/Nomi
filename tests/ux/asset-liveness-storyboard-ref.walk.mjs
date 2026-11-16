// 「挂在分镜参考上的生成结果，删掉产出它的那一版、关项目后，文件不能进回收站」真窗口走查
// （合同 docs/fixes/2026-11-17-asset-liveness-scan.root-cause.json；设计卡 docs/plan/2026-11-17-asset-liveness-scan.md 验收第 10 条）。
//
// 创作者的流程，全部真手势：
//   ① 打开分镜，在镜头 1 的参考格点「+」，从选择器的「画布」一栏选这张生成结果；
//   ② 回画布，铺开那个节点的版本卡，删掉产出它的那一版（不弹确认，提示条给撤销）；
//   ③ 顶栏项目菜单 → 回项目库（关项目：撤销窗口在这一刻结束，延后回收在这里释放）；
//   ④ 断言：文件还在原路径、没进回收站；
//   ⑤ 重开项目 → 分镜 → 镜头 1 的参考图能显示（图片真的解码出像素）。
// 修前（只认画布结果 / 白板 / 时间轴的那版判定）③ 之后文件被移进回收站，④ 红；修后绿。
//
// 不碰这台电脑真实的回收站：macOS 上项目放在一次性的小磁盘映像卷上（它自己的废纸篓 <卷>/.Trashes/<uid>），
// 修前那一跑文件就是进了那里，走查顺带把它记进观察；收尾卸载，映像随临时根删掉。CI 的 runner 用完即毁照跑；
// 其它系统本机跑没有一次性回收站，明着 SKIP。资料目录隔离（launchNomiApp 的 tempRoot），不连任何供应商。
//
// 用法：pnpm build && node tests/ux/asset-liveness-storyboard-ref.walk.mjs   （只跑 zh 一轨）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { backToLibrary, canvasFitViewButton, switchGenerationView, switchWorkspace } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const NAME = 'asset-liveness-storyboard-ref'
const outDir = path.join(repoRoot, 'tests/ux/shots', NAME, 'zh-CN')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const tempRoot = makeTempDir('nomi-asset-liveness-')
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' })

function attachDisposableVolume() {
  if (process.platform !== 'darwin') return null
  const name = `NomiLivenessWalk-${process.pid}`
  const mount = `/Volumes/${name}`
  const image = path.join(tempRoot, 'trash-volume')
  run('hdiutil', ['create', '-size', '64m', '-fs', 'APFS', '-volname', name, '-type', 'SPARSE', image])
  run('hdiutil', ['attach', '-nobrowse', '-owners', 'on', '-mountpoint', mount, `${image}.sparseimage`])
  return { mount, trashDir: path.join(mount, '.Trashes', String(process.getuid())) }
}
if (process.platform !== 'darwin' && !process.env.CI) {
  console.log('SKIP 本机没有一次性回收站（非 macOS 且不在 CI）：修前那一跑会往这台电脑的回收站里放测试文件')
  process.exit(0)
}
const volume = attachDisposableVolume()
let volumeAttached = Boolean(volume)
function detachDisposableVolume() {
  if (!volumeAttached) return
  for (const args of [[], ['-force'], ['-force']]) {
    try { run('hdiutil', ['detach', ...args, volume.mount]); volumeAttached = false; return } catch (error) { console.log(`  [cleanup] 映像卷卸载重试：${String(error?.message || error).split('\n')[0]}`) }
  }
  console.log(`  [cleanup] 映像卷没能卸载，请手动 hdiutil detach -force ${volume.mount}`)
}
process.once('exit', detachDisposableVolume)
const binned = () => (volume && fs.existsSync(volume.trashDir) ? fs.readdirSync(volume.trashDir).filter((name) => name !== '.DS_Store') : [])

// ── 项目夹具：一个图片节点两版生成结果（第 2 版是主图，就是要挂到分镜上、再删掉的那一版），一份分镜方案。
const projectsDir = volume ? path.join(volume.mount, 'projects') : path.join(tempRoot, 'projects')
const projectId = 'asset-liveness-walk'
const projectRoot = path.join(projectsDir, projectId)
const PROJECT_NAME = '存活判定走查'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
const relativeOf = (version) => `assets/generated/liveness-v${version}.jpg`
fs.copyFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-3.jpg'), path.join(projectRoot, relativeOf(1)))
fs.copyFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'), path.join(projectRoot, relativeOf(2)))
const targetFile = path.join(projectRoot, relativeOf(2))
const urlOf = (version) => `nomi-local://asset/${projectId}/${relativeOf(version)}`
const result = (version) => ({ id: `liveness-r${version}`, type: 'image', url: urlOf(version), thumbnailUrl: urlOf(version), previewState: 'ready', versionNo: version, createdAt: version })
const sourceNode = {
  id: 'liveness-node', kind: 'image', title: '雨夜巷口', prompt: '雨夜巷口，霓虹倒影', categoryId: 'shots', references: [], runs: [],
  result: result(2), history: [result(2), result(1)], status: 'success',
  position: { x: 120, y: 120 }, size: { width: 320, height: 180 }, meta: { imageWidth: 320, imageHeight: 180, imageAspectRatio: 16 / 9 },
}
// APIMart 内置目录里的 Seedance 2.0「图生视频」有一个 image_ref 参考槽 → 镜头行的参考格有「+」。不生成、不连供应商。
const shot = { index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '雨夜巷口，镜头缓推', modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', modeId: 'i2v' }
const plan = { title: PROJECT_NAME, anchors: [], shots: [shot] }
const project = {
  id: projectId, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: PROJECT_NAME, updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜巷口' }] }] } }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [sourceNode], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: 'sb-liveness', documentId: 'doc-1', title: PROJECT_NAME, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}
const readSaved = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))

const observations = { targetFile }
let launched
let win
const shotPng = (label) => screenshotSettled(win, { path: path.join(outDir, `${label}.png`) })

async function openProject() {
  await win.getByText(PROJECT_NAME, { exact: false }).first().hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作/ }).first(), '项目库：继续创作')
  await expectVisible(win.locator('[data-shell-topbar]'), '打开项目后顶栏可见')
}
const row = () => win.locator('[data-storyboard-row="1"]').first()

try {
  launched = await launchNomiApp({
    name: NAME, tempRoot, projectsDir, settleMs: 0, viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
    args: ['--no-proxy-server'],
  })
  win = launched.win
  await openProject()

  // ① 分镜镜头 1 的参考格「+」→ 选择器「画布」一栏 → 选第 2 版（主图）。
  await switchWorkspace(win, 'creation')
  await openStoryboardEditor(win)
  await clickOrFail(row().locator('[data-storyboard-ref-add] [data-asset-add-tile]').first(), '镜头 1 参考格的「+」')
  const picker = win.locator('[data-testid="asset-picker"]').last()
  await expectVisible(picker, '参考选择器打开')
  const pick = picker.locator('button', { has: win.locator(`img[src*="liveness-v2"]`) }).first()
  await clickOrFail(pick, '选择器里点这张生成结果')
  const thumb = row().locator('[data-storyboard-ref-thumb] img').first()
  await expect.poll(() => thumb.evaluate((img) => img.complete && img.naturalWidth > 0), { message: '镜头 1 的参考图挂上并显示', timeout: stationTimeout() }).toBe(true)
  observations.boundSrc = await thumb.getAttribute('src')
  await shotPng('01-storyboard-ref-attached')

  // ② 回画布，铺开版本卡，删掉第 2 版。
  await switchWorkspace(win, 'generation')
  await switchGenerationView(win, 'canvas')
  await clickOrFail(canvasFitViewButton(win), '画布适配视图')
  const node = win.locator('.generation-canvas-v2-node[data-node-id="liveness-node"]').first()
  await clickOrFail(node.locator('[data-version-badge]'), '点节点角标铺开版本卡')
  const card = win.locator('[data-version-grid="liveness-node"] [data-version-identity="liveness-r2"]')
  const cardProof = await proveProbe(card, '第 2 版卡片铺在画布上')
  await card.hover()
  await clickOrFail(card.locator('[data-toolbar-action="delete"]'), '删除第 2 版')
  await expectAbsent(card, { provenBy: cardProof, message: '删除后第 2 版从宫格里消失' })
  await shotPng('02-version-deleted')
  observations.existsRightAfterDelete = fs.existsSync(targetFile)

  // ③ 关项目：回项目库。延后回收在这一刻释放；等写盘把待删清单清掉（释放完成的信号），最多一个站点预算。
  await backToLibrary(win, { label: '关项目：回项目库' })
  await expect.poll(() => {
    const pending = readSaved().payload?.pendingAssetDeletions
    return !Array.isArray(pending) || !pending.some((entry) => String(entry?.relativePath || entry?.url || '').includes('liveness-v2'))
  }, { message: '关项目后待删清单释放完', timeout: stationTimeout() }).toBe(true)
  // 释放是异步的回收站调用：清单落盘后再给它一点时间真的动文件（修前就是这一步把文件移走）。
  await win.waitForTimeout(1500)

  // ④ 文件还在原路径，没进回收站。
  observations.existsAfterClose = fs.existsSync(targetFile)
  observations.binnedAfterClose = binned()
  await shotPng('03-closed-back-to-library')
  expect(observations.binnedAfterClose, '关项目后被分镜参考用着的文件进了回收站').toEqual([])
  expect(observations.existsAfterClose, '关项目后被分镜参考用着的文件不在原路径').toBe(true)

  // ⑤ 重开 → 分镜 → 参考图能显示。
  await openProject()
  await switchWorkspace(win, 'creation')
  await openStoryboardEditor(win, { pick: 'first' }, '重开后打开分镜')
  const reopened = row().locator('[data-storyboard-ref-thumb] img').first()
  await expect.poll(() => reopened.evaluate((img) => img.complete && img.naturalWidth > 0), { message: '重开后镜头 1 的参考图能显示', timeout: stationTimeout() }).toBe(true)
  observations.reopenedSrc = await reopened.getAttribute('src')
  await shotPng('04-reopened-storyboard-ref')
  console.log('PASS 分镜参考挂着的生成结果：删掉那一版、关项目后文件仍在原路径，重开参考图能显示', JSON.stringify(observations))
} catch (error) {
  observations.error = String(error?.stack || error)
  observations.existsAtFailure = fs.existsSync(targetFile)
  observations.binnedAtFailure = binned()
  console.error(observations.error)
  process.exitCode = 1
  if (win) await shotPng('99-failed').catch(() => {})
} finally {
  fs.writeFileSync(path.join(outDir, 'observations.json'), JSON.stringify(observations, null, 2))
  await launched?.close().catch(() => {})
  detachDisposableVolume()
}
