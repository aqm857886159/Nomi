import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查：画布 复制/粘贴/撤销/删除后撤销 —— Cmd 与 Ctrl **两套修饰键都得成立**。
//
// 来历（2026-08-19 画布群 #4968/#4982/#4983）：用户报「ctrl+c 没有用」「所有快捷键都不好使」
// 「ctrl+z 也撤销不了」，群里当场判「忘加了」。**这个判断是错的**——
// copySelectedNodes/undo/redo 自 2026-06-12（2a0fea4e）就在，`mod = metaKey || ctrlKey` 双平台都认。
// 真机逐步实测：全部生效。真问题是画布上**没有任何复制入口**（右键节点不弹菜单、
// 两条工具条都没有复制钮），属可发现性，另案解决。
//
// 那为什么还要留这条走查？因为「快捷键悄悄坏掉」是**查不出来的**：
// 它不报错、不留日志，只在用户手里表现为「按了没反应」，而单测跑在 node 环境（无 DOM），
// 证不了真实事件相位与守卫链。这条把「两套修饰键都能用」钉成结构保证——
// 尤其防 useCanvasShortcuts 的三道守卫（编辑焦点 / 画布隐藏 / 文本选区）
// 和 `event.defaultPrevented` 早退被后续改动无意扩大命中面。
//
// 判据是**副作用**不是截图：每步按键前后数节点数量，且**每步前记录选中数**——
// 第一版探针没记选中数，被上一步的空剪贴板串了因果，误报「一半失效」，差点去修一个不存在的 bug。
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/canvas-shortcuts.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture, FIXTURE_VENDOR, FIXTURE_IMAGE_MODEL } from './agent-runtime-fixture.mjs'
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { require as tsxRequire } from 'tsx/cjs/api'
import { isDeepStrictEqual } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled, expect, proveProbe, expectAbsent } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-shortcuts')
const tempRoot = makeTempDir('nomi-shortcuts-')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })


