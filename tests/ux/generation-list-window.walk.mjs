// 生成页「画布 | 列表」整窗走查（零额度：只播种已有结果，不触发任何生成）。1280×800，隔离资料目录，Electron 屏外。
// 产出：整窗截图——列表、大详情（已生成 / 生成中 / 失败 / 还没生成）、切回画布（「镜 03」角标 + 「去列表」）。
// 用法：pnpm run build && node tests/ux/generation-list-window.walk.mjs [输出目录]
//   WALK_LOCALE=en 英文；WALK_SCHEME=dark 暗色（四轨：中光 / 中暗 / 英光 / 英暗）。
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { switchGenerationView } from './_shell.mjs'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.resolve(process.argv[2] || path.join(repoRoot, 'tests/ux/shots/generation-list-window'))
fs.mkdirSync(outDir, { recursive: true })
const locale = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const scheme = process.env.WALK_SCHEME === 'dark' ? 'dark' : 'light'
const suffix = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : '-light'}`

const root = makeTempDir('nomi-generation-list-')
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const art = (from, to, w = 320, h = 180) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.66}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.15}" fill="rgba(255,235,192,.28)"/><path d="M0 ${h * 0.78} Q ${w * 0.28} ${h * 0.58}, ${w * 0.54} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H0Z" fill="rgba(16,20,27,.42)"/></svg>`)
// 假供应商（本机回环，零真实付费）+ 两个可选图片模型：让生成框里的模式 / 画幅 / 清晰度 / 模型选择都出现，并能核对「换模型后请求里的 model 跟着变」。
const NOW = '2026-10-10T00:00:00.000Z'
const VENDOR = 'list-mock'
const IMAGE_A = 'list-image-a'
const IMAGE_B = 'list-image-b'
const wireCalls = []
const imageBytes = fs.readFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'))
const vendorServer = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* 非 JSON 当空 */ }
    if (req.method !== 'POST' || req.url !== '/v1/images/generations') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'No route' } }))
      return
    }
    wireCalls.push({ model: String(body.model || ''), prompt: String(body.prompt || '') })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ url: 'data:image/jpeg;base64,' + imageBytes.toString('base64') }] }))
  })
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const vendorPort = vendorServer.address().port
const imageMapping = (modelKey, taskKind) => ({
  id: modelKey + '-' + taskKind, vendorKey: VENDOR, taskKind, modelKey, name: modelKey + ' ' + taskKind, enabled: true,
  create: {
    method: 'POST', path: '/v1/images/generations', headers: { 'Content-Type': 'application/json' },
    body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}', extra_body: { response_format: 'url', ...(taskKind === 'image_edit' ? { image: '{{request.params.image}}' } : {}) } },
    response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' },
  },
  createdAt: NOW, updatedAt: NOW,
})
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{ key: VENDOR, name: 'List Mock', enabled: true, baseUrlHint: 'http://127.0.0.1:' + vendorPort, assetIngestion: { strategy: 'inline-base64', accepts: ['image'] }, authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW }],
  models: [
    { modelKey: IMAGE_A, vendorKey: VENDOR, labelZh: '列表图片 A', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: IMAGE_B, vendorKey: VENDOR, labelZh: '列表图片 B', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [IMAGE_A, IMAGE_B].flatMap((modelKey) => [imageMapping(modelKey, 'text_to_image'), imageMapping(modelKey, 'image_edit')]),
  apiKeysByVendor: {},
}, null, 2))
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
const modelMeta = { modelKey: IMAGE_A, modelVendor: VENDOR, aspect_ratio: '16:9' }
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
  meta: { modelKey: IMAGE_A, modelVendor: VENDOR, aspect_ratio: '16:9' },
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

// 生成框的几个状态（框本身 / 参数面板：画幅 + 清晰度 / 模型选择），用于画布与列表详情逐个对比。
async function composerStates(scope) {
  const root = win.locator(scope).first()
  const grab = async () => {
    const box = await root.boundingBox()
    const x = Math.max(0, box.x - 24)
    const y = Math.max(0, box.y - 260)
    return win.screenshot({ clip: { x, y, width: Math.min(1280 - x, box.width + 48), height: Math.min(800 - y, box.y - y + box.height + 110) } })
  }
  const base = await grab()
  await root.locator('[data-parameter-summary]').click()
  await win.waitForTimeout(500)
  const params = await grab()
  await root.locator('[data-node-composer-prompt]').click()
  await win.waitForTimeout(300)
  await root.locator('button[aria-haspopup="listbox"]').click()
  await win.waitForTimeout(500)
  const models = await grab()
  await root.locator('[data-node-composer-prompt]').click()
  await win.waitForTimeout(300)
  return [base, params, models]
}
// 换模型并生成：认假供应商那头收到的请求里 model 是不是跟着变。
async function pickModelAndGenerate(scope, label, expectedModel, callsBefore) {
  const root = win.locator(scope).first()
  await root.locator('button[aria-haspopup="listbox"]').click()
  await win.waitForTimeout(500)
  await clickOrFail(win.getByRole('option', { name: label }), '选模型 ' + label)
  await clickOrFail(root.locator('[data-bar-segment="generate"]'), '生成框的 ↑')
  const deadline = Date.now() + 30000
  while (wireCalls.length <= callsBefore && Date.now() < deadline) await win.waitForTimeout(250)
  expect(wireCalls.length, '假供应商没收到请求').toBe(callsBefore + 1)
  expect(wireCalls[callsBefore].model, '请求里的 model 没有跟着生成框里选的模型走').toBe(expectedModel)
}

