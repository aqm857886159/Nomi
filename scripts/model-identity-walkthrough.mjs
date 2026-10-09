import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查 · 模型身份合并 + Sora 2 退役（2026-09-28）。零供应商调用、零花费、不碰真实资料与真密钥。
//
// 夹具（全部在临时目录里现造）：
//   · 目录 = applyBuiltinSeeds 新装机 + APIMart / Kie / 火山方舟 / fal / Runway / RunningHub 六家的**占位钥匙**
//     （用本机 safeStorage 加密的 "nomi-walk-placeholder"，不是任何真 key）。钥匙直接写进目录，
//     **不走** upsertVendorApiKey——那条路会对 APIMart 发一次余额探针。
//   · 主进程出门请求一律被 scripts/walkthrough-network-guard.cjs 拦下并记账（启动器的 mainRequire 把它作为
//     `-r` 放在 App 入口前，App 代码加载前就装上——Playwright 会删掉 NODE_OPTIONS，那条路不通）；
//     走查末尾列出每一次被拦的尝试，且要求闸确实装上了，否则判「零调用未证明」。
//   · 项目 = 一个视频节点、一个图片节点、两个**存着 Sora 2 的老视频节点**（升级前的旧项目长这样；
//     中文、英文界面各用一个）。
//
// 验什么（截图写进 .model-identity-walk/，人眼核对）：
//   ① 中英两种界面：视频模型框里 Seedance 2.5、图片模型框里 GPT Image 2 / Nano Banana 2 各只出现一次，
//      并进来的渠道行（Seedance 2.5 · fal、Runway Seedance 2.5、Runway GPT Image 2、Nano Banana 2 · fal…）不再单列；
//      模型框里没有 Sora 2；模型名跟着界面语言走（英文界面是「Gemini 3 Pro Image」「Kling 3.0」，不是中文原名）；
//   ② 默认 chip（没排过供应商顺序、没点过）是分级表推出来的那一家：Seedance 2.5 → 火山方舟，
//      GPT Image 2 / Nano Banana 2 → APIMart；
//   ③ 把 Seedance 2.5 切到 fal、GPT Image 2 切到 Runway，重启 App 重开节点，选择还在（界面 + 落盘两处都核）；
//   ④ 老项目里的 Sora 2 节点能打开，点生成落「这个模型已经下线了」+「换个模型」（英文界面落对应英文），
//      卡里没有技术签名、没有「服务商原话」框、没有「仍要重试」，正文对任何下线原因都成立；
//      点「换个模型」换成 Seedance 2.5 后参数面板正常。
//
// 用法：pnpm build 后 node scripts/model-identity-walkthrough.mjs
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentCatalogVersion, launchNomiApp, withLinuxNoSandbox, withLinuxSyntheticCredentialStorage } from '../tests/ux/_launchApp.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.model-identity-walk')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const tempRoot = makeTempDir('nomi-model-identity-walk-')
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })
const netLog = path.join(tempRoot, 'network-guard.jsonl')
const guardPath = path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')

const NOW = '2026-09-28T00:00:00.000Z'
const CONNECTED = ['apimart', 'kie', 'volcengine', 'fal', 'runway', 'runninghub']
const PROJECT_ID = 'model-identity-walk'
const PROJECT_NAME = '模型身份走查'
const projectRoot = path.join(projectsDir, `walk-${PROJECT_ID}`)

const T = {
  'zh-CN': { model: '模型', provider: '供应商', volc: '火山方舟', generate: '生成素材', confirm: '生成', retired: '这个模型已经下线了', retiredHint: '它已经不在模型列表里了', retryAlt: '仍要重试', switchModel: '换个模型', more: '更多', providerWords: '服务商原话', gemini: 'Gemini 3 Pro 图像', kling: '可灵 3.0' },
  en: { model: 'Model', provider: 'Provider', volc: 'Volcengine Ark', generate: 'Generate asset', confirm: 'Generate', retired: 'This model has been removed', retiredHint: "It's no longer in the model list", retryAlt: 'Retry anyway', switchModel: 'Switch model', more: 'More', providerWords: 'Provider message', gemini: 'Gemini 3 Pro Image', kling: 'Kling 3.0' },
}

