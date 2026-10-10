// R13 走查：从目标节点左输入端拖到两图编组，编组成员应成为目标参考，而不是反向连边。
// 用法：node tests/ux/group-reference-direction.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { screenshotSettled } from './_assert.mjs'
import { findConnectionStartPoint, findEdgeHitPoint } from './_canvasHit.mjs'
import { newProjectEntry } from './_shell.mjs'
const repoRoot = process.cwd()
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-group-reference-direction')
const settingsDir = path.join(tempRoot, 'settings')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/group-reference-direction')
for (const dir of [tempRoot, settingsDir, shotsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
const catalogNow = '2026-08-29T00:00:00.000Z'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible',
    createdAt: catalogNow, updatedAt: catalogNow,
  }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'nano-banana', labelZh: 'Nano Banana', kind: 'image', enabled: true,
    createdAt: catalogNow, updatedAt: catalogNow,
    meta: {
      archetypeId: 'nano-banana',
      adapter: {
        state: 'verified', activeRevision: 'ux-revision', publicationModes: ['text_to_image', 'image_edit'],
        modes: [
          { taskKind: 'text_to_image', state: 'verified' },
          { taskKind: 'image_edit', state: 'verified' },
        ],
      },
    },
  }],
  mappings: [],
  apiKeysByVendor: {},
}, null, 2))

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const vite = await createServer({ root: repoRoot, server: { host: '127.0.0.1', port: 0 } })
let app
try {
  await vite.listen()
  const baseUrl = `http://127.0.0.1:${vite.httpServer.address().port}`
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'group-reference-direction',
    userDataDir: path.join(tempRoot, 'user-data'),
    settingsDir,
    projectsDir: path.join(tempRoot, 'projects'),
    env: {
      NOMI_DESKTOP_DEV: '1',
      VITE_DEV_SERVER_URL: baseUrl,
    },
    settleMs: 0,
  }))
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1800)
  for (let i = 0; i < 4; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(180)
  }
  const blank = newProjectEntry(win)
  await blank.waitFor({ state: 'visible', timeout: 12_000 })
  // 创建会立刻触发 hash 导航并异步 hydrate；点击本身不等待整次页面导航，后面用 URL +
  // 工作台真实入口分别收敛，避免慢磁盘下 Playwright 把成功的点击误报为超时。
  await blank.click({ timeout: 15_000, noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 15_000 })
  const generationTab = win.locator('[data-mode="generation"]').first()
  const enteredStudio = await generationTab.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
  check('新建并进入隔离项目', enteredStudio, win.url())
  if (!enteredStudio) throw new Error('未进入项目工作台')
  if (await generationTab.getAttribute('data-state') !== 'active') {
    // 点击本身不等整次导航（慢盘 / 慢 CI 上「等待已排期的导航」会把成功的点击误报成 4s 超时，同上），
    // 到没到「生成」用页签自己的 active 态收敛。
    await generationTab.click({ timeout: 4000, force: true, noWaitAfter: true })
    await win.waitForFunction(() => document.querySelector('[data-mode="generation"]')?.getAttribute('data-state') === 'active', undefined, { timeout: stationTimeout({ operations: 1 }) })
  }
  await win.waitForTimeout(1200)

  const catalogSeeded = await win.evaluate(async () => {
    const desktop = window.nomiDesktop
    if (!desktop?.modelCatalog) return { error: '模型目录 bridge 不存在' }
    const model = desktop.modelCatalog.listModels({ vendorKey: 'ux-local' })
      .find((candidate) => candidate.modelKey === 'nano-banana')
    if (!model?.publishedModes?.includes('text_to_image') || !model.publishedModes.includes('image_edit')) {
      return { error: `验证发布模式不完整：${JSON.stringify(model?.publishedModes || [])}` }
    }
    const { notifyModelOptionsRefresh } = await import('/src/config/modelCatalogCache.ts')
    notifyModelOptionsRefresh('all')
    return { ok: true }
  }).catch((error) => ({ error: String(error) }))
  check('隔离环境注入可用图片模型档案', catalogSeeded.ok === true, catalogSeeded.error || '')
  await win.waitForTimeout(900)

  const injected = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const image = (id, title, y, url) => ({
      id, kind: 'image', title, position: { x: 80, y }, prompt: '', categoryId: 'shots', groupId: 'reference-group',
      result: { id: `${id}-result`, type: 'image', url, createdAt: 1 }, status: 'success',
      meta: { imageWidth: 640, imageHeight: 420 },
    })
    // 参考解析器刻意不允许 data: URL 发给模型；用 Vite 同源静态图走真实可投递 URL 链。
    const aUrl = `${location.origin}/prompt-media/expressions/builtin-expr-joy-1.webp`
    const bUrl = `${location.origin}/prompt-media/expressions/builtin-expr-surprise-1.webp`
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        image('source-a', '参考 A', 120, aUrl),
        image('source-b', '参考 B', 520, bUrl),
        {
          id: 'target', kind: 'image', title: '目标生成图', position: { x: 780, y: 300 }, prompt: '融合两张参考图', categoryId: 'shots',
          meta: { modelKey: 'nano-banana', archetype: { id: 'nano-banana', modeId: 't2i' } },
        },
      ],
      edges: [],
      selectedNodeIds: ['target'],
      groups: [{ id: 'reference-group', name: '双图参考', categoryId: 'shots', nodeIds: ['source-a', 'source-b'], createdAt: 1, updatedAt: 1 }],
    })
    // restoreSnapshot 刻意不恢复幽灵选区；走真 action 选中目标，才能出现左右连接端。
    useGenerationCanvasStore.getState().selectNode('target')
    return { aUrl, bUrl }
  }).catch((error) => ({ error: String(error) }))
  check('注入两张成图 + 文生图目标', !injected.error, injected.error || '')
  await win.waitForTimeout(1200)
  const fit = win.getByLabel('适应视图').first()
  if (await fit.count()) await fit.click()
  await win.waitForTimeout(900)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-before.png') })

  // 按人按的地方起线：目标卡左侧那颗常驻「+」圈（见 _canvasHit.mjs findConnectionStartPoint 的根因注释）。
  const startPoint = await findConnectionStartPoint(win, { handleSelector: '.react-flow__node[data-id="target"] .generation-canvas-react-flow__handle--source[data-side="left"]' })
  const groupBox = await win.locator('[data-group-id="reference-group"]').first().boundingBox()
  check('目标左输入端和编组框均可见', Boolean(startPoint && groupBox), JSON.stringify(startPoint))
  if (!startPoint || !groupBox) throw new Error('连接手势缺少可见端点')
  const dropPoint = await win.evaluate((box) => {
    for (let y = box.y + 12; y < box.y + box.height - 8; y += 8) {
      for (let x = box.x + 12; x < box.x + box.width - 8; x += 8) {
        const stack = document.elementsFromPoint(x, y)
        if (stack.some((el) => el.closest('[data-group-id="reference-group"]')) && !stack.some((el) => el.closest('[data-node-id]'))) return { x, y }
      }
    }
    return null
  }, groupBox)
  check('编组内存在不压节点的真实落点', Boolean(dropPoint))
  if (!dropPoint) throw new Error('没有可用编组落点')

  await win.mouse.move(startPoint.x, startPoint.y)
  await win.mouse.down()
  await win.mouse.move(dropPoint.x, dropPoint.y, { steps: 12 })
  await win.waitForTimeout(350)
  const pendingAria = await win.locator('[data-group-id="reference-group"]').first().getAttribute('aria-label')
  check('左输入端待连提示说明“将编组作为输入”', /作为输入/.test(pendingAria || ''), pendingAria || '')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-group-as-input.png') })
  await win.mouse.up()
  await win.waitForTimeout(1200)

  const state = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const { resolveReferenceSlots } = await import('/src/workbench/generationCanvas/runner/referenceSlots.ts')
    const current = useGenerationCanvasStore.getState()
    const target = current.nodes.find((node) => node.id === 'target')
    const fills = target ? resolveReferenceSlots(target, current.nodes, current.edges).flatMap((slot) => slot.fills.map((fill) => fill.url)) : []
    const sourceUrls = current.nodes
      .filter((node) => node.id === 'source-a' || node.id === 'source-b')
      .map((node) => node.result?.url)
    return {
      edges: current.edges.map((edge) => ({ source: edge.source, target: edge.target, order: edge.order, viaGroupId: edge.viaGroupId })),
      modeId: target?.meta?.archetype?.modeId,
      fills,
      sourceUrls,
      outputLinks: current.groups.find((group) => group.id === 'reference-group')?.outputLinks,
    }
  })
  check('两根真边方向均为组成员 → 目标', JSON.stringify(state.edges.map((edge) => [edge.source, edge.target])) === JSON.stringify([['source-a', 'target'], ['source-b', 'target']]), JSON.stringify(state.edges))
  check('目标自动从文生图切到改图', state.modeId === 'edit', String(state.modeId))
  check('两个参考槽按组内顺序得到真实图片', JSON.stringify(state.fills) === JSON.stringify(state.sourceUrls), String(state.fills.length))
  check('编组输出关系已持久声明', state.outputLinks?.[0]?.targetNodeId === 'target', JSON.stringify(state.outputLinks))

  const targetNode = win.locator('[data-node-id="target"]').first()
  const referenceImages = targetNode.locator('.generation-canvas-v2-node__ref-section img')
  await referenceImages.nth(1).waitFor({ state: 'visible', timeout: 10_000 })
  const referenceImageCount = await referenceImages.count()
  check('目标顶部真实显示两张参考缩略图', referenceImageCount === 2, String(referenceImageCount))
  const activeMode = await targetNode.locator('[aria-label="生成方式"] [data-active="true"]').first().textContent().catch(() => '')
  check('界面模式同步显示“改图”', /改图/.test(activeMode || ''), activeMode || '')
  await screenshotSettled(win, { path: path.join(shotsDir, '03-after-connected.png') })

  const clickableEdgePoint = await findEdgeHitPoint(win, { withinSelector: '[data-group-id="reference-group"]' })
  check('编组内部的连线命中区不再被组框盖住', Boolean(clickableEdgePoint))
  if (!clickableEdgePoint) throw new Error('找不到编组内可点的连线')

  // 2026-10-08 用户「删掉连线中间的标签吗，没有作用」：连线中点的模式菜单（改语义 / 断开）已删。
  // 旧断言「真实点标签可切换语义、只改命中的一条边」作废（用途改在目标节点的参考槽里设置）；断开走中点的「×」。
  await win.mouse.click(clickableEdgePoint.x, clickableEdgePoint.y)
  await win.waitForTimeout(300)
  const disconnectButton = win.locator('[data-edge-disconnect]').first()
  await disconnectButton.waitFor({ state: 'visible', timeout: 4000 })
  check('点编组内的连线 = 选中并出「×」，中点没有任何文字（不弹模式菜单）', (await win.locator('.generation-canvas-v2__edge-control').innerText()).trim() === '')
  await screenshotSettled(win, { path: path.join(shotsDir, '04-edge-selected-x.png') })
  await disconnectButton.click()
  await win.waitForTimeout(500)
  const disconnected = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const current = useGenerationCanvasStore.getState()
    return {
      edgeCount: current.edges.length,
      outputLinks: current.groups.find((group) => group.id === 'reference-group')?.outputLinks,
    }
  })
  check('断开编组连接会撤掉全部展开边', disconnected.edgeCount === 0, JSON.stringify(disconnected))
  check('断开同时清掉编组声明，不会后续复活', disconnected.outputLinks == null, JSON.stringify(disconnected.outputLinks))
  await referenceImages.first().waitFor({ state: 'detached', timeout: 10_000 })
  const disconnectedReferenceImageCount = await referenceImages.count()
  check('目标顶部参考图随断开实时清空', disconnectedReferenceImageCount === 0, String(disconnectedReferenceImageCount))
  await screenshotSettled(win, { path: path.join(shotsDir, '05-after-disconnected.png') })
} catch (error) {
  failures.push(String(error))
  console.error(error)
} finally {
  await app?.close().catch(() => {})
  await vite.close()
}

console.log(failures.length ? `\n❌ ${failures.length} 条不达标:\n - ${failures.join('\n - ')}` : '\n✅ 编组参考方向走查全部达标')
process.exit(failures.length ? 1 : 0)
