// 生成页「画布 | 列表」整窗走查（零额度：只播种已有结果，不触发任何生成）。1280×800，隔离资料目录，Electron 屏外。
// 产出：整窗截图——列表、大详情（已生成 / 生成中 / 失败 / 还没生成）、切回画布（「镜 03」角标 + 「去列表」）。
// 用法：pnpm run build && node tests/ux/generation-list-window.walk.mjs [输出目录]
//   WALK_LOCALE=en 英文；WALK_SCHEME=dark 暗色（四轨：中光 / 中暗 / 英光 / 英暗）。
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.resolve(process.argv[2] || path.join(repoRoot, 'tests/ux/shots/generation-list-window'))
fs.mkdirSync(outDir, { recursive: true })
const locale = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const scheme = process.env.WALK_SCHEME === 'dark' ? 'dark' : 'light'
const suffix = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : '-light'}`

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-generation-list-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const art = (from, to, w = 320, h = 180) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.66}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.15}" fill="rgba(255,235,192,.28)"/><path d="M0 ${h * 0.78} Q ${w * 0.28} ${h * 0.58}, ${w * 0.54} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H0Z" fill="rgba(16,20,27,.42)"/></svg>`)
const zh = locale !== 'en'
const T = (a, b) => (zh ? a : b)
const projectId = 'generation-list-window'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(projectRoot, { recursive: true })
const designId = 'design-rain'
const documentId = 'doc-rain'
const shots = [
  T('远景，雨后便利店门口，林薇站在雨棚边，手里攥着一块旧怀表', 'Wide shot, Lin Wei by the store awning after rain, clutching an old pocket watch'),
  T('近景，林薇侧脸，水珠沿发梢滑下', 'Close-up, Lin Wei in profile, droplets run from her hair'),
  T('低机位，怀表落在积水里，车灯扫过', 'Low angle, a pocket watch in a puddle as headlights sweep'),
  T('俯拍，霓虹映在湿漉漉的车道上，一辆车缓缓驶过，车灯拉出长长的光', 'Top down, neon over the wet lanes, a car glides past trailing long light'),
  T('中景，林薇转身走进雨里，便利店的灯在身后', 'Medium shot, Lin Wei turns into the rain, the store light behind her'),
  T('特写，表链在指间垂下，指针停在三点十分', 'Insert, the watch chain hangs from her fingers, hands stopped at ten past three'),
]
const tones = [['#384d67', '#111827'], ['#704b45', '#201312'], ['#5d526f', '#1b1726'], ['#506a63', '#162622'], ['#87613e', '#2b1c12'], ['#476274', '#121c26']]
const modelMeta = { modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '16:9' }
const nodes = shots.map((prompt, index) => ({
  id: `shot-${index + 1}`, kind: 'image', title: '', prompt, categoryId: 'shots', shotIndex: index + 1,
  position: { x: 80 + (index % 3) * 420, y: 120 + Math.floor(index / 3) * 360 }, size: { width: 360, height: 203 },
  // 镜 04 还没生成；镜 06 失败；镜 05 在走查里运行时才切成「生成中」（载入时会把存盘时在跑的收敛掉）。
  status: index === 3 ? 'idle' : index === 5 ? 'error' : 'success',
  ...(index === 5 ? { error: T('内容未通过审核，换个描述再试', 'The prompt was rejected by the content check') } : {}),
  meta: { storyboardDesignId: designId, shotId: `s${index + 1}`, ...modelMeta },
  ...(index === 3 || index === 5 ? {} : { result: { id: `r${index + 1}`, type: 'image', url: art(...tones[index]), createdAt: index + 1 } }),
}))
const groupNodes = [0, 1].map((index) => ({
  id: `look-${index + 1}`, kind: 'image', title: T(['林薇 · 定妆', '便利店 · 夜景'][index], ['Lin Wei · look', 'Store · night'][index]),
  prompt: T(['林薇，雨夜外套，短发，半身', '雨夜便利店外观，霓虹灯招牌'][index], ['Lin Wei, rain coat, short hair, half body', 'Convenience store exterior at night, neon sign'][index]),
  categoryId: 'shots', position: { x: 80 + index * 420, y: 900 }, size: { width: 360, height: 203 }, status: 'success',
  meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '16:9' },
  result: { id: `look-r${index + 1}`, type: 'image', url: art(...tones[(index + 2) % 6]), createdAt: 20 + index },
}))
const anchorNodes = [
  { id: 'ref-lin', kind: 'character', title: T('林薇', 'Lin Wei'), categoryId: 'cast', position: { x: -420, y: 120 }, status: 'success', meta: { referenceSheet: true, storyboardDesignId: designId, anchorId: 'lin' }, result: { id: 'ref-lin-r', type: 'image', url: art('#d9b9a3', '#8a6a58', 200, 200), createdAt: 30 } },
  { id: 'ref-watch', kind: 'character', title: T('怀表', 'Pocket watch'), categoryId: 'cast', position: { x: -420, y: 400 }, status: 'idle', meta: { referenceSheet: true, storyboardDesignId: designId, anchorId: 'watch' } },
]
const design = {
  id: designId, documentId, title: T('雨夜便利店', 'Rainy convenience store'), committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
  plan: {
    title: T('雨夜便利店', 'Rainy convenience store'),
    anchors: [
      { id: 'lin', kind: 'character', name: T('林薇', 'Lin Wei'), description: '', carrier: 'visual' },
      { id: 'watch', kind: 'prop', name: T('怀表', 'Pocket watch'), description: '', carrier: 'visual' },
    ],
    shots: shots.map((prompt, index) => ({ shotId: `s${index + 1}`, index: index + 1, shotKind: 'video', durationSec: 4, anchorIds: index === 0 ? ['lin'] : [], prompt })),
  },
}
const project = {
  id: projectId, name: T('列表视图走查', 'List view walk'), version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: documentId, version: 1, title: T('雨夜来信', 'Rain letter'), updatedAt: 1, contentJson: { type: 'doc', content: [] } }],
    activeDocumentId: documentId,
    timeline: null,
    generationCanvas: {
      nodes: [...anchorNodes, ...nodes, ...groupNodes],
      edges: [
        { id: 'e-lin-1', source: 'ref-lin', target: 'shot-1', mode: 'reference', order: 0 },
        { id: 'e-lin-2', source: 'ref-lin', target: 'shot-2', mode: 'reference', order: 0 },
      ],
      selectedNodeIds: [],
      groups: [{ id: 'group-looks', name: T('角色定妆', 'Character looks'), categoryId: 'shots', nodeIds: groupNodes.map((node) => node.id), createdAt: 1, updatedAt: 1 }],
    },
    storyboardDesignsByDocumentId: { [documentId]: [design] },
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))

