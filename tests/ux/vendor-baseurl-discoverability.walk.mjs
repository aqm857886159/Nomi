import { stationTimeout } from './_station-budget.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查 —— 「我接入的中转站地址填错了，想改」的真实用户旅程（2026-08-18）。
//
// 背景：微信群两条投诉——「要改 api url，翻了半天没找到修改的地方」「api 配置需要加一个单独的
// 删除按钮」。能力自 v0.16.1 起就在 CustomVendorManage.tsx 里（改地址/换 key/删整家齐全），
// 所以这是**可发现性**问题，不是功能缺失。本走查的任务是把「翻半天」量化：从冷启动到摸到那支
// 铅笔，用户要点几下、滚多远、路上有几个岔口。
//
// 用法: pnpm run build && node tests/ux/vendor-baseurl-discoverability.walk.mjs
// 产出: tests/ux/shots/baseurl-discoverability/*.png —— 人眼判断每一屏「看得见改地址吗」。
//
// 现场按真实中转站造：一家自定义供应商 + 24 个模型（群里那位是阶跃星辰，地址填错连不上）。
// 零额度：地址指向本地 mock 的 401 路由——正是用户要去改地址的那一刻。
//
// 回归底线（别退回去）：
//   ① 首页那一行和连接详情卡头说同一个状态词（同一个展示投影），且只说本机事实：有 key、有请求格式、
//      没手动关 → 「N 个可使用」。2026-11-18 D-1117-delete-verification 删了连接健康检查：
//      此前这里要求首页行显示「连不上」，现在错地址不在设置页预判，等第一次真生成在节点上报错；
//      所以这一屏也不许出现「验证」「连不上」这类退役说法，打开设置页也不许朝供应商发任何请求。
//   ② 连接详情页**落地首屏**「修改」地址按钮就得可见可点——此前 y=817 被弹窗（底边 706）裁在窗外
//   ③ 删除整家的入口恰好 1 个——此前卡头垃圾桶 + 底部按钮两处
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'
import { clickOrFail, expectVisible, expect, screenshotSettled } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = process.env.NOMI_WALK_OUT ? path.resolve(process.env.NOMI_WALK_OUT) : path.join(repoRoot, 'tests/ux/shots/baseurl-discoverability')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = makeTempDir('nomi-baseurl-walk-')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 本地 mock 上游：/v1/wrong-path 回 401（用户填错地址的那一刻），/v1/ok 回 200 + 模型列表
//（他改对之后）。不碰外网、零额度、结果确定。
const seen = []
const server = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`)
  const ok = req.url?.startsWith('/v1/ok')
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
  res.end(JSON.stringify(ok
    ? { data: [{ id: 'step-1-8k' }, { id: 'step-2-16k' }] }
    : { error: { message: '无效的接入地址（mock 上游）' } }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const mockBase = `http://127.0.0.1:${server.address().port}`
const OK_URL = `${mockBase}/v1/ok`
const WRONG_URL = `${mockBase}/v1/wrong-path`
let vendorKey = 'stepfun-relay'
const VENDOR_NAME = '阶跃星辰中转'

let n = 0
async function snap(win, name) {
  n += 1
  const file = path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
  return file
}

const { app, win } = await launchNomiApp({
  name: 'baseurl-discoverability',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  syntheticCredentialStorage: true,
})

await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
  window.localStorage.setItem('nomi-color-scheme', 'light')
})