let failed = false
const shots = []
const fail = (message) => { failed = true; console.log(`  ✗ ${message}`) }
const pass = (message) => console.log(`  ✓ ${message}`)
const expectThat = (condition, message) => (condition ? pass(message) : fail(message))

// ── 夹具 ─────────────────────────────────────────────────────────────────────
function encryptPlaceholderKey() {
  const script = path.join(repoRoot, 'tests', 'ux', '_encryptFixtureKey.cjs')
  const result = spawnSync(require('electron'), withLinuxSyntheticCredentialStorage(withLinuxNoSandbox([script, 'nomi-walk-placeholder']), true), {
    cwd: repoRoot,
    env: { ...process.env, NOMI_E2E: '1', NOMI_APP_NAME: 'nomi', NOMI_ELECTRON_USER_DATA_DIR: userDataDir, NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE: '1' },
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`占位钥匙加密失败：${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

async function writeCatalog() {
  const { require: tsxRequire } = await import('tsx/cjs/api')
  const { applyBuiltinSeeds } = tsxRequire('../electron/catalog/seedBuiltins.ts', import.meta.url)
  const seeded = applyBuiltinSeeds({ version: currentCatalogVersion(), vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW).state
  const cipher = encryptPlaceholderKey()
  const apiKeysByVendor = Object.fromEntries(CONNECTED.map((vendorKey) => [vendorKey, {
    vendorKey, apiKey: cipher, enc: 'safeStorage', enabled: true, createdAt: NOW, updatedAt: NOW,
  }]))
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ ...seeded, apiKeysByVendor }))
}

function writeProject() {
  const node = (id, kind, x, y, prompt, meta = {}) => ({
    id, kind, categoryId: 'shots', title: id, prompt, position: { x, y }, exactPosition: true, size: { width: 420, height: 260 }, meta,
  })
  const soraMeta = {
    modelKey: 'sora-2', modelAlias: 'sora-2', modelVendor: 'apimart', vendor: 'apimart', modelLabel: 'Sora 2',
    videoModel: 'sora-2', videoModelVendor: 'apimart', archetype: { id: 'sora-2', modeId: 't2v', variantId: 'standard' },
    duration: 4, aspect_ratio: '16:9', resolution: '720p',
  }
  const nodes = [
    node('vid-merge', 'video', 360, 60, '一只纸鹤在风里慢慢展开翅膀'),
    node('img-merge', 'image', 860, 60, '雨后的青石板小巷，暖色路灯'),
    node('vid-sora', 'video', 360, 460, '海浪拍打礁石，慢镜头', soraMeta),
    node('vid-sora-en', 'video', 860, 460, 'Waves crashing on the rocks, slow motion', soraMeta),
  ]
  const generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 0.75, canvasPan: { x: 120, y: 20 } }
  const payload = { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
  // 带上 App 自己建项目时就有的身份字段：缺了它们，首次打开会做一次迁移写，而那次写不刷新同步基线，
  // 下一次启动项目库就会误报「发现另一台电脑的项目更新」（见报告里的走查发现）。
  const project = { id: PROJECT_ID, name: PROJECT_NAME, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, immutableProjectUuid: crypto.randomUUID(), projectGeneration: 1, lastKnownRootPath: projectRoot, workbenchDocument: null, timeline: null, generationCanvas, payload }
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project))
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project))
}

// ── 小工具 ───────────────────────────────────────────────────────────────────
async function poll(read, { timeout = 15000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  let last = await read()
  while (!last && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    last = await read()
  }
  return last
}

async function shot(win, name) {
  const file = path.join(outDir, name)
  await win.screenshot({ path: file })
  shots.push(file)
  console.log(`  📸 ${name}`)
}

/** 只拍一个元素（退役卡特写），逐字核对文案用。 */
async function shotElement(locator, name) {
  const file = path.join(outDir, name)
  await locator.screenshot({ path: file })
  shots.push(file)
  console.log(`  📸 ${name}`)
}

function launch() {
  return launchNomiApp({
    name: 'model-identity-walk',
    tempRoot,
    userDataDir,
    settingsDir,
    projectsDir,
    syntheticCredentialStorage: true,
    initialLocalStorage: { 'nomi:locale:v1': 'zh-CN' },
    args: ['--no-proxy-server'],
    // 网络闸经启动器的 mainRequire 以 `-r` 装在 App 入口之前（NODE_OPTIONS 会被 Playwright 删掉，见 _launchApp.mjs）。
    mainRequire: [guardPath],
    env: { NOMI_WALK_NET_LOG: netLog },
  })
}

async function setBounds(app, win) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((target) => target.setBounds({ x: 0, y: 0, width: 1600, height: 1050 })).catch(() => undefined)
}

/** 进到这个项目的生成画布：项目卡 → 工作区切到「生成」；两步都按需做，等到节点出现为止。 */
async function openCanvas(win) {
  const ready = await poll(async () => {
    if ((await win.locator('.react-flow__node[data-id="vid-merge"]').count()) > 0) return true
    // 项目卡：名字区单击留给双击改名，缩略图区单击才打开（ProjectLibraryPage 的既定交互）。
    const card = win.locator('[data-project-card="true"]').filter({ hasText: PROJECT_NAME }).first()
    if (await card.isVisible().catch(() => false)) { await card.click({ position: { x: 60, y: 50 } }).catch(() => undefined); return false }
    const tab = win.locator('[aria-label="工作区切换"], [aria-label="Switch workspace"]').getByText(/^(生成|Generate)$/).first()
    if (await tab.isVisible().catch(() => false)) await tab.click().catch(() => undefined)
    return false
  }, { timeout: 30000, interval: 800 })
  if (!ready) {
    await shot(win, `diag-open-canvas-${Date.now()}.png`).catch(() => undefined)
    const visible = await win.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '')
    // 屏上看得见节点、选择器却数到 0 的时候，把「那张卡在 DOM 里挂在哪」一并打出来，别再靠猜。
    const dom = await win.evaluate(() => {
      const label = Array.from(document.querySelectorAll('*')).find((element) => element.children.length === 0 && (element.textContent || '').trim() === 'vid-merge')
      const chain = []
      for (let node = label; node && chain.length < 12; node = node.parentElement) {
        const cls = typeof node.className === 'string' && node.className.trim() ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''
        const id = node.getAttribute('data-id') ? `[data-id=${node.getAttribute('data-id')}]` : ''
        chain.splice(chain.length, 0, `${node.tagName.toLowerCase()}${cls}${id}`)
      }
      return { rfNodes: document.querySelectorAll('.react-flow__node').length, dataIds: document.querySelectorAll('[data-id]').length, chain }
    }).catch((error) => ({ error: String(error) }))
    throw new Error(`打不开走查项目的生成画布（节点没出现）。DOM：${JSON.stringify(dom)}。屏上文字：${visible}`)
  }
}

const composer = (win) => win.locator('.generation-canvas-v2-node__composer').first()

/**
 * 把节点平移到画布可视区中间再选中。
 * 为什么要平移：打开项目时画布按内容自适应，最左边那张卡贴着左栏；而生成框（560px）居中挂在卡下面，
 * 比卡宽，左半截会伸到左侧栏底下——点模型框会被侧栏吞掉。平移用的是真实手势（空白处左键拖）。
 */
async function centerNode(win, id) {
  const plan = await win.evaluate((nodeId) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)
    if (!stage || !node) return null
    const s = stage.getBoundingClientRect()
    const n = node.getBoundingClientRect()
    // 右侧的 Agent 面板浮在画布上面：真正看得见的画布只到面板左边。沿几条水平线从右往左找，
    // 第一个落在画布里的点就是可视区右边界（面板收起时就是整块画布）。
    let visibleRight = s.left + 40
    for (const fy of [0.3, 0.5, 0.7]) {
      const y = s.top + s.height * fy
      for (let x = s.right - 4; x > s.left + 40; x -= 8) {
        const hit = document.elementFromPoint(x, y)
        if (hit && stage.contains(hit)) {
          visibleRight = Math.max(visibleRight, x)
          break
        }
      }
    }
    // 生成框在卡下方，卡的中心放在可视区水平中线偏左、偏上的位置，给下面的生成框留地方。
    const target = { x: s.left + (visibleRight - s.left) * 0.42, y: s.top + Math.min(260, s.height * 0.3) }
    const dx = Math.round(target.x - (n.left + n.width / 2))
    const dy = Math.round(target.y - (n.top + n.height / 2))
    for (let y = s.top + 40; y < s.bottom - 40; y += 30) {
      for (let x = s.left + 40; x < visibleRight - 20; x += 30) {
        const endX = x + dx
        const endY = y + dy
        if (endX < s.left + 10 || endX > visibleRight - 10 || endY < s.top + 10 || endY > s.bottom - 10) continue
        if (document.elementFromPoint(x, y)?.matches('.react-flow__pane')) return { x, y, dx, dy }
      }
    }
    return { x: null, y: null, dx, dy }
  }, id)
  if (!plan) throw new Error(`画布上找不到节点 ${id}`)
  if (Math.abs(plan.dx) < 8 && Math.abs(plan.dy) < 8) return
  if (plan.x === null) throw new Error(`找不到能拖动画布的空白处（节点 ${id} 需要平移 ${plan.dx},${plan.dy}）`)
  await win.mouse.move(plan.x, plan.y)
  await win.mouse.down()
  await win.mouse.move(plan.x + plan.dx, plan.y + plan.dy, { steps: 16 })
  await win.mouse.up()
}

async function selectNode(win, id) {
  await win.keyboard.press('Escape')
  await centerNode(win, id)
  await win.locator(`.react-flow__node[data-id="${id}"]`).first().click({ position: { x: 30, y: 30 } })
  const shown = await poll(() => composer(win).isVisible().catch(() => false), { timeout: 10000 })
  if (!shown) throw new Error(`选中节点 ${id} 后没出现生成框`)
}

async function openModelBox(win, lang) {
  await composer(win).locator(`[aria-label="${T[lang].model}"]`).first().click()
  const open = await poll(async () => (await win.locator('[role="option"]:visible').count()) > 0, { timeout: 10000 })
  if (!open) throw new Error('模型框点开了却没有选项')
  // 旧款折在「更多」后面：展开，保证下面的「不再单列」断言覆盖到每一行。
  const moreToggle = win.locator('button', { hasText: new RegExp(`^${T[lang].more}$`) }).last()
  if (await moreToggle.isVisible().catch(() => false)) await moreToggle.click()
}

async function readRows(win) {
  return win.locator('[role="option"]:visible').evaluateAll((elements) => elements.map((element) => ({
    label: (element.querySelector('[data-nomi-select-option-label]')?.textContent || '').trim(),
    chips: Array.from(element.querySelectorAll('button[aria-pressed]')).map((chip) => ({
      label: (chip.getAttribute('aria-label') || '').trim(),
      active: chip.getAttribute('aria-pressed') === 'true',
    })),
    more: Array.from(element.querySelectorAll('span')).map((span) => (span.textContent || '').trim()).find((text) => /^\+\d+/.test(text)) || '',
  })))
}

async function revealRow(win, label) {
  const row = win.locator('[role="option"]:visible').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first()
  await row.scrollIntoViewIfNeeded().catch(() => undefined)
  await row.hover().catch(() => undefined)
  return row
}

async function pickRow(win, label) {
  const row = await revealRow(win, label)
  await row.locator('[data-nomi-select-option-label]').click()
}

/** 打开参数面板（chips 形态是「更多参数」按钮，summary 形态是摘要 pill，两种锚点都不依赖语言）。 */
async function openParameterPanel(win) {
  await composer(win).locator('[data-parameter-more="true"], [data-parameter-summary]').first().click()
  const panel = win.locator('[data-agent-parameter-panel="true"]').first()
  const open = await poll(() => panel.isVisible().catch(() => false), { timeout: 8000 })
  if (!open) throw new Error('参数面板没打开')
  return panel
}

async function checkedProvider(win, lang) {
  const group = win.locator(`[role="radiogroup"][aria-label="${T[lang].provider}"]`).first()
  if (!(await group.isVisible().catch(() => false))) return null
  return (await group.locator('[role="radio"][aria-checked="true"]').first().textContent().catch(() => ''))?.trim() || null
}

function rowSummary(row) {
  if (!row) return '（无此行）'
  return `${row.label} | chips: ${row.chips.map((chip) => `${chip.label}${chip.active ? '●' : ''}`).join(' / ')} ${row.more}`.trim()
}

// ── ① ② 模型框（中英两种界面）───────────────────────────────────────────────
const MERGED_AWAY = {
  video: /^(Seedance 2\.5 · fal|Runway Seedance 2\.5|Runway Hailuo 3|Runway Wan 3|Runway Grok Imagine 1\.5|Gemini Omni Flash 1\.1 · fal|Runway Gemini Omni Flash|Runway HappyHorse 1\.0)$/,
  image: /^(Runway GPT Image 2|Nano Banana 2 · fal|Runway Gemini Image 3\.1 Flash|Runway Gemini 2\.5 Flash Image|Seedream 5\.0 Pro · fal|Runway Seedream 5 Pro|Runway Seedream 5 Lite)$/,
}
const CHANNEL_NAMED = /( · fal$|^Runway )/

async function checkModelBoxes(win, lang) {
  console.log(`\n[${lang}] 模型框`)
  await selectNode(win, 'vid-merge')
  await openModelBox(win, lang)
  let rows = await readRows(win)
  const seedance = rows.filter((row) => row.label === 'Seedance 2.5')
  expectThat(seedance.length === 1, `视频：Seedance 2.5 只出现一次（${seedance.length} 行）`)
  expectThat(!rows.some((row) => MERGED_AWAY.video.test(row.label)), `视频：并进来的渠道行不再单列（残留：${rows.filter((row) => MERGED_AWAY.video.test(row.label)).map((row) => row.label).join('、') || '无'}）`)
  expectThat(!rows.some((row) => /sora/i.test(row.label)), '视频：模型框里没有 Sora 2')
  const seedanceRow = seedance[0]
  console.log(`    Seedance 2.5 行：${rowSummary(seedanceRow)}`)
  expectThat(seedanceRow?.chips.find((chip) => chip.active)?.label === T[lang].volc, `视频：Seedance 2.5 默认 chip = ${T[lang].volc}`)
  console.log(`    视频框里仍带渠道名的行：${rows.filter((row) => CHANNEL_NAMED.test(row.label)).map((row) => row.label).join('、') || '无'}`)
  expectThat(rows.some((row) => row.label === T[lang].kling), `视频：可灵 3.0 在这个语言下显示为「${T[lang].kling}」`)
  if (lang === 'en') {
    const cjk = rows.filter((row) => /[\u4e00-\u9fff]/.test(row.label)).map((row) => row.label)
    expectThat(!rows.some((row) => row.label === T['zh-CN'].kling), `视频：英文界面不再显示「${T['zh-CN'].kling}」`)
    console.log(`    英文视频框里仍是中文的行：${cjk.join('、') || '无'}`)
  }
  await revealRow(win, 'Seedance 2.5')
  await shot(win, `${lang}-video-model-box.png`)
  await win.keyboard.press('Escape')

  await selectNode(win, 'img-merge')
  await openModelBox(win, lang)
  rows = await readRows(win)
  for (const label of ['GPT Image 2', 'Nano Banana 2']) {
    const hits = rows.filter((row) => row.label === label)
    expectThat(hits.length === 1, `图片：${label} 只出现一次（${hits.length} 行）`)
    console.log(`    ${label} 行：${rowSummary(hits[0])}`)
    expectThat(hits[0]?.chips.find((chip) => chip.active)?.label === 'APIMart', `图片：${label} 默认 chip = APIMart`)
  }
  expectThat(!rows.some((row) => MERGED_AWAY.image.test(row.label)), `图片：并进来的渠道行不再单列（残留：${rows.filter((row) => MERGED_AWAY.image.test(row.label)).map((row) => row.label).join('、') || '无'}）`)
  console.log(`    图片框里仍带渠道名的行：${rows.filter((row) => CHANNEL_NAMED.test(row.label)).map((row) => row.label).join('、') || '无'}`)
  expectThat(rows.some((row) => row.label === T[lang].gemini), `图片：Gemini 3 Pro 在这个语言下显示为「${T[lang].gemini}」`)
  if (lang === 'en') {
    const cjk = rows.filter((row) => /[\u4e00-\u9fff]/.test(row.label)).map((row) => row.label)
    expectThat(!rows.some((row) => row.label === T['zh-CN'].gemini), `图片：英文界面不再显示「${T['zh-CN'].gemini}」`)
    console.log(`    英文图片框里仍是中文的行：${cjk.join('、') || '无'}`)
  }
  await revealRow(win, 'GPT Image 2')
  await shot(win, `${lang}-image-model-box.png`)
  if (lang === 'en') {
    await revealRow(win, T.en.gemini)
    await shot(win, 'en-image-model-box-gemini-label.png')
  }
  await win.keyboard.press('Escape')
}

async function switchLocale(win, locale) {
  await win.evaluate((value) => window.localStorage.setItem('nomi:locale:v1', value), locale)
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await openCanvas(win)
}

// ── ③ 切到 fal / Runway ──────────────────────────────────────────────────────
async function switchProvider(win, nodeId, modelLabel, providerLabel, shotName) {
  await selectNode(win, nodeId)
  await openModelBox(win, 'zh-CN')
  await pickRow(win, modelLabel)
  const picked = await poll(async () => ((await composer(win).locator(`[aria-label="${T['zh-CN'].model}"]`).first().textContent()) || '').includes(modelLabel), { timeout: 8000 })
  expectThat(Boolean(picked), `${nodeId}：选中 ${modelLabel}`)
  await openParameterPanel(win)
  const group = win.locator(`[role="radiogroup"][aria-label="${T['zh-CN'].provider}"]`).first()
  const options = (await group.locator('[role="radio"]').allTextContents()).map((text) => text.trim())
  console.log(`    ${modelLabel} 的供应商：${options.join(' / ')}`)
  await group.locator('[role="radio"]', { hasText: providerLabel }).first().click()
  const now = await poll(async () => ((await checkedProvider(win, 'zh-CN')) || '').includes(providerLabel) || null, { timeout: 8000 })
  expectThat(Boolean(now), `${nodeId}：供应商切到 ${providerLabel}`)
  await shot(win, shotName)
  await win.keyboard.press('Escape')
}

function savedNodeMeta(nodeId) {
  const candidates = [path.join(projectRoot, '.nomi', 'project.json'), path.join(projectRoot, 'project.json')]
    .filter((file) => fs.existsSync(file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  for (const file of candidates) {
    const project = JSON.parse(fs.readFileSync(file, 'utf8'))
    const nodes = project?.payload?.generationCanvas?.nodes || project?.generationCanvas?.nodes || []
    const found = nodes.find((node) => node.id === nodeId)
    if (found) return { file: path.relative(tempRoot, file), meta: found.meta || {} }
  }
  return null
}

// ── ④ 老项目里的 Sora 2 节点 ─────────────────────────────────────────────────
async function soraScenario(win, lang, nodeId, prefix) {
  const t = T[lang]
  console.log(`\n[${lang}] 老项目里的 Sora 2 节点（${nodeId}）`)
  await selectNode(win, nodeId)
  await shot(win, `${prefix}-sora-node-opened.png`)
  const blank = await win.evaluate(() => (document.body.innerText || '').trim().length < 20)
  expectThat(!blank, 'Sora 节点所在画布正常渲染（没有白屏）')
  await composer(win).locator(`[aria-label="${t.generate}"]`).first().click()
  const card = await poll(async () => {
    const confirm = win.locator('.fixed.inset-0').last().getByRole('button', { name: t.confirm, exact: true })
    if (await confirm.count()) await confirm.first().click().catch(() => undefined)
    return win.evaluate(({ id, retired, switchModel }) => {
      // 失败卡的标题（原因）住在 role=alert 的 aria-label 里；卡里第一颗带 aria-label 的是右上角「收起」×，
      // 主按钮要按名字找，不能取第一颗。
      const alert = Array.from(document.querySelectorAll(`.react-flow__node[data-id="${id}"] [role="alert"]`))
        .find((element) => `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.includes(retired))
      if (!alert) return null
      const primary = Array.from(alert.querySelectorAll('button[aria-label]')).find((button) => button.getAttribute('aria-label') === switchModel)
      return { label: alert.getAttribute('aria-label') || '', text: (alert instanceof HTMLElement ? alert.innerText : '').trim(), primary: primary?.getAttribute('aria-label') || '' }
    }, { id: nodeId, retired: t.retired, switchModel: t.switchModel })
  }, { timeout: 40000, interval: 1000 })
  // 眼睛看得见的字（innerText）：节点上不许出现英文技术报错，也不许有「服务商原话」框（服务商根本没被请求到）。
  const nodeText = await win.locator(`.react-flow__node[data-id="${nodeId}"]`).first().innerText().catch(() => '')
  console.log(`    退役卡：${card ? `「${card.label}」／正文「${card.text.replace(/\s+/g, ' ').slice(0, 200)}」` : '没出现'}`)
  expectThat(!/Model is (retired|not enabled)/.test(nodeText), `节点上看得见的字没有技术签名「Model is retired」`)
  expectThat(!nodeText.includes(t.providerWords), `退役卡里没有「${t.providerWords}」框`)
  expectThat(Boolean(card), `点生成 → 「${t.retired}」`)
  expectThat(card?.primary === t.switchModel, `主按钮 = 「${t.switchModel}」（「${card?.primary}」）`)
  expectThat(Boolean(card?.text.includes(t.retiredHint)), `正文是对任何下线模型都成立的说法（含「${t.retiredHint}」）`)
  expectThat(!/一直失败|kept failing/i.test(card?.text || ''), '正文不再说「在服务商那边一直失败」')
  expectThat(!(card?.text || '').includes(t.retryAlt), `卡上没有「${t.retryAlt}」`)
  await shot(win, `${prefix}-sora-retired-card.png`)
  await shotElement(win.locator(`.react-flow__node[data-id="${nodeId}"] [role="alert"]`).first(), `${prefix}-sora-retired-card-closeup.png`)
  await win.locator(`.react-flow__node[data-id="${nodeId}"] [role="alert"]`).first().getByRole('button', { name: t.switchModel, exact: true }).click()
  const menu = await poll(async () => (await win.locator('[role="option"]:visible').count()) > 0, { timeout: 8000 })
  expectThat(Boolean(menu), `点「${t.switchModel}」→ 模型框打开`)
  await pickRow(win, 'Seedance 2.5')
  const switched = await poll(async () => ((await composer(win).locator(`[aria-label="${t.model}"]`).first().textContent()) || '').includes('Seedance 2.5'), { timeout: 8000 })
  expectThat(Boolean(switched), '换成 Seedance 2.5')
  const panel = await openParameterPanel(win)
  const groups = await panel.locator('[role="radiogroup"]').count()
  expectThat(groups > 0, `参数面板正常（${groups} 组可选参数）`)
  await shot(win, `${prefix}-sora-switched-parameters.png`)
  await win.keyboard.press('Escape')
}