// C19 setup only: reuse the original workspace/Run repositories and one Electron
// process. This second project is needed because the original shortcut matrix
// creates and clears a blank project; its assertions remain unchanged.
const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const { createProductionRunRepository } = tsxRequire('../../electron/productionRun/productionRunRepository.ts', import.meta.url)
const { generationCanvasNodeSchema, generationCanvasSnapshotSchema } = tsxRequire('../../src/workbench/generationCanvas/model/generationCanvasSchema.ts', import.meta.url)
const { backfillGroupFrameBounds } = tsxRequire('../../src/workbench/generationCanvas/model/canvasFrameBounds.ts', import.meta.url)
const { resolveNodeVisualSize } = tsxRequire('../../src/workbench/generationCanvas/nodes/nodeSizing.ts', import.meta.url)
const { localAssetUrl } = tsxRequire('../../electron/assets/assetPaths.ts', import.meta.url)
const c19Fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir: userDataDir })
const c19Catalog = JSON.parse(readFileSync(path.join(userDataDir, 'model-catalog.json'), 'utf8'))
const c19Model = c19Catalog.models.find(model => model.kind === 'image' && model.enabled && model.vendorKey === FIXTURE_VENDOR && model.modelKey === FIXTURE_IMAGE_MODEL)
if (!c19Model) throw new Error('C19 requires the original runtime fixture catalog image model')
const c19ProjectId = 'c19-shortcuts', c19RunId = 'c19-dismissed', c19GroupId = 'c19-group'
const c19Root = path.join(projectsDir, c19ProjectId)
const c19Image = localAssetUrl(c19ProjectId, 'assets/generated/shot.jpg')
const c19MediaFile = path.join(repoRoot, 'resources/onboarding-demo/shot-3.jpg')
const [c19Media] = JSON.parse(execFileSync(createRequire(import.meta.url)('@ffprobe-installer/ffprobe').path,
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', c19MediaFile], { encoding: 'utf8' })).streams
if (!(c19Media?.width > 0 && c19Media?.height > 0)) throw new Error('C19 requires decoded real JPEG dimensions')
// 种的是**现行格式**的项目：每一版带「第 N 版」号、节点记着出过的最大号。旧格式（没号）的项目打开时会补号并写盘
// （版本卡片 V1，nodeResultLifecycle.backfillNodeResultVersionNumbers），那正是下面「打开项目本身不写盘」要排除的东西——
// 补号写盘由 nodeResultLifecycle.test.ts 与版本卡片真 App 核对守，这条走查守的是编组撤销与焦点。
const c19Result = { id: 'c19-existing-result', type: 'image', url: c19Image, createdAt: 1, versionNo: 1 }
const c19Nodes = ['source', 'one', 'two'].map((id, index) => ({
  id: `c19-${id}`, kind: 'image', categoryId: 'shots', title: `C19 ${id}`, prompt: `C19 prompt ${id}`,
  renderKind: 'shot-frame', shotIndex: index + 1,
  position: { x: 80 + index * 320, y: 120 }, size: { width: 240, height: 240 },
  status: 'success', result: { ...c19Result, id: `${c19Result.id}-${id}` },
  history: [{ ...c19Result, id: `${c19Result.id}-${id}` }],
  resultVersionMax: 1,
  meta: { modelVendor: c19Model.vendorKey, modelKey: c19Model.modelKey, modeId: 't2i', promptSegments: [],
    imageWidth: c19Media.width, imageHeight: c19Media.height, imageAspectRatio: c19Media.width / c19Media.height,
    ...(index ? { storyboardDesignId: c19RunId, shotId: `shot-${id}` } : {}) },
  ...(index ? { groupId: c19GroupId } : {}),
}))
for (const node of c19Nodes) generationCanvasNodeSchema.parse(node)
createWorkspaceProject({ rootPath: c19Root, record: { id: c19ProjectId, name: 'C19 group Undo and focus', payload: {
  workbenchDocuments: [{ id: 'c19-document', version: 1, title: 'C19 document', updatedAt: 1,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C19 document text' }] }] } }],
  activeDocumentId: 'c19-document', timeline: null,
  generationCanvas: { nodes: c19Nodes, edges: [
    { id: 'c19-external', source: 'c19-source', target: 'c19-one', mode: 'reference', viaGroupId: c19GroupId, order: 0 },
    { id: 'c19-internal', source: 'c19-one', target: 'c19-two', mode: 'reference', order: 0 },
  ], groups: [{ id: c19GroupId, name: 'C19 restore whole group', categoryId: 'shots', nodeIds: ['c19-one', 'c19-two'],
    inputLinks: [{ sourceNodeId: 'c19-source' }], collapsed: false, createdAt: 1, updatedAt: 1 }],
    selectedNodeIds: [], canvasZoom: 0.8, canvasPan: { x: 0, y: 20 } },
} } }, { settingsRoot: userDataDir, defaultProjectsRoot: projectsDir })
generationCanvasSnapshotSchema.parse(JSON.parse(readFileSync(path.join(c19Root, '.nomi/project.json'), 'utf8')).payload.generationCanvas)
mkdirSync(path.join(c19Root, 'assets/generated'), { recursive: true })
copyFileSync(c19MediaFile, path.join(c19Root, 'assets/generated/shot.jpg'))
const c19Repository = createProductionRunRepository({ projectDirResolver: id => id === c19ProjectId ? c19Root : null })
const c19Candidate = { candidateId: 'c19-candidate', revision: 1, moduleId: 'generation.single-shot',
  providerId: c19Model.vendorKey, modelId: c19Model.modelKey, mode: 'text_to_image', prompt: 'C19 closed draft', parameters: {}, references: [] }
const c19Created = c19Repository.createGenerationDraft({ projectId: c19ProjectId, operationId: c19RunId,
  origin: { host: 'nomi' }, candidate: c19Candidate,
  shots: ['one', 'two'].map(id => ({ shotId: `shot-${id}`, candidate: { ...c19Candidate, candidateId: `c19-${id}` } })) })
// 2026-09-22：× = 收回这一次出价（`generation.withdraw`）——计划留在 draft、只是不再摆在用户面前。
// （途中那一版 `generation.dismiss` 已删；当天上午那一版 `cancel("declined")` 被用户下午的拍板推翻。）
// 2026-09-30 付费卡逐镜：收回记在这一次出价上（`presentations` 最后一条带 `closed`，× = `user_closed`）。
c19Repository.execute(c19ProjectId, c19RunId, { commandId: 'c19-withdraw-before-open', expectedRevision: c19Created.revision,
  type: 'generation.withdraw', payload: { reason: 'user_closed' }, issuedAt: new Date().toISOString() })
const c19AuthorityBefore = { run: c19Repository.read(c19ProjectId, c19RunId), approvals: c19Repository.readApprovals(c19ProjectId, c19RunId) }
if (c19AuthorityBefore.run.generationPlan.presentations?.at(-1)?.closed?.by !== 'user_closed') throw new Error('C19 setup must persist a genuinely withdrawn quote')

// Preserve the actual fixture's durable graph before hydration. Runtime measurement is
// not a user edit and intentionally does not schedule a project save.
const { nodes: c19SeedNodes, edges: c19SeedEdges, groups: c19SeedGroups } = JSON.parse(
  readFileSync(path.join(c19Root, '.nomi/project.json'), 'utf8'),
).payload.generationCanvas
const c19SeedGraph = { nodes: c19SeedNodes, edges: c19SeedEdges, groups: c19SeedGroups }

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-shortcuts',
  userDataDir, settingsDir: userDataDir, projectsDir,
  args: ['--no-proxy-server'], settleMs: 0,
  initialLocalStorage: { '__nomiE2E': '1', 'nomi:locale:v1': 'zh-CN' },
})
// keyboard.press(`${mod}+v`) emits a real paste event in Electron. Clear the
// user's ambient OS clipboard so this walk exercises the canvas-node fallback,
// not an unrelated URL/image import left by another app or test.
await app.evaluate(({ clipboard }) => clipboard.clear())

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((c) => !c.isClosed())
  win = live.find((c) => /projectId=/.test(c.url())) || live[live.length - 1] || win
  return win
}
const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}
async function dismissFirstRun() {
  for (let i = 0; i < 6; i += 1) {
    const a = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await a.isVisible().catch(() => false)) await a.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}
