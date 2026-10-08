// 生成页「画布 | 列表」整窗走查（零额度：只播种已有结果，不触发任何生成）。
// 产出：整窗截图——列表开着（画布区换成列表，顶栏 / 左栏 / 右侧 Agent 不动）、切回画布（「镜 03」角标 + 「在列表里看」）。
// 用法：pnpm run build && node tests/ux/generation-list-window.walk.mjs [输出目录]
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { openStoryboardInList } from './_creationResourceTree.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.resolve(process.argv[2] || path.join(repoRoot, 'tests/ux/shots/generation-list-window'))
fs.mkdirSync(outDir, { recursive: true })
const locale = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const scheme = process.env.WALK_SCHEME === 'dark' ? 'dark' : 'light'
const suffix = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`

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
  T('远景，雨后便利店门口，林薇站在雨棚边', 'Wide shot, Lin Wei by the store awning after rain'),
  T('近景，林薇侧脸，水珠沿发梢滑下', 'Close-up, Lin Wei in profile, droplets run from her hair'),
  T('低机位，怀表落在积水里，车灯扫过', 'Low angle, a pocket watch in a puddle as headlights sweep'),
  T('俯拍，霓虹与湿漉漉的车道', 'Top down, neon over the wet lanes'),
  T('中景，林薇转身看向后门', 'Medium shot, Lin Wei turns to the back door'),
  T('特写，手指收紧表链', 'Insert, fingers tighten around the chain'),
]
const tones = [['#384d67', '#111827'], ['#704b45', '#201312'], ['#5d526f', '#1b1726'], ['#506a63', '#162622'], ['#87613e', '#2b1c12'], ['#476274', '#121c26']]
const titles = zh ? ['雨棚', '侧脸', '怀表', '车道', '转身', '表链'] : ['Awning', 'Profile', 'Watch', 'Lanes', 'Turn', 'Chain']
const nodes = shots.map((prompt, index) => ({
  id: `shot-${index + 1}`, kind: 'image', title: titles[index], prompt, categoryId: 'shots', shotIndex: index + 1,
  position: { x: 80 + (index % 3) * 420, y: 120 + Math.floor(index / 3) * 360 }, size: { width: 360, height: 203 },
  status: index === 3 ? 'idle' : 'success',
  meta: { storyboardDesignId: designId, shotId: `s${index + 1}`, modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '16:9' },
  ...(index === 3 ? {} : { result: { id: `r${index + 1}`, type: 'image', url: art(...tones[index]), createdAt: index + 1 } }),
}))
const design = {
  id: designId, documentId, title: T('雨夜便利店', 'Rainy convenience store'), committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
  plan: { title: T('雨夜便利店', 'Rainy convenience store'), anchors: [], shots: shots.map((prompt, index) => ({ shotId: `s${index + 1}`, index: index + 1, shotKind: 'image', durationSec: 3, anchorIds: [], prompt })) },
}
const project = {
  id: projectId, name: T('列表视图走查', 'List view walk'), version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: documentId, version: 1, title: T('雨夜来信', 'Rain letter'), updatedAt: 1, contentJson: { type: 'doc', content: [] } }],
    activeDocumentId: documentId,
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { [documentId]: [design] },
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))

let app
let win
/** 左上那一颗切换钮的特写（两态各一张）。 */
async function shotToggle(state) {
  const box = await win.locator('[data-generation-view-toggle]').boundingBox()
  if (!box) throw new Error('切换钮没有渲染')
  await win.screenshot({ path: path.join(outDir, `listview-toggle-${state}-${suffix}.png`), clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 16), width: box.width + 220, height: box.height + 40 } })
}
async function launch(name) {
  const launched = await launchNomiApp({ name, userDataDir, settingsDir, projectsDir, env: { NOMI_CAPABILITY_DIR: capabilityDir }, args: ['--disable-gpu'], timeout: 300000, settleMs: 1200 })
  app = launched.app
  win = app.windows().find((candidate) => !candidate.isClosed()) || app.firstWindow()
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1440, height: 900 })
  await win.waitForTimeout(500)
}
async function shutdown() {
  await win?.close().catch(() => {})
  await app?.close().catch(() => {})
}

try {
  await launch('generation-list-window-prime')
  await win.evaluate(({ scheme, locale }) => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi-color-scheme', scheme)
    localStorage.setItem('nomi:locale:v1', locale)
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
  await shotToggle('canvas')
  await clickOrFail(toggle.getByRole('button', { name: zh ? '切到列表' : 'Switch to list' }), '切到列表')
  await shotToggle('list')
  await expect(win.locator('[data-generation-list]'), '列表没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-list-card="shot-1"]'), '列表里没有镜 01').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await screenshotSettled(win, { path: path.join(outDir, `listview-window-list-${suffix}.png`) })

  // ② 点镜 03 → 检查器。
  await clickOrFail(win.locator('[data-list-card="shot-3"]'), '点镜 03')
  await expect(win.locator('[data-list-inspector="shot-3"]'), '检查器没有打开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await screenshotSettled(win, { path: path.join(outDir, `listview-window-inspector-${suffix}.png`) })

  // ③ 「在画布里看」→ 画布，镜 03 被选中：角标 + 「在列表里看」。
  await clickOrFail(win.locator('[data-list-inspector="shot-3"]').getByRole('button', { name: zh ? /在画布里看/ : /View in canvas/ }), '在画布里看')
  await expect(win.locator('[data-generation-list]'), '没有切回画布').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-node-id="shot-3"] [data-storyboard-shot-label="3"]'), '镜 03 角标没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(win.locator('[data-view-in-list="shot-3"]'), '选中的镜 03 没有「在列表里看」').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // 放大到能看清角标（Ctrl + 滚轮 = 画布缩放），只为截图取景。
  const box = await win.locator('[data-node-id="shot-3"]').boundingBox()
  if (box) {
    await win.mouse.move(box.x + box.width / 2, box.y + 4)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -100)
    await win.keyboard.up('Control')
    await win.waitForTimeout(400)
  }
  await screenshotSettled(win, { path: path.join(outDir, `listview-window-canvas-${suffix}.png`) })

  // ④ 「在列表里看」→ 回列表并打开它。
  await clickOrFail(win.locator('[data-view-in-list="shot-3"]'), '在列表里看')
  await expect(win.locator('[data-list-inspector="shot-3"]'), '「在列表里看」没有打开这一张').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // ⑤ 创作页点「分镜方案」→ 生成页列表、只看这份分镜；× 回到全部。
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="creation"]').first(), '切到创作页')
  await openStoryboardInList(win, designId, '创作页点分镜方案')
  await screenshotSettled(win, { path: path.join(outDir, `listview-window-deeplink-${suffix}.png`) })
  await clickOrFail(win.locator(`[data-list-filter="${designId}"] button`), '点 × 回到全部节点')
  await expect(win.locator(`[data-list-filter="${designId}"]`), '× 之后筛选条还在').toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  console.log(`✓ generation-list-window ${suffix} → ${outDir}`)
} finally {
  await shutdown()
  fs.rmSync(root, { recursive: true, force: true })
}
