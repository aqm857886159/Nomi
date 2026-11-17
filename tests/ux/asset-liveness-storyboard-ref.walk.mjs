// 「挂在分镜参考上的生成结果，删掉产出它的那一版、关项目后，文件不能进回收站」真窗口走查
// （合同 docs/fixes/2026-11-17-asset-liveness-scan.root-cause.json；设计卡 docs/plan/2026-11-17-asset-liveness-scan.md 验收第 10 条）。
//
// 创作者的流程，全部真手势：
//   ① 打开分镜，在镜头 1 参考行点「+」，从参考选择器的「画布」一栏选这张生成结果；
//   ② 回画布，铺开那个节点的版本卡，删掉产出它的那一版（不弹确认，提示条给撤销）；
//   ③ 顶栏项目菜单 → 回项目库（关项目：撤销窗口在这一刻结束，延后回收在这里释放）；
//   ④ 断言：文件还在原路径、没进回收站；
//   ⑤ 退出应用，用同一份隔离资料、同一个映像卷重启 → 重开项目 → 分镜 → 参考小图能解码出像素（修前这里裂图）。
// 修前（只认画布结果 / 白板 / 时间轴的那版判定）③ 之后文件被移进回收站，④ 红；修后绿。
//
// 不碰这台电脑真实的回收站：macOS 上项目放在一次性的小磁盘映像卷上（它自己的废纸篓 <卷>/.Trashes/<uid>），
// 修前那一跑文件就是进了那里，走查顺带把它记进观察；收尾卸载，映像随临时根删掉。CI 的 runner 用完即毁照跑；
// 其它系统本机跑没有一次性回收站，明着 SKIP。资料目录隔离（launchNomiApp 的 tempRoot），不连任何供应商。
//
// 用法：pnpm build && node tests/ux/asset-liveness-storyboard-ref.walk.mjs
// NOMI_WALK_LANG=en 跑英文，NOMI_WALK_SPACE_PATH=1 把项目放进带空格的目录；WALK_OUT_DIR=<目录> 改截图位置。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { collapseAgentPanel, backToLibrary, canvasZoomPercent, openRailDrawer, canvasFitViewButton, canvasSetZoomPercent, switchGenerationView, switchWorkspace } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { CANVAS_PANEL, COMPOSER, expandResidentPanel } from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

const NAME = 'asset-liveness-storyboard-ref'
const oldBytes = process.env.NOMI_WALK_OLD_SOURCE ? fs.readFileSync(process.env.NOMI_WALK_OLD_SOURCE) : null
const oldProject = oldBytes ? JSON.parse(oldBytes) : null
const usage = process.env.NOMI_WALK_USAGE || 'storyboard'
if (!['storyboard', 'node', 'agent'].includes(usage)) throw new Error(`Unknown usage: ${usage}`)
const locale = process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'
const outDir = path.resolve(process.env.WALK_OUT_DIR || path.join(repoRoot, 'tests/ux/shots', NAME, locale))
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
// 共用观察器按 cwd 落证据，和本走查的截图一起收在 outDir。
process.chdir(outDir)
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
const projectsDir = path.join(volume?.mount ?? tempRoot, process.env.NOMI_WALK_SPACE_PATH === '1' ? 'projects with spaces' : 'projects')
const projectId = oldProject?.id || 'asset-liveness-walk'
const projectRoot = path.join(projectsDir, projectId)
const PROJECT_NAME = oldProject?.name || '存活判定走查'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
const relativeOf = (version) => `assets/generated/liveness-v${version}.jpg`
fs.copyFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-3.jpg'), path.join(projectRoot, relativeOf(1)))
fs.copyFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'), path.join(projectRoot, relativeOf(2)))
const targetFile = path.join(projectRoot, relativeOf(2))
const fileHash = () => fs.existsSync(targetFile) ? createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex') : null
const originalHash = fileHash()
const urlOf = (version) => `nomi-local://asset/${projectId}/${relativeOf(version)}`
const result = (version) => ({ id: `liveness-r${version}`, type: 'image', url: urlOf(version), thumbnailUrl: urlOf(version), previewState: 'ready', versionNo: version, createdAt: version })
const sourceNode = {
  id: 'liveness-node', kind: 'image', title: '雨夜巷口', prompt: '雨夜巷口，霓虹倒影', categoryId: 'shots', references: [], runs: [],
  result: result(2), history: [result(2), result(1)], status: 'success',
  position: { x: 120, y: 120 }, size: { width: 320, height: 180 }, meta: { imageWidth: 320, imageHeight: 180, imageAspectRatio: 16 / 9 },
}
// 镜头用即梦会员的 Seedance「全能参考」：这一家是内置的本地 CLI（不要钥匙），隔离资料里也在模型清单上；这个模式有 image_ref
// 参考槽 → 镜头行的「+」开的是参考选择器。APIMart 的模型在没连钥匙的隔离资料里不在清单上，镜头会没有可用模式，「+」只剩引用菜单、
// 也挂不上参考（协调 2026-11-17 第一跑就红在这里）。不生成、不调 CLI、不连供应商。
const shot = { index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '雨夜巷口，镜头缓推', modelKey: 'dreamina-seedance-2.0', modelVendor: 'dreamina', modeId: 'multimodal' }
const plan = { title: PROJECT_NAME, anchors: [], shots: [shot] }
const project = oldProject || {
  id: projectId, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: PROJECT_NAME, updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜巷口' }] }] } }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [sourceNode, ...(usage === 'node' ? [{ ...sourceNode, id: 'reference-node', kind: 'video', title: 'Reference consumer', result: undefined, history: [], position: { x: 120, y: 700 }, meta: { modelKey: 'dreamina-seedance-2.0', modelVendor: 'dreamina', archetype: { id: 'dreamina-seedance-2', modeId: 'multimodal' } } }] : [])], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: 'sb-liveness', documentId: 'doc-1', title: PROJECT_NAME, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, oldBytes || JSON.stringify(project, null, 2))
}
const readSaved = () => JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))