// ── 造现场：一家中转站 + 24 个模型，地址是错的 ──────────────────────────────
const seeded = await win.evaluate(async ({ vendorName, okUrl, wrongUrl }) => {
  const mc = window.nomiDesktop?.modelCatalog
  if (!mc) return null
  // The current credential gate validates the saved key. Register it at the
  // reachable fixture first, then edit the URL to the deliberate 401 route.
  const configured = await window.nomiDesktop.onboarding.httpConnectionConfigure({ vendorName, baseUrl: okUrl, apiKey: 'sk-walkthrough-relay', authType: 'bearer', providerKind: 'openai-compatible', headers: {}, models: [] })
  if (!configured.ok) throw new Error('Fixture relay registration failed')
  const vendorKey = configured.registration.vendorKey
  // 中转站的典型体量：一家几十个模型。数量本身就是可发现性的敌人。
  const names = [
    'step-1-8k', 'step-1-32k', 'step-1-128k', 'step-1-256k', 'step-1v-8k', 'step-1v-32k',
    'step-2-16k', 'step-1x-medium', 'step-1o-turbo-vision', 'step-2-mini', 'step-1-flash',
    'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'deepseek-chat', 'deepseek-reasoner',
    'qwen-max', 'qwen-plus', 'glm-4-plus', 'moonshot-v1-128k', 'yi-large', 'ernie-4.0',
    'doubao-pro-32k', 'hunyuan-standard',
  ]
  for (const modelKey of names) {
    mc.upsertModel({ vendorKey, modelKey, kind: 'text', enabled: true })
  }
  // 内置家也接一个：VendorOnboardCard 与自定义家共用同一份 VendorBaseUrlField，
  // 改哪面就得验哪面（R13），不能只看自定义家绿了就以为内置家没事。
  mc.upsertVendor({ key: vendorKey, baseUrlHint: wrongUrl })
  return { vendorKey, count: (await mc.listModels({ vendorKey })).filter((m) => m.vendorKey === vendorKey).length }
}, { vendorName: VENDOR_NAME, okUrl: OK_URL, wrongUrl: WRONG_URL })
vendorKey = seeded.vendorKey
console.log(`现场：${VENDOR_NAME} · ${seeded.count} 个模型 · 地址=${WRONG_URL}`)
// 造现场时保存连接那一下（存 key 的 401/403 闸）可能问过一次上游；从这里起算「用户旅程发了几个请求」。
seen.length = 0

await win.reload()
await win.waitForLoadState('domcontentloaded')
// 等「项目库首页真的渲染出来」，别拿 sleep 当完成信号——真机耗时会变，睡不够就读到空，
// 而「读到空」恰好让「不存在」类断言通过（假绿的经典来路，见 _assert.mjs 文件头）。
const libraryReady = newProjectEntry(win)
await expectVisible(libraryReady, '项目库首页', 30_000)
for (let i = 0; i < 4; i++) {
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(200)
}

// ── 旅程：像那位群友一样，从「我要改地址」开始找 ────────────────────────────
// 走通用「设置」入口——顶栏那颗「打开模型设置」是知道路的人才会用的快捷键，
// 而投诉的前提正是「不知道路」。
const SETTINGS_BUTTON = (page) => page.locator('button[aria-label="设置"]')
const steps = []
async function step(label, fn) {
  const started = steps.length + 1
  console.log(`\n— 第 ${started} 步：${label} —`)
  await fn()
  steps.push(label)
}

await step('打开应用（项目库首页）', async () => {
  await snap(win, 'library-home')
})

await step('进工作台', async () => {
  await clickOrFail(libraryReady, '新建空白项目')
  // 工作台就绪的信号 = 顶栏设置按钮出现，不是「睡 4.5 秒」。
  // 用 aria-label 精确匹配：顶栏另有一颗「打开模型设置」（直达模型页的快捷入口），
  // `*="设置"` 会同时命中它，strict mode 直接报双匹配。
  await expectVisible(SETTINGS_BUTTON(win), '工作台顶栏', 30_000)
  await snap(win, 'studio')
})

await step('点顶栏设置', async () => {
  await clickOrFail(SETTINGS_BUTTON(win), '顶栏设置按钮')
  await expectVisible(win.locator('[data-settings-dialog]'), '设置弹窗')
  await snap(win, 'settings-default-tab')
})

// 设置默认落在哪个 tab？用户此刻要自己判断「改 api url 属于哪一类」。
const tabs = await win.evaluate(() => {
  const el = document.querySelector('[data-settings-dialog]')
  if (!el) return null
  return {
    active: el.querySelector('[data-settings-tab]')?.getAttribute('data-settings-tab') ?? null,
    ids: [...el.querySelectorAll('[data-settings-tab-id]')].map((b) => ({
      id: b.getAttribute('data-settings-tab-id'),
      label: b.textContent.trim(),
    })),
  }
})
console.log('  设置页签：', JSON.stringify(tabs))