// 顶栏切换图标的悬停 tooltip：列表里应是「切到画布」，画布上应是「切到列表」（Radix 只在指针重新进入时才开，所以先挪开再进入）。
async function hoverSwitcher(view) {
  const switcherButton = win.locator('[data-shell-topbar] [data-generation-view-switcher]')
  const box = await switcherButton.boundingBox()
  const tip = win.locator('[role="tooltip"]', { hasText: view === 'list' ? /^(切到画布|Switch to canvas)$/ : /^(切到列表|Switch to list)$/ }).last()
  // 悬停偶发赶在页面还在布局时落空：最多重进三次。
  for (let attempt = 0; attempt < 3 && !(await tip.isVisible().catch(() => false)); attempt += 1) {
    await win.mouse.move(640, 500)
    await win.waitForTimeout(400)
    await win.mouse.move(box.x + box.width / 2 - 3, box.y + box.height / 2)
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
    await win.waitForTimeout(700)
  }
  await expect(tip, '悬停后没有 tooltip').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await dismissToasts()
  await win.screenshot({ path: path.join(outDir, `listview-switcher-hover${view === 'list' ? '' : '-canvas'}-${suffix}.png`) })
  await win.mouse.move(640, 500)
}

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
  // 「画布 ↔ 列表」是 40px 顶栏里的一个图标（外壳 viewSwitcher 槽），生成页才出现；切换一律经 _shell.mjs 的 switchGenerationView。
  await expect(win.locator('[data-shell-topbar] [data-generation-view-switcher]'), '顶栏里没有「画布 ↔ 列表」切换').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  // ① 切到列表：画布区换成列表，其余不动。
  await switchGenerationView(win, 'list')
  await expect(win.locator('[data-generation-list]'), '列表没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-list-card="shot-1"]'), '列表里没有镜 01').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-section-generate]').first(), '分区头没有「生成全部」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await shot('list')
  // 顶栏那个图标：悬停看 tooltip（列表里显示的是「切到画布」）。
  await hoverSwitcher('list')
  await win.mouse.move(640, 500)

  // ①b 分区头「生成全部」→ 同一张付费确认、按项勾选（没生成的勾上、已生成的不勾）；取消 = 什么都不发生。
  await clickOrFail(win.locator('[data-section-generate]').first(), 'generate all')
  const checklist = win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]')
  await expect(checklist.first(), 'the confirm card has no checklist').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  expect(await checklist.count(), 'one checkbox per shot of the section').toBe(6)
  expect(await win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:checked').count(), 'idle + failed shots ticked by default').toBe(2)
  await shot('confirm')
  // 点一下，受控的框必须真翻转（以前行数据只传一次、点了被弹回，派发对而框不动）。
  const ticked = win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:checked').first()
  await ticked.click()
  expect(await win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:checked').count(), '点掉一项后框没有翻转').toBe(1)
  await win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:not(:checked):not(:disabled)').first().click()
  expect(await win.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:checked').count(), '勾上一项后框没有翻转').toBe(2)
  await win.keyboard.press('Escape')
  await expect(checklist.first(), 'the card did not close').toBeHidden({ timeout: DEFAULT_TIMEOUT_MS })

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
  // 同一个节点（镜 04）的生成框：先抓列表详情里的（host=inline），下面再抓画布上的，并排放进一张图对版面。
  const inlineComposer = await win.locator('[data-inspector-composer] [data-composer-host="inline"]').screenshot()
  // 预览和生成框在同一条竖直中线上（窗口 1280 与 1600 两档，差 <= 1px）。
  const centerGap = () => win.evaluate(() => {
    const centerOf = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return rect.left + rect.width / 2 }
    return Math.abs(centerOf('[data-list-detail-preview]') - centerOf('[data-inspector-composer] .generation-canvas-v2-node__composer-card'))
  })
  const gap1280 = await centerGap()
  expect(gap1280 <= 1, '1280 宽：预览与生成框的水平中心差 ' + gap1280.toFixed(1) + 'px，超过 1px').toBe(true)
  const browserWindowRef = await app.browserWindow(win)
  await browserWindowRef.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1600, height: 800 })
  await win.waitForTimeout(700)
  const gap1600 = await centerGap()
  expect(gap1600 <= 1, '1600 宽：预览与生成框的水平中心差 ' + gap1600.toFixed(1) + 'px，超过 1px').toBe(true)
  await browserWindowRef.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1280, height: 800 })
  await win.waitForTimeout(700)
  const listStates = await composerStates('[data-inspector-composer] [data-composer-host="inline"]')

  // ⑥ 「去画布」→ 画布，镜 04 被选中：分镜号角标；页面里没有任何「去列表」入口，只有顶栏那一个图标。
  await clickOrFail(win.locator('[data-list-detail-view-canvas]'), '去画布')
  await expect(win.locator('[data-generation-list]'), '没有切回画布').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-node-id="shot-4"] [data-storyboard-shot-label="4"]'), '镜 04 角标没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // 探针要先证明「按名字找按钮」在这一屏是活的：顶栏那个切换钮（画布上叫「切到列表」）找得到。
  const switcherProof = await proveProbe(win.getByRole('button', { name: /^(切到列表|Switch to list)$/ }), '顶栏的「切到列表」按钮（同一种按名字找按钮的探针）')
  await expectAbsent(win.getByRole('button', { name: /^(去列表|在列表里看|Open list|View in list)$/ }), { provenBy: switcherProof, message: '页面里不该再有「去列表」入口（只有顶栏那一个图标）' })
  await expect(win.locator('[data-shell-topbar] [data-generation-view-switcher="canvas"]'), '画布上顶栏图标显示的应是「切到列表」').toHaveAttribute('aria-label', /切到列表|Switch to list/)
  await shot('canvas')
  await hoverSwitcher('canvas')
  const canvasComposer = await win.locator('[data-composer-host="canvas"]').first().screenshot()
  const canvasStates = await composerStates('[data-composer-host="canvas"]')

  // ⑦ 顶栏图标 → 回列表（详情还开着这一张）。
  await switchGenerationView(win, 'list')
  await expect(win.locator('[data-list-inspector="shot-4"]'), '切回列表后详情没了').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // ⑧ 返回列表。
  await clickOrFail(win.locator('[data-list-detail-back]'), 'back from detail')
  await expect(win.locator('[data-list-layout="grid"]'), '返回之后不是列表网格').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // ⑨ 换模型并生成（零真实付费：假供应商在本机回环上）：列表详情选 B → 发的是 B；画布生成框选回 A → 发的是 A。
  await clickOrFail(win.locator('[data-list-card="shot-4"]'), '打开镜 04 详情')
  await expect(win.locator('[data-list-inspector="shot-4"]'), '镜 04 详情没打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await pickModelAndGenerate('[data-inspector-composer] [data-composer-host="inline"]', '列表图片 B', IMAGE_B, 0)
  await switchGenerationView(win, 'canvas')
  await win.locator('[data-node-id="shot-4"]').click()
  // 生成后画布里这张图被拉高，生成框落在时间轴条后面：把画布往上推一点让整个生成框可点。
  await win.mouse.move(640, 300)
  await win.mouse.wheel(0, 320)
  await win.waitForTimeout(500)
  await pickModelAndGenerate('[data-composer-host="canvas"]', '列表图片 A', IMAGE_A, 1)
  // 并排：左 = 画布节点的生成框，右 = 列表详情里的（同一个组件、同一套排版）。无头 Chromium 渲染一张对比图，不开可见窗口。
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 })
    const dataUri = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`
    const rowLabels = [T('生成框', 'Composer'), T('参数面板（画幅 / 清晰度）', 'Parameters (ratio / size)'), T('模型选择', 'Model picker')]
    const rows = [canvasComposer, ...canvasStates.slice(1)].map((left, index) => `<div style="display:flex;gap:24px;align-items:flex-start;margin-bottom:14px"><div><div style="margin-bottom:6px">${T('画布', 'Canvas')} · ${rowLabels[index]}</div><img src="${dataUri(left)}"></div><div><div style="margin-bottom:6px">${T('列表详情', 'List detail')} · ${rowLabels[index]}</div><img src="${dataUri(index === 0 ? inlineComposer : listStates[index])}"></div></div>`).join('')
    await page.setContent(`<body style="margin:0;padding:16px;background:${scheme === 'dark' ? '#1d1c1a' : '#f4f2ef'};color:${scheme === 'dark' ? '#ddd' : '#333'};font:12px sans-serif">${rows}</body>`)
    await page.screenshot({ path: path.join(outDir, `listview-composer-sidebyside-${suffix}.png`), fullPage: true })
  } finally {
    await browser.close()
  }
  console.log(`✓ generation-list-window ${suffix} → ${outDir}`)
} finally {
  await shutdown()
  await new Promise((resolve) => vendorServer.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
}