const observations = { targetFile, locale, usage }
const launches = []
let launched
let win
const shotPng = (label) => screenshotSettled(win, { path: path.join(outDir, `${label}.png`) })

async function startApp(executablePath) {
  launched = await launchNomiApp({
    name: NAME, tempRoot, projectsDir, ...(executablePath ? { executablePath } : {}), settleMs: 0, viewportSize: { width: 1280, height: 800 },
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
    env: { NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_NET_LOG: path.join(outDir, 'network.jsonl') },
    args: ['--no-proxy-server'],
  })
  launches.push(launched)
  await expect(launched.app.evaluate(() => globalThis.fetch('https://nomi-walk-canary.invalid/'))).rejects.toThrow('blocked by walkthrough network guard')
  win = launched.win
}

async function openProject() {
  await win.getByText(PROJECT_NAME, { exact: false }).first().hover()
  await clickOrFail(win.getByRole('button', { name: uiText(locale, 'library.continueCreating'), exact: true }).first(), '项目库：继续创作')
  await expectVisible(win.locator('[data-shell-topbar]'), '打开项目后顶栏可见')
}
const row = () => win.locator('[data-storyboard-row="1"]').first()
/** 项目文件里镜头 1 的参考绑定地址（所有槽展开）。 */
const boundUrls = () => {
  const designs = readSaved().payload?.storyboardDesignsByDocumentId?.['doc-1'] ?? []
  const bindings = designs[0]?.plan?.shots?.[0]?.referenceBindings ?? {}
  return Object.values(bindings).flatMap((value) => (Array.isArray(value) ? value : [value])).map((binding) => binding?.url).filter(Boolean)
}
/**
 * 在窗口里按创作者看到的同一个地址真的取一次文件并解码，能解出像素 = 参考图能显示；文件没了 = 裂图。
 * 不加缓存破坏参数（本地素材协议拒收任何查询串），改用不走缓存的 fetch，避免读到删前留在内存里的那份。
 */
const decodes = (url) => win.evaluate(async (src) => {
  try {
    const response = await fetch(src, { cache: 'no-store' })
    if (!response.ok) return false
    const bitmap = await createImageBitmap(await response.blob())
    const ok = bitmap.width > 0
    bitmap.close()
    return ok
  } catch {
    return false
  }
}, url)