async function resize(w, h) {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((t, s) => { t.setBounds({ x: 0, y: 0, width: s.width, height: s.height }); t.center() }, { width: w, height: h })
  await getWin().waitForTimeout(350)
}

const countNodes = () => getWin().evaluate(() => document.querySelectorAll('.generation-canvas-v2-node').length)
const countSelected = () => getWin().evaluate(() => Array.from(document.querySelectorAll('.generation-canvas-v2-node'))
  .filter((n) => n.getAttribute('data-selected') === 'true' || n.getAttribute('aria-selected') === 'true' || /selected|ring-nomi-accent/.test(n.className)).length)

// 空白点判据住在 `_canvasHit.mjs`（单一 owner）：最顶层元素就是 React Flow pane。
async function findBlankPoint() {
  const point = await findCanvasBlankPoint(getWin())
  if (!point) throw new Error('画布上找不到任何空白点（stage 被浮层占满）')
  return point
}

async function addNode() {
  const blank = await findBlankPoint()
  if (!blank) throw new Error('找不到画布空白点')
  await getWin().mouse.click(blank.x, blank.y, { button: 'right' })
  await getWin().waitForTimeout(400)
  const menu = getWin().locator('.generation-canvas-v2__context-node-menu')
  await menu.locator('[role="menuitem"]').first().click({ timeout: 5000 })
  await getWin().waitForTimeout(900)
}

async function selectFirstNode() {
  const node = getWin().locator('.generation-canvas-v2-node').first()
  const box = await node.boundingBox()
  await getWin().mouse.click(box.x + box.width / 2, box.y + 12)
  await getWin().waitForTimeout(400)
}

/** 按一次键，返回节点数变化。**按之前**先量选中数，避免拿上一步的残留状态解释这一步。 */
async function press(keys) {
  const before = await countNodes()
  const selected = await countSelected()
  await getWin().keyboard.press(keys)
  await getWin().waitForTimeout(900)
  return { before, after: await countNodes(), selected }
}