await step('切到「模型」页签', async () => {
  await clickOrFail(win.locator('[data-settings-tab-id="models"]'), '设置「模型」页签')
  await expectVisible(win.locator('[data-model-settings-page="home"]'), '模型设置首页')
  await snap(win, 'models-home')
})

// ① 首页那一行只说本机事实：24 个模型都有 key、有请求格式、没手动关 → 「24 个可使用」，绿点。
// 地址是错的这件事设置页不预判（连接健康检查已删），打开设置页一个请求都不发。
const RETIRED = /未验证|待验证|验证中|复验|验证|连不上|未试跑/
const readyWord = uiTextWith('zh-CN', 'onboardingProviders.modelStatus.count.ready', { count: seeded.count })
const homeRow = win.locator(`[data-model-home-connection="${vendorKey}"]`)
await expectVisible(homeRow, '首页已连入行')
// board:ModelConnectionStatus/list.row-status
const homeMark = homeRow.locator('[data-model-status]')
await expect(homeMark, '① 首页行的状态词只来自展示投影（ModelStatusMark）').toHaveAttribute('data-model-status', 'ready')
await expect(homeMark, '① 有 key、有格式、没关 → 绿点').toHaveAttribute('data-model-status-tone', 'success')
await expect(homeMark, '① 行尾说「N 个可使用」').toHaveText(readyWord)
await expect(homeRow, '① 首页行不许出现退役说法').not.toContainText(RETIRED)
expect(seen, '① 打开模型设置页不该朝供应商发任何请求（健康检查已删）').toEqual([])
console.log('  ✓ 首页行：', (await homeRow.innerText()).replace(/\s+/g, ' '))

await step('点进那家中转站', async () => {
  await clickOrFail(homeRow, `已连接行「${VENDOR_NAME}」`)
  await expectVisible(win.locator('[data-vendor-connection-group]'), '连接详情页的「连接」组')
  await snap(win, 'connection-page-top')
})

// board:ModelConnectionStatus/detail.badge — 详情卡头（详情模式下那颗不可点的头部按钮）的徽标和首页行同一个词。
const detailMark = win.locator('[data-model-access-entry] > div > button[disabled] [data-model-status]')
await expect(detailMark, '① 详情卡头徽标和首页行同一个状态').toHaveAttribute('data-model-status', 'ready')
await expect(detailMark, '① 详情卡头徽标和首页行说同一个词').toHaveText(readyWord)
await expect(win.locator('[data-settings-model-workspace]'), '① 详情页不许出现退役说法').not.toContainText(RETIRED)

// ── ② 核心：落地首屏「修改」地址就得可见可点（不许靠滚）─────────────────────
const editAddress = win.locator('[aria-label*="接入地址"]').first()
await expectVisible(editAddress, '② 落地连接详情页首屏，「修改」地址按钮就该可见')

const reach = await win.evaluate(() => {
  const btn = document.querySelector('[aria-label*="接入地址"]')
  const dialog = document.querySelector('[data-settings-dialog]')
  if (!btn || !dialog) return { found: false }
  const box = btn.getBoundingClientRect()
  const dlg = dialog.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return {
    found: true,
    top: Math.round(box.top),
    dialogBottom: Math.round(dlg.bottom),
    clippedByDialog: box.bottom > dlg.bottom || box.top < dlg.top,
    hitSize: `${Math.round(box.width)}×${Math.round(box.height)}`,
    minSide: Math.min(Math.round(box.width), Math.round(box.height)),
    hitTargetIsButton: btn === hit || btn.contains(hit),
  }
})
console.log('\n▶ 「修改地址」入口的可达性：', JSON.stringify(reach, null, 2))
expect(reach.clippedByDialog, '② 按钮不许被设置弹窗裁在窗外（改版前 y=817 vs 底边 706）').toBe(false)
expect(reach.hitTargetIsButton, '② 那个点上真正拿到事件的必须是按钮本身，不是遮罩层').toBe(true)
expect(reach.minSide, '② 命中区最短边 ≥24px（WCAG 2.2 AA；改版前是 17×17）').toBeGreaterThanOrEqual(24)