try {
  await startApp()
  await openProject()

  if (oldProject) {
    await switchWorkspace(win, 'generation')
    await win.waitForTimeout(1500)
    observations.oldSourceHash = createHash('sha256').update(oldBytes).digest('hex')
    observations.oldPendingOnOpen = readSaved().payload.pendingAssetDeletions
    observations.oldFileOnOpen = fs.existsSync(targetFile)
    observations.oldTrashOnOpen = binned()
    expect(observations.oldFileOnOpen, 'Opening legacy pending retains original').toBe(true)
    expect(binned(), 'Legacy request has no recycling authority').toEqual([])
    expect(await decodes(urlOf(2)), 'Legacy original decodes after upgrade').toBe(true)
    await openRailDrawer(win, 'assets', 'Old project: project assets')
    await clickOrFail(win.getByRole('tab', { name: uiText(locale, 'assetLibrary.projectAssets'), exact: true }), 'Project assets')
    await expectVisible(win.getByRole('button', { name: /^liveness-v2/ }).first(), 'Legacy original appears in project assets')
    await shotPng('old-project-assets')
    await backToLibrary(win, { label: 'Save upgraded copy and close project' })
    const saved = readSaved()
    observations.oldPendingAfterSave = saved.payload.pendingAssetDeletions ?? []
    expect(observations.oldPendingAfterSave).toEqual([])
    fs.writeFileSync(path.join(outDir, 'old-copy.after-save.json'), JSON.stringify(saved, null, 2))
    await launched.app.close()
    await startApp(process.env.NOMI_WALK_COMPAT_APP)
    await openProject()
    observations.compatApp = process.env.NOMI_WALK_COMPAT_APP || 'current-build'
    observations.existsAfterCompatOpen = fs.existsSync(targetFile)
    observations.hashAfterCompatOpen = fileHash()
    expect(observations.existsAfterCompatOpen, 'Older build retains version original after new save').toBe(true)
    expect(observations.hashAfterCompatOpen).toBe(originalHash)
    expect(binned(), 'Older build does not replay removed legacy request').toEqual([])
    expect(await decodes(urlOf(2))).toBe(true)
    await shotPng('old-compat-reopened')
    console.log('PASS legacy 0.24.1 copy → current save → compatibility reopen', JSON.stringify(observations))
  } else {
  if (usage === 'storyboard') {
  // ① 镜头 1 参考行的「+」→ 参考选择器「画布」一栏 → 点画布上那张第 2 版（主图）→ 挂成这一镜的参考，行上出现小图。
  await switchWorkspace(win, 'creation')
  await openStoryboardEditor(win)
  await clickOrFail(row().locator('[data-storyboard-ref-add="own"] [data-asset-add-tile]').first(), '镜头 1 参考行的「+」')
  const picker = win.locator('[data-testid="asset-picker"]').last()
  await expectVisible(picker, '「+」打开参考选择器')
  await shotPng('00-picker-open')
  await clickOrFail(picker.locator('button', { has: win.locator('img[src*="liveness-v2"]') }).first(), '选择器「画布」一栏里点第 2 版')
  const thumb = row().locator('[data-storyboard-ref-thumb] img').first()
  await expect.poll(() => thumb.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), { message: '镜头 1 的参考小图挂上并显示', timeout: stationTimeout() }).toBe(true)
  await expect.poll(() => boundUrls().includes(urlOf(2)), { message: '镜头 1 的参考绑定写进了项目文件', timeout: stationTimeout() }).toBe(true)
  observations.boundAfterAttach = boundUrls()
  observations.decodedAfterAttach = await decodes(urlOf(2))
  expect(observations.decodedAfterAttach, '挂上后这张参考图能解码出像素').toBe(true)
  await shotPng('01-after-attach')

  } else {
    await switchWorkspace(win, 'generation')
    await switchGenerationView(win, 'canvas')
    await clickOrFail(canvasFitViewButton(win), 'Fit canvas')
    if (usage === 'node') {
      await clickOrFail(win.locator('.generation-canvas-v2-node[data-node-id="reference-node"]'), 'Select reference consumer')
      await clickOrFail(win.locator('.generation-canvas-v2-node__composer [data-reference-add-entry]').first(), 'Add node reference')
      const picker = win.locator('[data-testid="asset-picker"]').last()
      await clickOrFail(picker.locator('button', { has: win.locator('img[src*="liveness-v2"]') }).first(), 'Pick version 2')
      await win.keyboard.press('Escape')
    } else {
      await expandResidentPanel(win)
      await clickOrFail(win.locator(`${CANVAS_PANEL} [data-reference-entry]`), 'Pick assistant reference')
      await clickOrFail(win.locator('.generation-canvas-v2-node[data-node-id="liveness-node"]'), 'Attach source image')
      await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}`)).toContainText('雨夜巷口')
    }
    expect(await decodes(urlOf(2)), 'Attached image decodes').toBe(true)
    await shotPng('01-after-attach')
  }

  await collapseAgentPanel(win)
  // ② 回画布，铺开版本卡，删掉第 2 版。
  await switchWorkspace(win, 'generation')
  await switchGenerationView(win, 'canvas')
  await clickOrFail(canvasFitViewButton(win), '画布适配视图')
  const node = win.locator('.generation-canvas-v2-node[data-node-id="liveness-node"]').first()
  await win.waitForTimeout(500) // Let the fit-view animation finish before setting a different zoom.
  await clickOrFail(node.locator('[data-version-badge]'), '点节点角标铺开版本卡')
  const card = win.locator('[data-version-grid="liveness-node"] [data-version-identity="liveness-r2"]')
  const cardProof = await proveProbe(card, '第 2 版卡片铺在画布上')
  // 画布上只有这一个节点，适配视图会放到两倍多；铺开后宫格比视口大，卡片工具条压在顶栏下面。像创作者一样缩小到整张宫格进视口。
  await canvasSetZoomPercent(win, 60, '铺开后缩小到 60%')
  await expect.poll(() => canvasZoomPercent(win), { timeout: stationTimeout() }).toBe(60)
  await card.hover()
  await shotPng('02-before-version-delete')
  await clickOrFail(card.locator('[data-toolbar-action="delete"]'), '删除第 2 版')
  await expectAbsent(card, { provenBy: cardProof, message: '删除后第 2 版从宫格里消失' })
  await shotPng('02-version-deleted')
  observations.existsRightAfterDelete = fs.existsSync(targetFile)
  observations.pendingAfterVersionDelete = readSaved().payload?.pendingAssetDeletions ?? []
  if (process.env.NOMI_WALK_UNDO === '1') {
    await clickOrFail(win.getByRole('button', { name: uiText(locale, 'generationCommon.versionCards.undo'), exact: true }).last(), 'Undo version removal')
    await expectVisible(card, 'Undo restores version 2')
    expect(await decodes(urlOf(2)), 'Undo restores a readable image').toBe(true)
    observations.undoRestoredImage = true
    await shotPng('02-undo-restored')
    await card.hover()
    await clickOrFail(card.locator('[data-toolbar-action="delete"]'), 'Delete version 2 again')
    await expectAbsent(card, { provenBy: cardProof, message: 'Version 2 removed again' })
  }

  // ③ 关项目：回项目库。延后回收在这一刻释放。释放完成的信号有两种：写盘把待删清单清掉（修后），
  // 或文件已经被移进回收站（修前那一版不一定把清单清掉再落盘）。哪个先到都算，最多一个站点预算；都没到也不当场停。
  await backToLibrary(win, { label: '关项目：回项目库' })
  const pendingCleared = () => {
    const pending = readSaved().payload?.pendingAssetDeletions
    return !Array.isArray(pending) || !pending.some((entry) => String(entry?.relativePath || entry?.url || '').includes('liveness-v2'))
  }
  await expect.poll(() => pendingCleared() || binned().length > 0, { timeout: stationTimeout() }).toBe(true).catch(() => {})
  // 释放是异步的回收站调用：信号到了再给它一点时间真的动文件（修前就是这一步把文件移走）。
  await win.waitForTimeout(1500)

  // ④ 文件还在原路径，没进回收站。
  observations.pendingClearedAfterClose = pendingCleared()
  observations.existsAfterClose = fs.existsSync(targetFile)
  observations.binnedAfterClose = binned()
  await shotPng('03-closed-back-to-library')
  // 这几条先记下、不当场停：修前那一跑也要走到重开，拍下参考格裂图那一帧，最后一起判。
  const failures = []
  if (observations.binnedAfterClose.length) failures.push(`关项目后被分镜参考用着的文件进了回收站：${observations.binnedAfterClose.join(', ')}`)
  if (!observations.existsAfterClose) failures.push('关项目后被分镜参考用着的文件不在原路径')

  // ⑤ 完全退出进程但不调用会删资料的 launched.close；同一份资料与映像卷交给新进程，清掉旧进程的图片内存缓存。
  const firstLaunch = launched
  const firstProcess = launched.app.process()
  observations.appPidBeforeRestart = firstProcess.pid
  await launched.app.close()
  observations.exitedBeforeRestart = firstProcess.exitCode !== null || firstProcess.signalCode !== null
  expect(observations.exitedBeforeRestart, '旧应用进程已经退出').toBe(true)
  await startApp()
  observations.appPidAfterRestart = launched.app.process().pid
  observations.restartedWithSameProfile = ['tempRoot', 'userDataDir', 'settingsDir', 'projectsDir'].every((key) => launched[key] === firstLaunch[key])
  expect(observations.appPidAfterRestart, '应用重启使用新进程').not.toBe(observations.appPidBeforeRestart)
  expect(observations.restartedWithSameProfile, '重启沿用同一份隔离资料和项目映像卷').toBe(true)
  await openProject()
  observations.decodedAfterRestart = await decodes(urlOf(2))
  if (usage === 'storyboard') {
  await switchWorkspace(win, 'creation')
  await openStoryboardEditor(win, { pick: 'first' }, '重开后打开分镜')
  observations.boundAfterRestart = boundUrls()
  const reopenedThumb = row().locator('[data-storyboard-ref-thumb] img').first()
  observations.thumbPixelsAfterRestart = await reopenedThumb.evaluate((img) => (img.complete ? img.naturalWidth
    : new Promise((resolve) => { img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0) }))).catch(() => -1)
  } else if (usage === 'node') {
    await switchWorkspace(win, 'generation')
    await switchGenerationView(win, 'canvas')
    await clickOrFail(canvasFitViewButton(win), 'Fit reopened canvas')
    await clickOrFail(win.locator('.generation-canvas-v2-node[data-node-id="reference-node"]'), 'Reopen reference consumer')
    observations.referenceAfterRestart = readSaved().payload.generationCanvas.nodes.find(n => n.id === 'reference-node')?.meta
    const image = win.locator('.generation-canvas-v2-node__composer img[src*="liveness-v2"]').first()
    observations.thumbPixelsAfterRestart = await image.evaluate(img => img.complete && img.naturalWidth).catch(() => 0)
  } else {
    await expandResidentPanel(win)
    observations.composerAfterRestart = await win.locator(`${CANVAS_PANEL} ${COMPOSER}`).innerText()
    // Leaving a project clears unsent input by design. Verify the retained original is readable after a fresh process.
    observations.thumbPixelsAfterRestart = observations.decodedAfterRestart ? 1 : 0
  }
  observations.existsAfterRestart = fs.existsSync(targetFile)
  observations.binnedAfterRestart = binned()
  await shotPng('04-after-restart')
  if (usage === 'storyboard' && !observations.boundAfterRestart.includes(urlOf(2))) failures.push('重启后镜头 1 的参考绑定不见了')
  if (!(observations.decodedAfterRestart && observations.thumbPixelsAfterRestart > 0)) failures.push(`重启后镜头 1 的参考图解码不出像素（裂图）：小图宽 ${observations.thumbPixelsAfterRestart}`)
  if (!observations.existsAfterRestart) failures.push('重启后被分镜参考用着的文件不在原路径')
  if (observations.binnedAfterRestart.length) failures.push(`重启后被分镜参考用着的文件进了回收站：${observations.binnedAfterRestart.join(', ')}`)
  observations.hashAfterRestart = fileHash()
  if (observations.hashAfterRestart !== originalHash) failures.push('重开后原图字节变了或丢失')
  if (observations.pendingAfterVersionDelete.some(entry => entry.relativePath === relativeOf(2))) failures.push('删版本仍然登记了文件回收意图')
  observations.failures = failures
  if (failures.length) throw new Error(failures.join('；'))
  console.log('PASS retained version original after close and new process', JSON.stringify(observations))
  }
} catch (error) {
  observations.error = String(error?.stack || error)
  observations.existsAtFailure = fs.existsSync(targetFile)
  observations.binnedAtFailure = binned()
  console.error(observations.error)
  process.exitCode = 1
  if (win) await shotPng('99-failed').catch(() => {})
} finally {
  fs.writeFileSync(path.join(outDir, 'observations.json'), JSON.stringify(observations, null, 2))
  for (const session of launches.reverse()) await session.close().catch(() => {})
  detachDisposableVolume()
}