async function checkC19GroupUndoAndFocus() {
  await getWin().getByRole('button', { name: '返回项目库', exact: true }).click()
  const projectCard = getWin().locator('[data-project-card]').filter({ hasText: 'C19 group Undo and focus' })
  await expect(projectCard).toBeVisible()
  await projectCard.hover()
  await projectCard.getByRole('button', { name: /继续创作/ }).click()
  await getWin().getByRole('button', { name: '生成', exact: true }).click()
  const graph = () => getWin().evaluate(() => {
    const { nodes, edges, groups } = window.__nomiCanvasStore.getState()
    return { nodes, edges, groups }
  })
  const diskGraph = () => {
    const { nodes, edges, groups } = JSON.parse(readFileSync(path.join(c19Root, '.nomi/project.json'), 'utf8')).payload.generationCanvas
    return { nodes, edges, groups }
  }
  const authority = () => ({ run: c19Repository.read(c19ProjectId, c19RunId), approvals: c19Repository.readApprovals(c19ProjectId, c19RunId) })
  await expect.poll(async () => (await graph()).nodes.length).toBe(3)
  const before = await graph()
  // Opening the seeded legacy group does not itself persist hydration/measurement.
  // Prove all original durable user fields remain intact, independently of live graph.
  await expect.poll(diskGraph).toEqual(c19SeedGraph)
  const seedRects = new Map(c19SeedNodes.map(node => {
    const size = resolveNodeVisualSize(node)
    return [node.id, { ...node.position, width: size.width, height: size.height }]
  }))
  const initialHydratedGraph = {
    ...c19SeedGraph,
    groups: backfillGroupFrameBounds(c19SeedGroups, id => seedRects.get(id) ?? null),
  }
  expect(before).toEqual(initialHydratedGraph)
  await getWin().getByRole('button', { name: '分组', exact: true }).click()
  const groupRow = getWin().locator('button[title="C19 restore whole group"]')
  await expect(groupRow).toBeVisible()
  const groupProof = await proveProbe(groupRow, 'C19 real sidebar group exists before deletion')
  await groupRow.click({ button: 'right' })
  await getWin().getByRole('menuitem', { name: '整组删除', exact: true }).click()
  const confirm = getWin().locator('[data-confirm-dialog-surface]')
  await expect(confirm).toContainText('C19 restore whole group')
  await confirm.getByRole('button', { name: '删除', exact: true }).click()
  await expectAbsent(groupRow, { provenBy: groupProof, message: 'Whole group disappears after actual confirmed UI deletion' })
  await expect.poll(async () => (await graph()).nodes.map(node => node.id)).toEqual(['c19-source'])
  await expect.poll(async () => (await graph()).edges).toEqual([])
  await expect.poll(async () => (await graph()).groups).toEqual([])
  // Only this actual keyboard gesture may restore the group. No store.undo,
  // DOM dispatchEvent, imperative bridge or direct mutation is used below.
  const blank = await findBlankPoint()
  await getWin().mouse.click(blank.x, blank.y)
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(graph).toEqual(before)
  await expect.poll(diskGraph).toEqual(before)
  assert(isDeepStrictEqual(authority(), c19AuthorityBefore), 'Dismissed draft and approval ledger remain unchanged')
  await expect(groupRow).toBeVisible()
  const restoredImage = getWin().locator('.generation-canvas-v2-node[data-node-id="c19-one"] img').first()
  await expect.poll(() => restoredImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await snap('02-c19-group-restored.png')

  const nodePoint = await findNodeHitPoint(getWin(), { nodeSelector: '.generation-canvas-v2-node[data-node-id="c19-one"]' })
  assert(Boolean(nodePoint), 'C19 restored member has a real pointer hit target')
  await getWin().mouse.click(nodePoint.x, nodePoint.y)
  const prompt = getWin().locator('[data-composer-host="canvas"] [contenteditable="true"]').first()
  await expect(prompt).toHaveText('C19 prompt one')
  const promptBefore = await graph()
  // Original canvasNodeActions records manual storyboard prompt overrides.
  // This is required binding protection, not an unintended graph edit.
  promptBefore.nodes.find(node => node.id === 'c19-one').meta.overriddenFields = ['prompt']
  // Compare all content except this editor's actual mutable prompt bookkeeping.
  const exceptPrompt = value => ({ ...value, nodes: value.nodes.map(node => {
    if (node.id !== 'c19-one') return node
    const { prompt: _prompt, meta, ...rest } = node
    const { promptSegments: _segments, ...otherMeta } = meta ?? {}
    return { ...rest, meta: otherMeta }
  }) })
  await prompt.click()
  await expect(prompt).toBeFocused()
  await expect.poll(() => prompt.evaluate(element => Boolean(element.editor && element.editor.view.dom === element))).toBe(true)
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await getWin().keyboard.press('Shift+ArrowRight')
  await expect.poll(() => getWin().evaluate(() => window.getSelection()?.toString())).toBe('C')
  await expect.poll(() => prompt.evaluate(element => ({
    from: element.editor.state.selection.from, to: element.editor.state.selection.to, focused: element.editor.view.hasFocus(),
  }))).toEqual({ from: 1, to: 2, focused: true })
  await getWin().keyboard.press('Delete')
  await expect(prompt).toHaveText('19 prompt one')
  expect(exceptPrompt(await graph()), 'Prompt Delete preserves graph/result/binding state').toEqual(exceptPrompt(promptBefore))
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(prompt).toHaveText('C19 prompt one')
  assert(isDeepStrictEqual(exceptPrompt(await graph()), exceptPrompt(promptBefore)), 'Prompt Undo belongs to the editor, not the canvas group transaction')
  await expect.poll(() => diskGraph().nodes.find(node => node.id === 'c19-one')?.prompt).toBe('C19 prompt one')

  // Keep a real selected node while the canvas becomes hidden: the hidden-stage
  // guard must not steal the document editor's Delete/Undo.
  const beforeDocument = await graph()
  await getWin().getByRole('button', { name: '创作', exact: true }).click()
  const document = getWin().locator('[aria-label="创作文档编辑区"] .tiptap[contenteditable="true"]')
  await expect(document).toHaveText('C19 document text')
  await document.click()
  await expect(document).toBeFocused()
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await getWin().keyboard.press('Shift+ArrowRight')
  await expect.poll(() => getWin().evaluate(() => window.getSelection()?.toString())).toBe('C')
  await expect.poll(() => document.evaluate(element => ({
    from: element.editor.state.selection.from, to: element.editor.state.selection.to, focused: element.editor.view.hasFocus(),
  }))).toEqual({ from: 1, to: 2, focused: true })
  await getWin().keyboard.press('Delete')
  await expect(document).toHaveText('19 document text')
  assert(isDeepStrictEqual(await graph(), beforeDocument), 'Document Delete cannot mutate the hidden canvas')
  await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(document).toHaveText('C19 document text')
  await expect.poll(graph).toEqual(beforeDocument)
  await expect.poll(diskGraph).toEqual(beforeDocument)
  assert(isDeepStrictEqual(authority(), c19AuthorityBefore), 'Dismissed draft and approval ledger remain unchanged')
  await snap('03-c19-document-focus.png')
  writeFileSync(path.join(shotsDir, 'c19-evidence.json'), JSON.stringify({ projectRoot: c19Root, platform: process.platform,
    windows: process.platform === 'win32' ? 'executed' : 'unverified', before, restored: await graph(), authorityBefore: c19AuthorityBefore,
    authorityAfter: authority(), boundary: 'Seeded real JPG and genuinely dismissed draft; no paid provider, no prior approved receipt. Real UI group delete and actual keyboard Undo; read-only state/disk observations.' }, null, 2))
  c19Fixture.assertClean()
  assert(c19Fixture.images.length === 0 && c19Fixture.requests.length === 0, 'C19 editing and Undo issue no provider requests')
  assert(true, 'C19 group delete/one Undo and prompt/document focus isolation complete')
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()
  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // 两套修饰键都要测：Windows 用户按 Ctrl，mac 用户按 Cmd，`mod = metaKey||ctrlKey` 承诺两者等价。
  for (const mod of ['Meta', 'Control']) {
    console.log(`\n── 修饰键 ${mod} ──`)
    await addNode()
    await selectFirstNode()
    assert(await countSelected() > 0, `${mod}: 节点已选中（复制的前提）`)

    await press(`${mod}+c`)
    const paste = await press(`${mod}+v`)
    assert(paste.after === paste.before + 1, `${mod}+C / ${mod}+V 复制粘贴生效`, `${paste.before} → ${paste.after}`)

    const undo = await press(`${mod}+z`)
    assert(undo.after === undo.before - 1, `${mod}+Z 撤销粘贴生效`, `${undo.before} → ${undo.after}`)

    // 撤销最该保命的场景：误删之后能不能救回来。
    await selectFirstNode()
    const del = await press('Delete')
    assert(del.after === del.before - 1, `${mod}: Delete 删除生效`, `${del.before} → ${del.after}`)
    const undoDel = await press(`${mod}+z`)
    assert(undoDel.after === undoDel.before + 1, `${mod}+Z 撤销删除生效（误删救得回来）`, `${undoDel.before} → ${undoDel.after}`)

    // 清场，让下一轮修饰键从干净状态开始。
    const remaining = await countNodes()
    for (let i = 0; i < remaining; i += 1) {
      await selectFirstNode()
      await press('Delete')
    }
  }

  await snap('01-final.png')
  await checkC19GroupUndoAndFocus()
  console.log(`\n✅ 画布快捷键走查通过：${passed} 项`)
} catch (err) {
  console.error(`\n❌ ${err.message}`)
  await snap('99-error.png').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  await c19Fixture.close()
}