// ③ 删除整家的入口恰好 1 个
const deleteEntries = await win.evaluate(() => {
  const hits = []
  for (const b of document.querySelectorAll('button')) {
    const label = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.innerText}`.trim()
    // 「彻底删除 <模型名>」是单个模型的行内动作，不算整家入口。
    if (/\u6574\u4f53\u5220\u9664|delete.*(vendor|provider)/i.test(label)) {
      hits.push(label.replace(/\s+/g, ' ').slice(0, 40))
    }
  }
  return hits
})
console.log('▶ 删除整家的入口：', JSON.stringify(deleteEntries))
expect(deleteEntries, '③ 删除整家只许有一个家（改版前卡头图标 + 底部按钮 = 2 个）').toHaveLength(1)

// ── R16 真实任务闭环：把地址改对，地址真的存下、状态照旧 ─────────────────────────
await step('就地把地址改对', async () => {
  await clickOrFail(editAddress, '「修改」接入地址')
  const input = win.locator('[data-model-connection-field="baseUrl"]')
  await expectVisible(input, '地址输入框')
  await input.fill(`${mockBase}/v1/ok`)
  await snap(win, 'address-editing')
  // 用 data 钩子而不是 button:has-text('保存')——后者会连左侧「文件与保存」页签一起匹配，
  // 于是点击跑去切了 tab、地址一个字没存，而脚本还一路往下走（本轮真踩过这一脚）。
  await clickOrFail(win.locator('[data-model-connection-save="baseUrl"]'), '地址行的「保存」')
  await expectVisible(editAddress, '存完地址后回到只读态的「修改」按钮')
  await snap(win, 'after-fix')
})

// 地址存下的是用户改的那一串（读目录事实，不读界面）；存地址不探连接（健康检查已删），状态词照旧。
await expect.poll(
  () => win.evaluate(async (key) => (await window.nomiDesktop.modelCatalog.listVendors()).find((v) => v.key === key)?.baseUrlHint ?? null, vendorKey),
  { message: 'R16：改对的地址要真的写进目录', timeout: stationTimeout({ operations: 2 }) },
).toBe(OK_URL)
await expect(detailMark, 'R16：存地址后状态词照旧').toHaveText(readyWord)
expect(seen, 'R16：存地址不探连接').toEqual([])
await snap(win, 'address-saved')
console.log('  ✓ 改对的地址已写进目录，状态照旧是「可使用」')

// ── 内置家（Higgsfield）走同一份地址字段：共用组件不能只在自定义家那面成立 ────────
await step('回到模型首页，进内置家 Higgsfield', async () => {
  await clickOrFail(win.locator('[data-model-settings-page] button[aria-label*="返回"], [data-model-settings-page] header button').first(), '返回')
  await expectVisible(win.locator('[data-model-settings-page="home"]'), '模型设置首页')
  await clickOrFail(win.locator('[data-model-home-connection="higgsfield"]'), '已连接行「Higgsfield」')
  await expectVisible(win.locator('[data-model-connection-field="baseUrl"], [aria-label*="接入地址"]').first(), '内置家的地址字段')
  await snap(win, 'known-vendor-connection')
})

const knownReach = await win.evaluate(() => {
  const btn = document.querySelector('[aria-label*="接入地址"]')
  const dialog = document.querySelector('[data-settings-dialog]')
  if (!btn || !dialog) return { found: false }
  const box = btn.getBoundingClientRect()
  const dlg = dialog.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return {
    found: true,
    clippedByDialog: box.bottom > dlg.bottom || box.top < dlg.top,
    minSide: Math.min(Math.round(box.width), Math.round(box.height)),
    hitTargetIsButton: btn === hit || btn.contains(hit),
  }
})
console.log('▶ 内置家「修改地址」入口：', JSON.stringify(knownReach))
expect(knownReach.found, '内置家也要有「修改」地址入口').toBe(true)
expect(knownReach.clippedByDialog, '内置家的地址入口不许被裁在窗外').toBe(false)
expect(knownReach.hitTargetIsButton, '内置家的地址入口要真的点得着').toBe(true)
expect(knownReach.minSide, '内置家的命中区也要 ≥24px').toBeGreaterThanOrEqual(24)

console.log(`\n旅程步数：${steps.length} 步 —— ${steps.join(' → ')}`)
console.log(`截图目录：${shotsDir}`)

server.close()
await app.close().catch(() => {})