let app
let win
async function launch(name) {
  const launched = await launchNomiApp({ name, userDataDir, settingsDir, projectsDir, env: { NOMI_CAPABILITY_DIR: capabilityDir }, args: ['--disable-gpu'], timeout: 300000, settleMs: 1200 })
  app = launched.app
  win = app.windows().find((candidate) => !candidate.isClosed()) || app.firstWindow()
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1280, height: 800 })
  await win.waitForTimeout(500)
}
async function shutdown() {
  await win?.close().catch(() => {})
  await app?.close().catch(() => {})
}
// 隔离资料里没配供应商，会冒「模型不可用」的提示条——与列表无关，截图前先关掉。
async function dismissToasts() {
  await win.evaluate(() => document.querySelectorAll('[data-toast-message]').forEach((message) => { Array.from(message.parentElement?.querySelectorAll('button') ?? []).at(-1)?.click() }))
  await win.waitForTimeout(400)
}
const shot = async (name) => { await dismissToasts(); await screenshotSettled(win, { path: path.join(outDir, `listview-${name}-${suffix}.png`) }) }

try {
  await launch('generation-list-window-prime')
  await win.evaluate(({ scheme, locale }) => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi-color-scheme', scheme)
    localStorage.setItem('nomi:locale:v1', locale)
    // 只为走查把「生成中」摆出来：E2E 桥把画布 store 挂到 window（生产不暴露，见 ProductionCanvasLandingHost）。
    localStorage.setItem('__nomiE2E', '1')
  }, { scheme, locale })
  await shutdown()
  await launch('generation-list-window')
  const projectCard = win.getByText(project.name, { exact: false }).first()
  await expect(projectCard, '项目卡没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作|Continue/ }).first(), '打开走查项目')
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const toggle = win.locator('[data-generation-view-toggle]')
  await expect(toggle, '生成页左上没有「画布 | 列表」切换').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  // ① 切到列表：画布区换成列表，其余不动。
  await clickOrFail(toggle.locator('button'), 'toggle to list')
  await expect(win.locator('[data-generation-list]'), '列表没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-list-card="shot-1"]'), '列表里没有镜 01').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-section-generate]').first(), '分区头没有「生成全部」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('list')

  // ② 点镜 01 → 大详情（已生成）：左窄列 + 大预览 + 生成框 + 「重新生成」。
  await clickOrFail(win.locator('[data-list-card="shot-1"]'), '点镜 01')
  await expect(win.locator('[data-list-inspector="shot-1"]'), '大详情没有打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-list-detail-rail]'), '大详情左边没有窄列').toBeVisible()
  await shot('detail-done')

  // ③ 窄列里点镜 05（走查里把它切成「生成中」）→ 大详情（生成中）。
  await win.evaluate(() => {
    const store = window.__nomiCanvasStore.getState()
    window.__walkSavedShot5 = store.nodes.find((candidate) => candidate.id === 'shot-5')
    store.updateNode('shot-5', { status: 'running', result: undefined })
  })
  await clickOrFail(win.locator('[data-list-detail-row="shot-5"]'), '窄列里点镜 05')
  await expect(win.locator('[data-list-inspector="shot-5"]'), '切到镜 05 的大详情失败').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('detail-generating')
  await win.evaluate(() => window.__nomiCanvasStore.getState().updateNode('shot-5', { status: 'success', result: window.__walkSavedShot5.result }))

  // ④ 窄列里点镜 06 → 大详情（失败）。
  await clickOrFail(win.locator('[data-list-detail-row="shot-6"]'), '窄列里点镜 06')
  await expect(win.locator('[data-list-inspector="shot-6"]'), '切到镜 06 的大详情失败').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('detail-failed')

  // ⑤ 窄列里点镜 04 → 大详情（还没生成）。
  await clickOrFail(win.locator('[data-list-detail-row="shot-4"]'), '窄列里点镜 04')
  await expect(win.locator('[data-list-inspector="shot-4"]'), '切到镜 04 的大详情失败').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('detail-draft')

  // ⑥ 「去画布」→ 画布，镜 04 被选中：角标 +「去列表」。
  await clickOrFail(win.locator('[data-list-detail-view-canvas]'), '去画布')
  await expect(win.locator('[data-generation-list]'), '没有切回画布').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-node-id="shot-4"] [data-storyboard-shot-label="4"]'), '镜 04 角标没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-view-in-list="shot-4"]'), '选中的镜 04 没有「去列表」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('canvas')

  // ⑦ 「去列表」→ 回列表并打开它。
  await clickOrFail(win.locator('[data-view-in-list="shot-4"]'), '去列表')
  await expect(win.locator('[data-list-inspector="shot-4"]'), '「去列表」没有打开这一张').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // ⑧ 返回列表。
  await clickOrFail(win.locator('[data-list-detail-back]'), 'back from detail')
  await expect(win.locator('[data-list-layout="grid"]'), '返回之后不是列表网格').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  console.log(`✓ generation-list-window ${suffix} → ${outDir}`)
} finally {
  await shutdown()
  fs.rmSync(root, { recursive: true, force: true })
}