// ── 跑 ──────────────────────────────────────────────────────────────────────
await writeCatalog()
writeProject()
console.log(`夹具：${tempRoot}`)

{
  const { app, win } = await launch()
  try {
    await setBounds(app, win)
    await openCanvas(win)
    await checkModelBoxes(win, 'zh-CN')
    await switchLocale(win, 'en')
    await checkModelBoxes(win, 'en')
    await switchLocale(win, 'zh-CN')

    console.log('\n[zh-CN] 切到 fal / Runway')
    await switchProvider(win, 'vid-merge', 'Seedance 2.5', 'fal.ai', 'zh-video-switched-to-fal.png')
    await switchProvider(win, 'img-merge', 'GPT Image 2', 'Runway Dev', 'zh-image-switched-to-runway.png')
    // 等落盘：保存有去抖，关窗前确认两处都写进了项目文件。
    const saved = await poll(() => savedNodeMeta('vid-merge')?.meta.modelVendor === 'fal' && savedNodeMeta('img-merge')?.meta.modelVendor === 'runway', { timeout: 20000, interval: 500 })
    expectThat(Boolean(saved), '切换已落盘（项目文件里的节点 vendor = fal / runway）')
  } catch (error) {
    fail(`第一次启动抛错：${String(error?.stack || error).slice(0, 3000)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

{
  const { app, win } = await launch()
  try {
    await setBounds(app, win)
    await openCanvas(win)
    console.log('\n[zh-CN] 重启后重开节点')
    for (const [nodeId, modelLabel, providerLabel, shotName] of [
      ['vid-merge', 'Seedance 2.5', 'fal.ai', 'zh-video-reopened.png'],
      ['img-merge', 'GPT Image 2', 'Runway Dev', 'zh-image-reopened.png'],
    ]) {
      await selectNode(win, nodeId)
      const label = ((await composer(win).locator(`[aria-label="${T['zh-CN'].model}"]`).first().textContent()) || '').trim()
      expectThat(label.includes(modelLabel), `${nodeId}：重开后模型仍是 ${modelLabel}（「${label}」）`)
      await openParameterPanel(win)
      const provider = await checkedProvider(win, 'zh-CN')
      expectThat(Boolean(provider?.includes(providerLabel)), `${nodeId}：重开后供应商仍是 ${providerLabel}（「${provider}」）`)
      await shot(win, shotName)
      await win.keyboard.press('Escape')
    }
    const video = savedNodeMeta('vid-merge')
    const image = savedNodeMeta('img-merge')
    console.log(`    落盘：vid-merge = ${video?.meta.modelVendor}/${video?.meta.modelKey}，img-merge = ${image?.meta.modelVendor}/${image?.meta.modelKey}（${video?.file}）`)
    expectThat(video?.meta.modelVendor === 'fal' && video?.meta.modelKey === 'bytedance/seedance-2.5', '落盘：视频节点 = fal / bytedance/seedance-2.5')
    expectThat(image?.meta.modelVendor === 'runway' && image?.meta.modelKey === 'gpt_image_2', '落盘：图片节点 = runway / gpt_image_2')

    await soraScenario(win, 'zh-CN', 'vid-sora', 'zh')
    await switchLocale(win, 'en')
    await soraScenario(win, 'en', 'vid-sora-en', 'en')
  } catch (error) {
    fail(`第二次启动抛错：${String(error?.stack || error).slice(0, 3000)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ── 零供应商调用 ─────────────────────────────────────────────────────────────
console.log('\n[网络闸]')
const entries = fs.existsSync(netLog) ? fs.readFileSync(netLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
const loaded = entries.filter((entry) => entry.kind === 'guard-loaded')
const blocked = entries.filter((entry) => entry.kind === 'blocked')
expectThat(loaded.length > 0, `网络闸已装进主进程（${loaded.length} 个进程）`)
const byHost = {}
for (const entry of blocked) {
  const host = (() => { try { return new URL(entry.url).host } catch { return entry.url } })()
  byHost[host] = (byHost[host] || 0) + 1
}
console.log(`    被拦下的出门尝试 ${blocked.length} 次：${Object.entries(byHost).map(([host, count]) => `${host}×${count}`).join('，') || '无'}`)
console.log('    放出去的供应商请求：0（闸只放行本机地址）')

console.log(`\n截图：\n${shots.map((file) => `  ${file}`).join('\n')}`)
console.log(failed ? '\n✗ 走查未通过' : '\n✓ 走查通过')
process.exit(failed ? 1 : 0)
