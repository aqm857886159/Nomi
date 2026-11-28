// 样片模式真窗口走查（设计卡 docs/plan/2026-11-26-sample-mode.md ★9 第 1–6 条；板 docs/design/boards/2026-11-26-sample-mode/）。
//
// 真实条件：隔离资料目录 + 打包同构 Electron + 本机回环假 APIMart（tests/ux/_mcpL2Fixture.mjs，照官方两步规则回：
// `draft: true` 只收 480p；`draft_task_id` 只收 model / draft_task_id / resolution，过期样片号 400）。
// 网络守卫开着（NOMI_TEST_NETWORK_GUARD=1），APIMart 改道到回环替身，零花费、不碰钥匙。
// 窗口 1100×690 + 停靠 Agent（★9-7 最窄窗）；跑两轨：中文浅色、英文深色（NOMI_SAMPLE_WALK_RUN=zh-light|en-dark 只跑一轨）。
//
// 各站（NOMI_SAMPLE_WALK_STATIONS=menu,sample,hd,second,plain,expiry 只跑点名的；后面的站依赖前面的样片）：
//   menu    ★9-1 菜单「Seedance 2.5」下一行就是样片行、说明原文、图标同一枚；生成框模型格写全名；清晰度只有 480p。
//   sample  ★9-2 / ★9-6 出样片（1 次 POST，draft:true + 480p）→ 节点下方一行「样片 · 剩 2 天」+「出高清」；
//           算不出价：钮上不印数、不印 0，读屏说明是「暂时估不出这次用量」。几何：行在节点框下、生成框上。字号按 token。
//   hd      ★9-3 点「出高清」不弹框，替身只收 1 次 POST，键集合恰为 {model, draft_task_id, resolution}；
//           在路上：样片照常可见、下方写「高清生成中」；落地进第 2 版「高清版」，角标 2，第 1 版还在；切回第 1 版那一行回来。
//   recovery  480p 与 1080p 各在受理后重启同一项目，取回原单，POST 增量各 1。
//   second  ★9-4 第二次出高清先弹确认：取消 / Esc 都不发；确认后从缓存取回第 2 版，POST 总数不变。
//   plain   ★9-5 普通 Seedance 2.5 选 480p 真出一条：没有这一行、没有「出高清」。
//   expiry  ★9-2 只拨渲染进程的钟（Playwright clock）：剩 2 小时多 → 不提醒；剩 1 小时多 / 48 分钟 → 提醒色；过 72 小时 →
//           「已过期」、没有「出高清」、只有「重拍样片」，点了按样片再发 1 次（draft:true）。
//
// 用法：pnpm run build && node tests/ux/sample-mode.walk.mjs
//   证据目录：NOMI_SAMPLE_WALK_OUT（缺省系统临时目录下 nomi-sample-walk-*）；summary.json 记每站红绿与原因。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { exitIfWalkSkipped, launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { addCanvasNode, canvasSetZoomPercent, canvasZoomPercent, canvasZoomStep, createBlankProject, selectOrAddCanvasNode, ensureAgentPanelOpen, nodeModelTrigger, openNodeModelMenu, openNodeParams, selectedNodeComposer, switchWorkspace } from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { encryptFixtureKey, startFakeApimartServer } from './_mcpL2Fixture.mjs'
import { buildWorld } from './_world.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HOUR = 3_600_000
const MINUTE = 60_000
const TTL_HOURS = 72
const SIZE = { width: 1100, height: 690 }
const LONG = stationTimeout({ operations: 6 })

// 字号只从 token 的唯一一份读（src/theme/nomiTheme.ts），不在走查里抄 px。
const THEME = fs.readFileSync(path.join(repoRoot, 'src/theme/nomiTheme.ts'), 'utf8')
const FONT = Object.fromEntries([...THEME.slice(THEME.indexOf('fontSize: {')).matchAll(/^\s+(\w+): '(\d+px)'/gm)].slice(0, 7).map((m) => [m[1], m[2]]))
assert(FONT.caption && FONT.micro, `read font tokens from nomiTheme.ts: ${JSON.stringify(FONT)}`)

const ALL_RUNS = { 'zh-light': { locale: 'zh-CN', scheme: 'light' }, 'en-dark': { locale: 'en', scheme: 'dark' } }
const RUNS = process.env.NOMI_SAMPLE_WALK_RUN ? [ALL_RUNS[process.env.NOMI_SAMPLE_WALK_RUN]] : Object.values(ALL_RUNS)
assert(RUNS.every(Boolean), `NOMI_SAMPLE_WALK_RUN 只认 ${Object.keys(ALL_RUNS).join(' / ')}`)
const STATIONS = ['menu', 'sample', 'hd', 'second', 'plain', 'narrow', 'expiry', 'recovery']
/** ★9-7 最长文字：28 字镜头名（设计卡边界表原文）；英文轨用同样长度级别的英文名。最窄节点宽 = nodeSizing.ts 的 MIN_NODE_WIDTH。 */
const LONG_SHOT_NAME = { 'zh-CN': '雨后清晨的海边栈道上少女缓缓转身回望远处灯塔慢推近景特写', en: 'Rainy dawn on the seaside boardwalk, the girl slowly turns back toward the distant lighthouse' }
const MIN_NODE_WIDTH = 240
const ONLY = new Set((process.env.NOMI_SAMPLE_WALK_STATIONS || STATIONS.join(',')).split(',').map((s) => s.trim()).filter(Boolean))
const OUT = process.env.NOMI_SAMPLE_WALK_OUT ? path.resolve(process.env.NOMI_SAMPLE_WALK_OUT) : makeTempDir('nomi-sample-walk-', { retain: true })
fs.mkdirSync(OUT, { recursive: true })

const SAMPLE_LABEL = { 'zh-CN': 'Seedance 2.5（样片模式）', en: 'Seedance 2.5 (Draft mode)' }
const PARENT_LABEL = 'Seedance 2.5'
const VIDEO_CREATE = '/v1/videos/generations'
const SAMPLE_FINAL_KEYS = ['draft_task_id', 'model', 'resolution']

const summary = []
let failed = false

function buildSampleWorld() {
  // 世界由主人造（tests/world 的 buildWorld：出厂内置目录 + 一把在 Electron 外加密好的假 key）；走查不手写目录。
  const rootDir = makeTempDir('nomi-sample-walk-root-')
  const userDataDir = path.join(rootDir, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })
  const now = new Date().toISOString()
  const record = { vendorKey: 'apimart', apiKey: encryptFixtureKey(userDataDir), enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now }
  const world = buildWorld({ rootDir, projects: [], encryptedApiKeys: { apimart: record } })
  return world
}

async function launch(world, run, fake) {
  return launchNomiApp({
    name: `sample-mode-${run.locale}-${run.scheme}`,
    world,
    capabilityDir: path.join(world.rootDir, 'capability'),
    viewportSize: SIZE,
    syntheticCredentialStorage: true,
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
    initialLocalStorage: {
      'nomi:locale:v1': run.locale,
      'nomi-color-scheme': run.scheme,
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      // 约价单位从积分起（发送键那份偏好；上一轮切过的不带进来）。
      'nomi.sendCostUnit': 'credits',
    },
    env: {
      NO_PROXY: '127.0.0.1,localhost',
      NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_TEST_NETWORK_FIXTURE_ORIGINS: '',
      NOMI_WALK_NET_LOG: path.join(OUT, `network.${run.locale}.${run.scheme}.jsonl`), NOMI_DISABLE_AUTO_UPDATE: '1',
      NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: fake.origin }]),
      NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fake.origin,
    },
  }).catch(exitIfWalkSkipped)
}

/** 一个节点（React Flow 外壳按 data-id 找，节点里的样片行、版本角标都在它里面）。 */
const nodeById = (win, id) => win.locator(`.react-flow__node[data-id="${id}"]`).first()

async function readNodeId(locator) {
  return locator.evaluate((el) => el.closest('.react-flow__node')?.getAttribute('data-id') ?? '')
}

/** 文字元素的计算字号必须等于 token（不写死 px）。 */
async function expectFont(locator, token, label) {
  const size = await locator.evaluate((el) => getComputedStyle(el).fontSize)
  assert.equal(size, FONT[token], `${label}：计算字号 ${size} ≠ token ${token}（${FONT[token]}）`)
}

/** 元素没被截断（整行字都放得下）。 */
async function expectNotTruncated(locator, label) {
  const box = await locator.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, text: el.textContent }))
  assert(box.scroll <= box.client + 0.5, `${label}：「${box.text}」被截断（scrollWidth ${box.scroll} > clientWidth ${box.client}）`)
}

async function pickModel(win, locale, label, nodeId = '') {
  const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
  const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${label.replace(/[()（）.]/g, '\\$&')}$`) }) }).first()
  const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
  await openNodeModelMenu(win, `open model menu for ${label}`)
  if (!(await row.isVisible().catch(() => false)) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
  const rowBox = await row.boundingBox()
  if (rowBox && rowBox.y < 8) {
    // 690 高窗口里展开全表后的上翻菜单顶缘若越过窗口上沿几像素，把画布往下微移对应像素即可完整露出首行且不丢节点选中。
    const dy = Math.min(80, Math.ceil(24 - rowBox.y))
    await win.keyboard.press('Escape')
    await expect(menu, `close clipped menu for ${label}`).toBeHidden()
    const blank = await findCanvasBlankPoint(win)
    assert(blank, `pick ${label}：画布上找不到空白处`)
    const sy = Math.min(blank.y, 480)
    await win.mouse.move(blank.x, sy)
    await win.mouse.down()
    for (let i = 1; i <= 6; i += 1) await win.mouse.move(blank.x, sy + (dy * i) / 6)
    await win.mouse.up()
    if (nodeId && !(await selectedNodeComposer(win).isVisible().catch(() => false))) {
      await nodeById(win, nodeId).locator('.generation-canvas-v2-node').first().click({ position: { x: 8, y: 8 } })
    }
    await openNodeModelMenu(win, `reopen model menu for ${label}`)
    if (!(await row.isVisible().catch(() => false)) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
  }
  await clickOrFail(row, `pick ${label}`)
  await expect(menu, `pick ${label}: menu closes`).toBeHidden()
}

async function fillPrompt(win, text) {
  await selectedNodeComposer(win).locator('[data-prompt-box] .ProseMirror').first().fill(text)
}

async function send(win, locale) {
  const button = selectedNodeComposer(win).getByRole('button', { name: uiText(locale, 'generationCommon.composer.generateAsset'), exact: true }).first()
  await clickOrFail(button, 'send from composer')
}

/** 等替身真建成第 n 个视频任务，回它的请求体。 */
async function nthVideoCreate(fake, n, label) {
  await expect.poll(() => fake.created.filter((c) => c.url === VIDEO_CREATE).length, { message: `${label}：替身没收到第 ${n} 个视频任务`, timeout: LONG }).toBeGreaterThanOrEqual(n)
  return fake.created.filter((c) => c.url === VIDEO_CREATE)[n - 1]
}
/** 等第 n 个视频 POST 到（替身拒掉的也算：请求体错了要在断言上红，不是等超时），回它的请求体。 */
async function nthVideoPost(fake, n, label) {
  await expect.poll(() => videoPosts(fake), { message: `${label}：替身没收到第 ${n} 个视频 POST`, timeout: LONG }).toBeGreaterThanOrEqual(n)
  const hit = fake.hits.filter((h) => h.method === 'POST' && h.url === VIDEO_CREATE)[n - 1]
  return JSON.parse(hit.body || '{}')
}
const videoCreates = (fake) => fake.created.filter((c) => c.url === VIDEO_CREATE).length
const videoPosts = (fake) => fake.hits.filter((h) => h.method === 'POST' && h.url === VIDEO_CREATE).length

/** 中心点上最顶层的是不是它自己（被浮条、生成框、窗口边挡住时不是）。 */
async function reachable(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && el.contains(hit)
  }).catch(() => false)
}

/**
 * 目标在画布可见区外：真人会按住空白处把画布拖过来。找一处空白（elementFromPoint 落在 React Flow 底板上），
 * 只拖到目标整块露出来为止，起止点都留在画布里，不够就下一轮再拖。
 * keep：目标所属的节点。画布只画和视口有交集的节点（onlyRenderVisibleElements），铺开的版本卡长在节点里——
 * 把节点整个拖出视口，卡会跟着不画。所以拖完节点必须还露一截（≥ 40px）；做不到就回 'blocked'，由调用方先缩小一档。
 * whole：要整块露出来（生成框这种宽的东西，中心在里面但左半截在画布外也要拖）。
 * center：拖到画布正中（要放大看时先这样，缩放围着画布中心转，目标就不会被放大出视口）；离正中 24px 以内算到了。
 * 回 'inside'（目标中心已在可见区里——whole 时是整块都在、center 时是在正中——不用拖）/ 'dragged' / 'blocked'。
 */
async function dragIntoView(win, locator, keep, { whole = false, center = false } = {}) {
  const keepBox = keep ? await keep.boundingBox() : null
  const plan = await locator.evaluate((el, { keepRect, whole, center }) => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return null
    const p = pane.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    if (!whole && !center && cx > p.left + 8 && cx < p.right - 8 && cy > p.top + 8 && cy < p.bottom - 8) return { kind: 'inside' }
    const margin = 24
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    // 最小位移：左边露出 → 右移到左缘 + 边距；右边同理；上下同理（目标比画布还大就只把中心拖进来）。
    const shift = (lo, hi, pLo, pHi) => {
      if (center) return (pLo + pHi) / 2 - (lo + hi) / 2
      if (hi - lo > pHi - pLo - 2 * margin) return (pLo + pHi) / 2 - (lo + hi) / 2
      if (lo < pLo + margin) return pLo + margin - lo
      if (hi > pHi - margin) return pHi - margin - hi
      return 0
    }
    const dx = shift(r.left, r.right, p.left, p.right)
    const dy = shift(r.top, r.bottom, p.top, p.bottom)
    const near = center ? margin : 1
    if (Math.abs(dx) < near && Math.abs(dy) < near) return { kind: 'inside' }
    if (keepRect) {
      const visible = 40
      const left = keepRect.x + dx
      const top = keepRect.y + dy
      if (left > p.right - visible || left + keepRect.width < p.left + visible || top > p.bottom - visible || top + keepRect.height < p.top + visible) return { kind: 'blocked' }
    }
    // 起手点挑一处「拖完终点还在画布里」的空白（往左拖就从右边起手），一把拖到；实在没有才退到第一处空白、拖一截下一轮再拖
    // （实测从左缘起手往左拖，每次只挪得动 44px）。
    let fallback = null
    for (let fy = 0.15; fy <= 0.85; fy += 0.1) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
        const sx = p.left + p.width * fx
        const sy = p.top + p.height * fy
        if (document.elementFromPoint(sx, sy) !== pane) continue
        const ex = clamp(sx + dx, p.left + margin, p.right - margin)
        const ey = clamp(sy + dy, p.top + margin, p.bottom - margin)
        if (ex === sx + dx && ey === sy + dy) return { kind: 'drag', sx, sy, ex, ey }
        fallback ??= { kind: 'drag', sx, sy, ex, ey }
      }
    }
    return fallback ?? { kind: 'no-empty' }
  }, { keepRect: keepBox, whole, center })
  if (!plan || plan.kind === 'inside' || plan.kind === 'blocked') return plan?.kind ?? 'inside'
  if (plan.kind === 'no-empty') throw new Error('画布上找不到空白处来拖')
  await win.mouse.move(plan.sx, plan.sy)
  await win.mouse.down()
  for (let i = 1; i <= 8; i += 1) await win.mouse.move(plan.sx + ((plan.ex - plan.sx) * i) / 8, plan.sy + ((plan.ey - plan.sy) * i) / 8)
  await win.mouse.up()
  await win.waitForTimeout(150)
  return 'dragged'
}

/**
 * 画布上的东西够不着时照真人做：在可见区外 → 拖画布把它拖过来；在可见区里但被浮条挡住、或拖过来会把所属节点拖出视口 →
 * 缩小一档再看。最多 6 次（不绕过遮挡去点）。
 */
async function onCanvas(win, locator, label, { hover = false, keep = null } = {}) {
  await expect(locator, `${label}：不在画布上`).toBeAttached()
  for (let step = 0; !(await reachable(locator)); step += 1) {
    if (step >= 6) throw new Error(`${label}：拖 / 缩小 6 次后仍被挡住 / 在窗口外`)
    if ((await dragIntoView(win, locator, keep)) !== 'dragged') await canvasZoomStep(win, 'out', `${label}（被挡住，缩小画布）`)
  }
  if (hover) await locator.hover()
  else await clickOrFail(locator, label)
}

/**
 * 新节点的落点由画布避让决定，生成框可能有一截在画布左缘外（实测：已有样片节点在正中时，新视频节点落在它左边，
 * 模型芯片在窗口外 50px，位置不再变）。Playwright 去点窗口外的芯片会先滚动画布外壳、位置跳来跳去，报「not stable」。
 * 真人会把画布往右拖一点，让整个生成框露出来——这里照做；拖完生成框没了（选中丢了）就点回这张卡。
 */
async function composerIntoView(win, nodeId) {
  const node = nodeById(win, nodeId)
  const keep = node.locator('.generation-canvas-v2-node__preview').first()
  for (let step = 0; ; step += 1) {
    if (!(await selectedNodeComposer(win).isVisible().catch(() => false))) await node.locator('.generation-canvas-v2-node').first().click({ position: { x: 8, y: 8 } })
    await expectVisible(selectedNodeComposer(win), 'plain node composer')
    const placed = await dragIntoView(win, selectedNodeComposer(win), keep, { whole: true })
    if (placed === 'inside' && await reachable(nodeModelTrigger(win))) return
    if (step >= 6) throw new Error('新节点的生成框：拖 / 缩小 6 次后仍有一截在画布外、或模型芯片被挡住')
    if (placed !== 'dragged') await canvasZoomStep(win, 'out', '新节点的生成框（被挡住，缩小画布）')
  }
}

async function setVersionsSpread(win, nodeId, spread) {
  const badge = nodeById(win, nodeId).locator('button[data-version-badge]').first()
  if ((await badge.getAttribute('aria-pressed')) !== String(spread)) await onCanvas(win, badge, spread ? 'spread versions' : 'fold versions')
  await expect(badge).toHaveAttribute('aria-pressed', String(spread))
}

async function setPrimary(win, nodeId, versionNo) {
  await setVersionsSpread(win, nodeId, true)
  const card = win.locator(`[data-version-grid="${nodeId}"] [data-version-card="${versionNo}"]`).first()
  if ((await card.getAttribute('data-primary')) !== 'true') {
    const keep = nodeById(win, nodeId).locator('.generation-canvas-v2-node__preview').first()
    await onCanvas(win, card, `hover v${versionNo}`, { hover: true, keep })
    await onCanvas(win, card.locator('[data-toolbar-action="set-primary"]').first(), `set v${versionNo} primary`, { keep })
  }
  await expect(card, `v${versionNo} is primary`).toHaveAttribute('data-primary', 'true')
  await setVersionsSpread(win, nodeId, false)
}

async function station(name, run, fn) {
  if (!ONLY.has(name)) return
  const started = Date.now()
  try {
    await fn()
    summary.push({ run: `${run.locale}-${run.scheme}`, station: name, ok: true, ms: Date.now() - started })
    console.log(`✓ ${run.locale}/${run.scheme} ${name}`)
  } catch (error) {
    failed = true
    summary.push({ run: `${run.locale}-${run.scheme}`, station: name, ok: false, ms: Date.now() - started, error: String(error?.message || error).split('\n').slice(0, 6).join('\n') })
    console.log(`✗ ${run.locale}/${run.scheme} ${name}\n${String(error?.message || error).split('\n').slice(0, 8).join('\n')}`)
    throw Object.assign(new Error(`station ${name} red`), { stationRed: true })
  }
}

for (const run of RUNS) {
  const { locale, scheme } = run
  const shot = (name) => path.join(OUT, `${name}.${locale}.${scheme}.png`)
  const fake = await startFakeApimartServer({ pendingPolls: 3 })
  const world = buildSampleWorld()
  let { app, win } = await launch(world, run, fake)
  const ctx = { sampleNodeId: '', sampleTaskId: '', sendAt: 0 }
  try {
    await createBlankProject(win)
    await switchWorkspace(win, 'generation')
    await ensureAgentPanelOpen(win, 'dock the Agent (★9-7 narrowest window)', { form: 'dock' })
    await selectOrAddCanvasNode(win, 'video', 'add the sample node')
    ctx.sampleNodeId = await readNodeId(selectedNodeComposer(win))
    assert(ctx.sampleNodeId, 'sample node id')

    await station('menu', run, async () => {
      await openNodeModelMenu(win, 'open model menu')
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
      const sampleLabel = SAMPLE_LABEL[locale]
      if (!(await menu.locator('[data-nomi-select-option-label]', { hasText: sampleLabel }).count()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
      const rows = await menu.getByRole('option').evaluateAll((options) => options.map((option) => ({
        label: option.querySelector('[data-nomi-select-option-label]')?.textContent?.trim() ?? '',
        description: option.querySelector('[data-nomi-select-option-description]')?.textContent?.trim() ?? '',
        icon: option.querySelector('svg, img')?.outerHTML ?? '',
      })))
      const parent = rows.findIndex((row) => row.label === PARENT_LABEL)
      assert(parent >= 0, `board:SampleMode/sample.picker-row：菜单里没有「${PARENT_LABEL}」`)
      assert.equal(rows[parent + 1]?.label, sampleLabel, `board:SampleMode/sample.picker-row：「${PARENT_LABEL}」下一行不是「${sampleLabel}」（是「${rows[parent + 1]?.label}」）`)
      const expectedLine = [
        uiTextWith(locale, 'generationCommon.parameters.modelLine.sampleDraft', { value: '480p' }),
        uiTextWith(locale, 'generationCommon.parameters.modelLine.sampleFinal', { value: '1080p' }),
        uiTextWith(locale, 'generationCommon.parameters.modelLine.maxSeconds', { count: 30 }),
      ].join(' · ')
      if (locale === 'zh-CN') assert.equal(expectedLine, '480p 低成本试片 · 满意后出 1080p · 最长 30 秒', '说明原文（任务书 ★9-1）')
      assert.equal(rows[parent + 1].description, expectedLine, 'board:SampleMode/sample.picker-row：说明行')
      assert(rows[parent].icon && rows[parent].icon === rows[parent + 1].icon, 'board:SampleMode/sample.picker-row：图标和 Seedance 2.5 同一枚')
      const sampleRow = menu.getByRole('option').nth(parent + 1)
      await expectFont(sampleRow.locator('[data-nomi-select-option-label]'), 'caption', 'board:SampleMode/sample.picker-row 名')
      await expectFont(sampleRow.locator('[data-nomi-select-option-description]'), 'micro', 'board:SampleMode/sample.picker-row 说明')
      await sampleRow.hover()
      await screenshotSettled(win, { path: shot('01-menu') })
      await clickOrFail(sampleRow, 'pick sample mode')
      await expect(menu).toBeHidden()
      const trigger = nodeModelTrigger(win)
      await expect(trigger, 'board:SampleMode/sample.picker-chip').toContainText(sampleLabel)
      const chipText = trigger.getByText(sampleLabel, { exact: true }).first()
      await expectNotTruncated(chipText, 'board:SampleMode/sample.picker-chip')
      await openNodeParams(win, 'open params')
      const resolution = win.locator('[data-agent-parameter-control="resolution"]').first()
      await expectVisible(resolution, 'board:SampleMode/sample.params-panel：清晰度一组照样显示')
      const choices = resolution.locator('[role="radio"], button[aria-pressed]')
      await expect(choices, 'board:SampleMode/sample.params-panel：清晰度恰 1 个取值').toHaveCount(1)
      await expect(choices.first()).toHaveText('480p')
      const on = await choices.first().evaluate((el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('data-checked') !== null)
      assert(on, 'board:SampleMode/sample.params-panel：480p 亮着')
      await screenshotSettled(win, { path: shot('02-params') })
      await win.keyboard.press('Escape')
    })

    await station('sample', run, async () => {
      const node = nodeById(win, ctx.sampleNodeId)
      await fillPrompt(win, locale === 'en' ? 'Wide shot, rooftop after rain, she turns to the window' : '远景，雨后天台，人物转身看向窗外')
      // 发送键按它在生成框里的位置认（data-bar-segment=generate 只有这一颗；有了结果以后读屏名会变，位置不变）。
      const sendKey = selectedNodeComposer(win).locator('button[data-bar-segment="generate"]').first()
      await expectAbsent(selectedNodeComposer(win).locator('[data-send-cost]'), {
        provenBy: await proveProbe(sendKey, '生成框里的发送键在（约价记号挂在它这一处）'),
        message: 'board:SampleMode/sample.send-price：算不出价不印数',
      })
      const before = videoCreates(fake)
      ctx.sendAt = await win.evaluate(() => Date.now())
      await send(win, locale)
      const created = await nthVideoCreate(fake, before + 1, 'sample POST')
      assert.equal(created.body?.draft, true, '样片请求带 draft: true')
      assert.equal(created.body?.resolution, '480p', '样片请求 480p')
      assert.equal(created.body?.draft_task_id, undefined, '样片请求不带 draft_task_id')
      ctx.sampleTaskId = created.taskId
      // 样片在路上：今天的等待面原样，下方这一行出了结果才出现。
      await expect(node.locator('[data-generating-placement]').first(), 'board:SampleMode/sample.generating：样片生成中用今天的等待面').toBeVisible()
      // 这份基线 hd 站还要用：出高清在路上时同一个遮罩探针要证「不在」。
      ctx.generatingSeen = await proveProbe(node.locator('[data-generating-placement]'), '这张节点上样片的等待面在')
      await expectAbsent(node.locator('[data-sample-row]'), {
        provenBy: ctx.generatingSeen,
        message: 'board:SampleMode/sample.generating：结果没出来前没有下方这一行',
      }, 1000)
      await win.screenshot({ path: shot('03a-sample-generating') })
      const row = node.locator('[data-sample-row]').first()
      await expect(row, 'board:SampleMode/sample.below-row：样片出完节点下方出这一行').toHaveAttribute('data-sample-state', 'ready', { timeout: LONG })
      const chip = row.locator('[data-sample-expiry]').first()
      await expect(chip, 'board:SampleMode/sample.expiry-chip').toHaveText(uiTextWith(locale, 'generationCommon.sample.expiry.days', { count: 2 }))
      await expect(chip).toHaveAttribute('data-sample-expiry', 'days')
      await expect(chip).not.toHaveAttribute('data-sample-expiry-warning', 'true')
      const hd = row.locator('[data-sample-make-final]').first()
      await expect(hd, 'board:SampleMode/sample.hd-button').toHaveText(uiText(locale, 'generationCommon.sample.makeFinal'))
      await expect(hd).toHaveAttribute('aria-label', uiTextWith(locale, 'generationCommon.sample.makeFinalAria', { resolution: '1080p' }))
      // ★9-6：算不出价——不印数、不印 0；读屏那句证明约价真跑过（不是没算）。
      await expectAbsent(hd.locator('[data-sample-cost]'), { provenBy: await proveProbe(hd, '「出高清」钮在'), message: 'board:SampleMode/sample.hd-no-price：不印数' })
      assert(!/\d/.test(await hd.innerText()), 'board:SampleMode/sample.hd-no-price：钮上没有数字（也没有 0）')
      await expect(hd, 'board:SampleMode/sample.hd-no-price：悬停 / 读屏说估不出').toHaveAttribute('aria-description', uiText(locale, 'generationCommon.composer.sendCost.priceUnknown'))
      await expectAbsent(selectedNodeComposer(win).locator('[data-send-cost]'), {
        provenBy: await proveProbe(sendKey, '出完样片后生成框里的发送键在'),
        message: 'board:SampleMode/sample.send-price：出完样片后发送键也不印数',
      })
      await expect(sendKey, 'board:SampleMode/sample.send-price：发送键读屏也说估不出（约价真跑过）').toHaveAttribute('aria-description', uiText(locale, 'generationCommon.composer.sendCost.priceUnknown'))
      await expectFont(chip, 'caption', 'board:SampleMode/sample.expiry-chip')
      await expectFont(hd, 'caption', 'board:SampleMode/sample.hd-button')
      await expectNotTruncated(chip, 'board:SampleMode/sample.expiry-chip')
      await expectNotTruncated(hd, 'board:SampleMode/sample.hd-button')
      // 几何：行在节点框下面、生成框上面，行高 28（min-h-7）。
      const geo = await node.evaluate((el) => {
        const frame = el.querySelector('.generation-canvas-v2-node__preview')?.getBoundingClientRect()
        const rowEl = el.querySelector('[data-sample-row]')
        const line = rowEl?.firstElementChild?.getBoundingClientRect()
        const composer = document.querySelector('.generation-canvas-v2-node__composer')?.getBoundingClientRect()
        const zoom = Number((document.querySelector('.react-flow__viewport')?.style.transform.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? 1)
        return { frameBottom: frame?.bottom, rowTop: rowEl?.getBoundingClientRect().top, rowBottom: rowEl?.getBoundingClientRect().bottom, lineHeight: line?.height, composerTop: composer?.top, zoom }
      })
      assert(geo.rowTop >= geo.frameBottom - 0.5, `board:SampleMode/sample.below-row：行顶 ${geo.rowTop} 在节点框底 ${geo.frameBottom} 之上`)
      if (geo.composerTop !== undefined) assert(geo.rowBottom <= geo.composerTop + 0.5, `board:SampleMode/sample.below-row：行底 ${geo.rowBottom} 压进生成框顶 ${geo.composerTop}`)
      assert(Math.abs(geo.lineHeight - 28 * geo.zoom) <= 1, `board:SampleMode/sample.below-row：行高 ${geo.lineHeight}（缩放 ${geo.zoom}）不是 28`)
      await onCanvas(win, chip, 'hover expiry chip', { hover: true })
      await expect(win.locator('[data-sample-expiry-hover] [role="tooltip"]').first(), 'board:SampleMode/sample.expiry-tooltip（读屏那一份；可见那份同字）').toHaveText(uiTextWith(locale, 'generationCommon.sample.tooltip.days', { count: 2 }))
      const tipShown = await proveProbe(win.locator('[data-sample-expiry-hover]'), '悬停时有效期提示在')
      await screenshotSettled(win, { path: shot('03-sample-ready') })
      // 指针真的移开（多步移动，像真鼠标）：一步跳走会停在 Radix 的「移向提示框」缓冲区里，提示一直开着、盖进后面的截图。
      const box = await chip.boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + box.height + 40, { steps: 6 })
      await win.mouse.move(box.x - 60, box.y + box.height + 60, { steps: 6 })
      await expectAbsent(win.locator('[data-sample-expiry-hover]'), { provenBy: tipShown, message: '指针移开，提示收起' })
    })

    await station('hd', run, async () => {
      const node = nodeById(win, ctx.sampleNodeId)
      const row = node.locator('[data-sample-row]').first()
      const before = videoCreates(fake)
      const postsBefore = videoPosts(fake)
      await onCanvas(win, row.locator('[data-sample-make-final]').first(), 'make HD')
      // 请求体先断（落地前）：改成重发提示词时这里就是断言红，不是等超时。
      // 「第一次出高清不问」也由这次 POST 证：先弹确认的话没人点，POST 发不出去，这里就红。
      const sent = await nthVideoPost(fake, postsBefore + 1, 'HD POST')
      assert.deepEqual(Object.keys(sent).sort(), SAMPLE_FINAL_KEYS, `出高清请求体键集合：${JSON.stringify(sent)}`)
      assert.equal(sent.draft_task_id, ctx.sampleTaskId, '出高清带的是这条样片的任务号')
      assert.equal(sent.resolution, '1080p', '出高清目标清晰度 1080p')
      await nthVideoCreate(fake, before + 1, 'HD task created')
      // 在路上：样片照常可见、可播，下方写「高清生成中」。
      await expect(row, 'board:SampleMode/sample.hd-progress').toHaveAttribute('data-sample-state', 'final-active')
      const rowShown = await proveProbe(node.locator('[data-sample-row]'), '出高清在路上时样片那一行在')
      await expect(row.locator('[data-sample-final-progress]'), 'board:SampleMode/sample.hd-progress').toHaveText(uiText(locale, 'generationCommon.sample.finalInFlight'))
      await expectFont(row.locator('[data-sample-final-progress]'), 'caption', 'board:SampleMode/sample.hd-progress')
      // 遮罩按这次运行的事实让路（出高清 = 带 draftTaskId 的那一次）：节点上不挂生成遮罩，卡片里也不叠第二份状态。
      await expect(node.locator('video').first(), 'board:SampleMode/sample.hd-progress：出高清中样片 <video> 还在').toBeVisible()
      await expectAbsent(node.locator('[data-generating-placement]'), {
        provenBy: ctx.generatingSeen,
        message: 'board:SampleMode/sample.hd-progress：出高清中样片被生成遮罩盖住',
      }, 1000)
      await expectAbsent(node.locator('[data-node-inline-status] [data-generation-status]'), {
        provenBy: await proveProbe(node.locator('video'), '出高清中样片的 <video> 在'),
        message: 'board:SampleMode/sample.hd-progress：状态只在下方那一行写',
      }, 1000)
      await screenshotSettled(win, { path: shot('04-hd-in-flight') })
      const badge = node.locator('[data-version-badge]').first()
      await expect(badge, 'board:SampleMode/sample.version-hd：版本角标 2').toHaveText('2', { timeout: LONG })
      await expectAbsent(node.locator('[data-sample-row]'), { provenBy: rowShown, message: '高清版当主图：下方没有样片行' })
      assert.equal(videoCreates(fake), before + 1, '出高清只建 1 个任务')
      assert.equal(videoPosts(fake), postsBefore + 1, '出高清只 POST 1 次')
      await setVersionsSpread(win, ctx.sampleNodeId, true)
      const grid = win.locator(`[data-version-grid="${ctx.sampleNodeId}"]`).first()
      await expect(grid.locator('[data-version-card="2"] [data-version-card-number]'), 'board:SampleMode/sample.version-hd：第 2 版叫高清版').toHaveText(uiText(locale, 'generationCommon.sample.finalLabel'))
      await expect(grid.locator('[data-version-card="2"]')).toHaveAttribute('data-primary', 'true')
      await expect(grid.locator('[data-version-card="1"]'), '第 1 版样片还在').toHaveCount(1)
      await expectFont(grid.locator('[data-version-card="2"] [data-version-card-number]'), 'micro', 'board:SampleMode/sample.version-hd')
      await screenshotSettled(win, { path: shot('05-versions') })
      await setPrimary(win, ctx.sampleNodeId, 1)
      await expect(node.locator('[data-sample-row]').first(), '切回第 1 版，那一行回来').toHaveAttribute('data-sample-state', 'ready')
    })

    await station('second', run, async () => {
      const node = nodeById(win, ctx.sampleNodeId)
      const hd = node.locator('[data-sample-make-final]').first()
      const dialog = win.locator('[role="dialog"]').filter({ hasText: uiTextWith(locale, 'generationCommon.sample.secondFinal.title', { resolution: '1080p' }) }).first()
      const rowSeen = await proveProbe(node.locator('[data-sample-row]'), '重出前第 1 版样片行在')
      const postsBefore = videoPosts(fake)
      await onCanvas(win, hd, 'make HD again')
      await expect(dialog, 'board:SampleMode/sample.confirm-second-hd：第二次先弹确认').toBeVisible()
      // 量具（只记不判）：标题那一句在真框里放不放得下。拍板图 E4 注「格子比真框 380 窄才折行」= 真框里应一行放下；
      // 今天标题类是 truncate，放不下就省略。数字进日志；修法用户 11-26 已定：弹窗外壳一处「放不下就折行」，另开 PR #1696。
      const titleFit = await dialog.evaluate((el) => {
        const title = document.getElementById(el.getAttribute('aria-labelledby') || '')
        return title ? { scrollWidth: title.scrollWidth, clientWidth: title.clientWidth, dialogWidth: Math.round(el.getBoundingClientRect().width), text: title.textContent } : null
      })
      console.log(`  [量] 二次出高清标题：${JSON.stringify(titleFit)} → ${titleFit && titleFit.scrollWidth > titleFit.clientWidth + 0.5 ? '被截断' : '放得下'}`)
      const body = await dialog.innerText()
      assert(body.includes(uiTextWith(locale, 'generationCommon.sample.secondFinal.message', { resolution: '1080p' })), `board:SampleMode/sample.confirm-second-hd：正文\n${body}`)
      const bodyOnly = body.replace(/1080p/g, '').replace(uiText(locale, 'generationCommon.spend.cancel'), '')
      const confirm = dialog.locator('[data-spend-confirm-action="confirm"]').first()
      const confirmText = await confirm.innerText()
      assert(!/\d/.test(bodyOnly.replace(confirmText, '')), `board:SampleMode/sample.confirm-second-hd：正文不印价格数字\n${body}`)
      assert(!/积分|credit/i.test(bodyOnly.replace(confirmText, '')), 'board:SampleMode/sample.confirm-second-hd：正文不写积分')
      assert(confirmText.startsWith(uiText(locale, 'generationCommon.sample.secondFinal.confirm')), `主钮「${confirmText}」`)
      const order = await dialog.locator('[data-spend-confirm-action]').evaluateAll((els) => els.map((el) => el.getAttribute('data-spend-confirm-action')))
      assert.deepEqual(order, ['cancel', 'confirm'], 'board:SampleMode/sample.confirm-second-hd：按钮依次「取消」「再出高清」')
      await screenshotSettled(win, { path: shot('06-confirm') })
      const cardSeen = await proveProbe(dialog, '已出高清的样片弹出二次确认')
      await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]').first(), 'cancel second HD')
      await expectAbsent(dialog, { provenBy: cardSeen, message: '取消关闭重出确认' })
      assert.equal(videoPosts(fake), postsBefore, '取消不发请求')
      await expect(node.locator('[data-version-badge]')).toHaveText('2')
      await expect.poll(() => win.evaluate(() => document.activeElement?.hasAttribute('data-sample-make-final') ?? false), { message: '取消后焦点回到「出高清」' }).toBe(true)
      await onCanvas(win, hd, 'make HD again (Esc)')
      await expect(dialog).toBeVisible()
      await win.keyboard.press('Escape')
      await expectAbsent(dialog, { provenBy: cardSeen, message: 'Esc 关闭重出确认' })
      assert.equal(videoPosts(fake), postsBefore, '取消 / Esc 不发请求')
      await expect(node.locator('[data-version-badge]').first(), '取消后版本数不变').toHaveText('2')
      await onCanvas(win, hd, 'make HD again (confirm)')
      await expect(dialog).toBeVisible()
      await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]').first(), 'confirm second HD')
      await expectAbsent(node.locator('[data-sample-row]'), { provenBy: rowSeen, message: '确认后高清重新成为主图，样片行收起' }, LONG)
      await expect(node.locator('[data-version-badge]')).toHaveText('2')
      await setVersionsSpread(win, ctx.sampleNodeId, true)
      const hdCard = win.locator(`[data-version-grid="${ctx.sampleNodeId}"] [data-version-card="2"]`)
      await expect(hdCard).toHaveAttribute('data-primary', 'true')
      await expect(hdCard.locator('[data-version-card-number]')).toHaveText(uiText(locale, 'generationCommon.sample.finalLabel'))
      assert.equal(videoPosts(fake), postsBefore, '切回已出过高清的样片再确认，POST 计数不增加')
      await setPrimary(win, ctx.sampleNodeId, 1)
    })

    await station('plain', run, async () => {
      const sampleRowSeen = await proveProbe(nodeById(win, ctx.sampleNodeId).locator('[data-sample-row]'), '样片节点下方那一行在（探针认得出这一行）')
      const makeFinalSeen = await proveProbe(nodeById(win, ctx.sampleNodeId).locator('[data-sample-make-final]'), '样片节点上的「出高清」在（探针认得出这颗钮）')
      await win.keyboard.press('Escape')
      await addCanvasNode(win, 'video')
      await expectVisible(selectedNodeComposer(win), 'plain node composer')
      await expect.poll(async () => {
        const currentId = await readNodeId(selectedNodeComposer(win))
        return currentId && currentId !== ctx.sampleNodeId ? currentId : ''
      }, { message: 'plain node id' }).not.toBe('')
      const plainId = await readNodeId(selectedNodeComposer(win))
      assert(plainId && plainId !== ctx.sampleNodeId, 'plain node id')
      await composerIntoView(win, plainId)
      await pickModel(win, locale, PARENT_LABEL, plainId)
      await openNodeParams(win, 'open params (plain 2.5)')
      const resolution = win.locator('[data-agent-parameter-control="resolution"]').first()
      await clickOrFail(resolution.getByRole('radio', { name: '480p', exact: true }).first(), 'plain 2.5 → 480p')
      await win.keyboard.press('Escape')
      await fillPrompt(win, locale === 'en' ? 'Close-up, raindrops on the railing' : '近景，栏杆上的雨珠')
      const before = videoCreates(fake)
      await send(win, locale)
      const created = await nthVideoCreate(fake, before + 1, 'plain 2.5 POST')
      assert.equal(created.body?.resolution, '480p', '普通 2.5 选 480p')
      assert.equal(created.body?.draft, undefined, '普通 2.5 不带 draft')
      const node = nodeById(win, plainId)
      await expect(node.locator('video').first(), '普通 2.5 出完').toBeAttached({ timeout: LONG })
      await expectAbsent(node.locator('[data-sample-row]'), { provenBy: sampleRowSeen, message: 'board:SampleMode/sample.plain-480p：普通 2.5 选 480p 没有样片行' })
      await expectAbsent(node.locator('[data-sample-make-final]'), { provenBy: makeFinalSeen, message: 'board:SampleMode/sample.old-node：没有「出高清」' })
      await screenshotSettled(win, { path: shot('07-plain-480p') })
    })

    await station('narrow', run, async () => {
      // ★9-7 最长文字：28 字镜头名放在最窄（240）节点上，标签行省略；下方一行（最长的一档：中文「剩 21 小时」、英文「48 min left」
      // ——清单 boundarySheet 记英文最长是「Draft · 48 min left」+「Make HD」——加「出高清」）
      // 折行不省略、不出节点。照创作者的路做：点标签改名、拖右边缩放区缩到最窄；量完改回原名、拖回原宽，后面的站照常比拍板图。
      const node = nodeById(win, ctx.sampleNodeId)
      const card = node.locator('.generation-canvas-v2-node').first()
      const keep = node.locator('.generation-canvas-v2-node__preview').first()
      const row = node.locator('[data-sample-row]').first()
      // 取消选择：节点选着、生成框开着时，画布会把生成框留在视口里（拖过去又被带回来）。
      // Esc 可能只让提示词框失焦，所以像真人一样点一下画布空白处。
      const deselect = async (label) => {
        await win.keyboard.press('Escape')
        if (!(await selectedNodeComposer(win).isVisible().catch(() => false))) return
        const blank = await findCanvasBlankPoint(win)
        assert(blank, `${label}：画布上找不到空白处`)
        await win.mouse.click(blank.x, blank.y)
        await expect(selectedNodeComposer(win), `${label}：点空白处取消选择，生成框收起`).toBeHidden()
      }
      // 把样片节点拖到画布正中（标签、卡、下方一行一起在视口里）。
      const centerCard = async (label) => {
        for (let step = 0; (await dragIntoView(win, card, null, { center: true })) === 'dragged'; step += 1) {
          if (step >= 3) throw new Error(`${label}：拖 4 次还没到画布正中`)
        }
      }
      await deselect('取消前一站新节点的选择')
      // 前一站给新节点的生成框让位时画布可能被缩到 40% 以下（en 实测 33%），那时节点只画远看的轻量卡，没有标签和缩放线。
      // 真人会把样片节点拖到画布正中，再放大到 100% 看清楚——照做。
      await centerCard('把样片节点拖到画布正中')
      if ((await canvasZoomPercent(win)) !== 100) await canvasSetZoomPercent(win, 100, 'zoom to 100% to read the sample node')
      await expect(keep, '放大到 100% 后样片节点画整卡').toBeAttached()
      await expect(row).toHaveAttribute('data-sample-state', 'ready')
      await win.clock.install()
      ctx.clockInstalled = true
      const longest = locale === 'en'
        ? { remaining: 47 * MINUTE + 30_000, key: 'generationCommon.sample.expiry.minutes', count: 48 }
        : { remaining: 21 * HOUR + 30 * MINUTE, key: 'generationCommon.sample.expiry.hours', count: 21 }
      await win.clock.setSystemTime(ctx.sendAt + TTL_HOURS * HOUR - longest.remaining)
      await expect(row.locator('[data-sample-expiry]').first(), `最长的一档（${longest.key} = ${longest.count}）`).toHaveText(uiTextWith(locale, longest.key, { count: longest.count }))
      const title = node.locator('[data-node-inline-title="true"]').first()
      const rename = async (value, label) => {
        await onCanvas(win, title.locator('span').first(), label, { keep })
        const input = title.locator('input').first()
        await expect(input, `${label}：标签变成输入框`).toBeVisible()
        const editing = await proveProbe(title.locator('input'), `${label}：改名输入框在`)
        const previous = await input.inputValue()
        await input.fill(value)
        await input.press('Enter')
        await expectAbsent(title.locator('input'), { provenBy: editing, message: `${label}：回车收起` })
        return previous
      }
      const originalTitle = await rename(LONG_SHOT_NAME[locale], 'rename to the 28-char shot name')
      const resizeTo = async (target, label) => {
        await onCanvas(win, keep, `${label}：把节点拖进来`, { hover: true, keep })
        if (!(await card.getAttribute('data-selected') === 'true')) await card.click({ position: { x: 8, y: 8 } })
        await expect(card, `${label}：选中才有缩放区`).toHaveAttribute('data-selected', 'true')
        // 选中后生成框弹出来、画布会挪一下给它让位：等卡停稳再找把手。
        await expect.poll(async () => {
          const before = await card.boundingBox()
          await win.waitForTimeout(120)
          const after = await card.boundingBox()
          return Math.abs(before.x - after.x) + Math.abs(before.y - after.y)
        }, { message: `${label}：选中后卡停稳` }).toBeLessThan(1)
        // 画布里的缩放把手归 React Flow 的 NodeResizer（唯一选中的卡才挂）。真人缩小一张卡，是抓右下角往左上拉：
        // 媒体卡锁比例，React Flow 的角把手只横拉不动（锁比例时角取宽高里变得少的那个），所以斜着拉；
        // 右边那条线只有 1px，落在半像素上时整数坐标的鼠标点不中（实测按下落在画面上、拖成了平移），不用它。
        // 角被盖住或出了画布时退到底边那条线竖着拉（锁比例，宽跟着缩）。点都取整数坐标，再看最上面那层是不是这张卡的把手。
        const grip = await node.evaluate((root) => {
          const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
          const inPane = (x, y) => Boolean(pane) && x > pane.left + 4 && x < pane.right - 4 && y > pane.top + 4 && y < pane.bottom - 4
          const box = root.getBoundingClientRect()
          const tries = []
          const corner = root.querySelector('.react-flow__resize-control.handle.bottom.right')?.getBoundingClientRect()
          if (corner) for (const [ox, oy] of [[4, 4], [0, 0], [4, 0], [0, 4]]) tries.push({ kind: 'corner', x: Math.round(corner.left + corner.width / 2) + ox, y: Math.round(corner.top + corner.height / 2) + oy })
          const bottom = root.querySelector('.react-flow__resize-control.line.bottom')?.getBoundingClientRect()
          if (bottom) for (const f of [0.3, 0.5, 0.7]) tries.push({ kind: 'bottom', x: Math.round(bottom.left + bottom.width * f), y: Math.ceil(bottom.top) })
          const miss = []
          for (const point of tries) {
            const top = inPane(point.x, point.y) ? document.elementFromPoint(point.x, point.y) : null
            if (top?.closest('.react-flow__resize-control') && root.contains(top)) return { ...point, ratio: box.height / box.width }
            miss.push(`${point.kind}@${point.x},${point.y}→${top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : '画布外'}`)
          }
          return { miss }
        })
        assert(!grip.miss, `${label}：缩放把手都被盖着或在画布外：${JSON.stringify(grip.miss)}`)
        const now = await card.evaluate((el) => ({ layout: el.offsetWidth, screen: el.getBoundingClientRect().width }))
        const along = (target - now.layout) * (now.screen / now.layout)
        const [dx, dy] = grip.kind === 'corner' ? [along, along * grip.ratio] : [0, along * grip.ratio]
        const sx = grip.x
        const sy = grip.y
        await win.mouse.move(sx, sy)
        await win.mouse.down()
        for (let i = 1; i <= 10; i += 1) await win.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10)
        await win.mouse.up()
        await win.waitForTimeout(200)
        return now.layout
      }
      const originalWidth = await resizeTo(MIN_NODE_WIDTH - 200, 'shrink to the narrowest node')
      const width = await card.evaluate((el) => el.offsetWidth)
      assert(Math.abs(width - MIN_NODE_WIDTH) <= 1, `缩到最窄应是 ${MIN_NODE_WIDTH}，实际 ${width}`)
      // 缩完看整张窄卡：取消选择、拖回画布正中，标签、卡、下方一行同屏（这张截图对拍板图 long-text+narrow 那一格）。
      await deselect('缩完取消选择')
      await centerCard('缩完把窄卡拖回画布正中')
      await win.mouse.move(4, 200)
      const geo = await node.evaluate((root) => {
        const box = (el) => el.getBoundingClientRect()
        const cardBox = box(root.querySelector('.generation-canvas-v2-node'))
        const label = root.querySelector('[data-node-inline-title="true"] span')
        const rowEl = root.querySelector('[data-sample-row]')
        const clipped = [...rowEl.querySelectorAll('*')]
          .filter((el) => el.children.length === 0 && (el.textContent || '').trim())
          .filter((el) => el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).display !== 'inline')
          .map((el) => el.textContent.trim())
        return {
          card: { left: cardBox.left, right: cardBox.right },
          // 标题 span 带 `-mx-1 px-1`（悬停底色向两侧各出 4px），字在内边距里：量字所在的内容框，不量悬停底色。
          label: { text: label?.textContent, truncated: !!label && label.scrollWidth > label.clientWidth + 0.5, left: box(label).left + parseFloat(getComputedStyle(label).paddingLeft), right: box(label).right - parseFloat(getComputedStyle(label).paddingRight) },
          row: { text: rowEl.innerText.replace(/\s+/g, ' '), left: box(rowEl).left, right: box(rowEl).right, height: Math.round(box(rowEl).height), clipped },
        }
      })
      console.log(`  [量] 240 宽：${JSON.stringify(geo)}`)
      assert(geo.label.truncated, `board:SampleMode/sample.below-row（最长文字）：28 字镜头名在 240 宽节点上应省略，实际「${geo.label.text}」放下了`)
      assert(geo.label.left >= geo.card.left - 1 && geo.label.right <= geo.card.right + 1, `标签行出了节点：${JSON.stringify(geo.label)}`)
      assert.deepEqual(geo.row.clipped, [], `board:SampleMode/sample.below-row（最长文字）：下方一行不省略，被截断的字：${JSON.stringify(geo.row.clipped)}`)
      assert(geo.row.left >= geo.card.left - 1 && geo.row.right <= geo.card.right + 1, `下方一行出了节点：${JSON.stringify(geo.row)}`)
      await screenshotSettled(win, { path: shot('10-narrow-long-name') })
      await resizeTo(originalWidth, 'restore the node width')
      await win.keyboard.press('Escape')
      await rename(originalTitle, 'restore the shot name')
      await expect.poll(() => card.evaluate((el) => el.offsetWidth), { message: '拖回原宽' }).toBeGreaterThanOrEqual(originalWidth - 2)
    })

    await station('expiry', run, async () => {
      const node = nodeById(win, ctx.sampleNodeId)
      // 上一站把画布往右拖过，样片节点可能有一截在窗口外：先取消选择（收起普通节点的生成框），再像真人一样把这一行拖进来看。
      await win.keyboard.press('Escape')
      const row = node.locator('[data-sample-row]').first()
      const chip = row.locator('[data-sample-expiry]').first()
      await onCanvas(win, chip, 'bring the sample row into view', { hover: true, keep: node.locator('.generation-canvas-v2-node__preview').first() })
      const tipShown = await proveProbe(win.locator('[data-sample-expiry-hover]'), '悬停时有效期提示在')
      const chipBox = await chip.boundingBox()
      await win.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height + 40, { steps: 6 })
      await win.mouse.move(chipBox.x - 60, chipBox.y + chipBox.height + 60, { steps: 6 })
      await expectAbsent(win.locator('[data-sample-expiry-hover]'), { provenBy: tipShown, message: '指针移开，提示收起' })
      await expect(row).toHaveAttribute('data-sample-state', 'ready')
      if (!ctx.clockInstalled) await win.clock.install()
      const deadline = ctx.sendAt + TTL_HOURS * HOUR
      const at = async (remainingMs) => { await win.clock.setSystemTime(deadline - remainingMs) }
      await at(2 * HOUR + 30 * MINUTE)
      await expect(chip, 'board:SampleMode/sample.expiry-chip：剩 2 小时多').toHaveText(uiTextWith(locale, 'generationCommon.sample.expiry.hours', { count: 2 }))
      await expect(chip, '2 小时以上不换提醒色').not.toHaveAttribute('data-sample-expiry-warning', 'true')
      await at(HOUR + 30 * MINUTE)
      await expect(chip, 'board:SampleMode/sample.expiry-chip：剩 1 小时多').toHaveText(uiTextWith(locale, 'generationCommon.sample.expiry.hours', { count: 1 }))
      await expect(chip, '不到 2 小时换提醒色').toHaveAttribute('data-sample-expiry-warning', 'true')
      await at(47 * MINUTE + 30_000)
      await expect(chip, 'board:SampleMode/sample.expiry-chip：剩 48 分钟（向上取整，不说 0）').toHaveText(uiTextWith(locale, 'generationCommon.sample.expiry.minutes', { count: 48 }))
      await expect(chip).toHaveAttribute('data-sample-expiry-warning', 'true')
      await screenshotSettled(win, { path: shot('08-expiry-warning') })
      const makeFinalBefore = await proveProbe(row.locator('[data-sample-make-final]'), '过期前「出高清」在')
      await at(-MINUTE)
      await expect(chip, 'board:SampleMode/sample.expiry-chip：过期').toHaveText(uiText(locale, 'generationCommon.sample.expiry.expired'))
      await expectAbsent(row.locator('[data-sample-make-final]'), { provenBy: makeFinalBefore, message: '过期后没有「出高清」' })
      const redraft = row.locator('[data-sample-redraft]').first()
      await expect(redraft, 'board:SampleMode/sample.redraft-button').toHaveText(uiText(locale, 'generationCommon.sample.redraft'))
      await expectFont(redraft, 'caption', 'board:SampleMode/sample.redraft-button')
      await screenshotSettled(win, { path: shot('09-expired') })
      fake.expireDraft(ctx.sampleTaskId)
      const before = videoCreates(fake)
      await onCanvas(win, redraft, 'redraft sample', { keep: node.locator('.generation-canvas-v2-node__preview').first() })
      const confirm = win.locator('[data-spend-confirm-action="confirm"]').first()
      // 重拍样片和生成框 ↑ 同一个口：同一组设置再花一次钱时，现成的「再发一次」确认会先问（有就点确认，记进日志）。
      const asked = await confirm.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)
      console.log(`  重拍样片：${asked ? '先问了「再发一次」，点确认' : '没问，直接发'}`)
      if (asked) await clickOrFail(confirm, 'confirm redraft')
      const created = await nthVideoCreate(fake, before + 1, 'redraft POST')
      assert.equal(created.body?.draft, true, '重拍样片按样片发（draft: true）')
      assert.equal(created.body?.resolution, '480p')
      assert.equal(created.body?.draft_task_id, undefined, '重拍样片不带旧样片号')
    })
    await station('recovery', run, async () => {
      const projectId = await win.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('projectId'))
      const project = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find(item => item.id === projectId)
      assert(project?.rootPath, '找回站需要当前项目的持久目录')
      const reopen = async () => {
        await app.close()
        const restarted = await launch(world, run, fake)
        app = restarted.app
        win = restarted.win
        await clickOrFail(win.locator(`[data-project-card][data-project-id="${projectId}"]`), '重开原项目')
        await switchWorkspace(win, 'generation')
      }
      if (ctx.clockInstalled) await reopen()
      await addCanvasNode(win, 'video')
      await expectVisible(selectedNodeComposer(win), '找回站的新视频节点')
      await expect.poll(async () => {
        const currentId = await readNodeId(selectedNodeComposer(win))
        return currentId && currentId !== ctx.sampleNodeId ? currentId : ''
      }, { message: '找回站使用独立节点' }).not.toBe('')
      const id = await readNodeId(selectedNodeComposer(win))
      assert(id && id !== ctx.sampleNodeId, '找回站使用独立节点')
      await composerIntoView(win, id)
      await pickModel(win, locale, SAMPLE_LABEL[locale], id)
      await fillPrompt(win, locale === 'en' ? 'A gull takes off from a lighthouse' : '海鸥从灯塔起飞')
      const node = () => nodeById(win, id)
      const row = () => node().locator('[data-sample-row]')
      const final = () => row().locator('[data-sample-make-final]')
      const assertSampleReady = async () => {
        await expect(row()).toHaveAttribute('data-sample-state', 'ready', { timeout: LONG })
        await expect(row().locator('[data-sample-expiry]')).toHaveText(uiTextWith(locale, 'generationCommon.sample.expiry.days', { count: 2 }))
        await expect(final()).toHaveText(uiText(locale, 'generationCommon.sample.makeFinal'))
      }
      const interrupt = async (taskId, landed) => {
        // 先证任务号已进项目存盘、查询尚在 processing，再关掉整个宿主。相同节点的上一版无法满足这个判据。
        const projectFile = path.join(project.rootPath, '.nomi', 'project.json')
        await expect.poll(() => JSON.parse(fs.readFileSync(projectFile, 'utf8')).payload?.generationCanvas?.nodes
          ?.find(item => item.id === id)?.runs?.[0]?.taskId, { timeout: LONG }).toBe(taskId)
        await expect.poll(() => fake.hits.some(hit => hit.method === 'GET' && hit.url === `/v1/tasks/${taskId}`), { timeout: LONG }).toBe(true)
        await reopen()
        fake.setProcessingHold(false)
        const retrieve = node().getByRole('button', { name: uiText(locale, 'generationCommon.production.runAction.retry-retrieval'), exact: true })
        await expect(landed().or(retrieve).first()).toBeVisible({ timeout: LONG })
        if (await retrieve.isVisible()) await onCanvas(win, retrieve, '重新取回原单')
        await expect(landed()).toBeVisible({ timeout: LONG })
      }
      fake.setProcessingHold(true)
      const beforeSample = videoPosts(fake)
      const beforeSampleTasks = videoCreates(fake)
      await send(win, locale)
      const draft = await nthVideoCreate(fake, beforeSampleTasks + 1, '找回站样片')
      assert.equal(draft.body?.draft, true)
      assert.equal(draft.body?.resolution, '480p')
      await interrupt(draft.taskId, final)
      await assertSampleReady()
      const beforeFinal = videoPosts(fake)
      assert.equal(beforeFinal - beforeSample, 1, '样片重启取回只下原单')
      console.log(`  recovery 480p POST ${beforeSample} → ${beforeFinal}（+1）`)

      fake.setProcessingHold(true)
      const beforeFinalTasks = videoCreates(fake)
      await onCanvas(win, final(), '从找回的样片出高清')
      const hd = await nthVideoCreate(fake, beforeFinalTasks + 1, '找回站高清')
      assert.deepEqual(hd.body, { model: 'seedance-2.5', draft_task_id: draft.taskId, resolution: '1080p' })
      await interrupt(hd.taskId, () => node().locator('[data-version-badge]'))
      await expect(node().locator('[data-version-badge]')).toHaveText('2')
      await setVersionsSpread(win, id, true)
      const card = win.locator(`[data-version-grid="${id}"] [data-version-card="2"]`)
      await expect(card).toHaveAttribute('data-primary', 'true')
      await expect(card.locator('[data-version-card-number]')).toHaveText(uiText(locale, 'generationCommon.sample.finalLabel'))
      await setPrimary(win, id, 1)
      await assertSampleReady()
      assert.equal(videoPosts(fake) - beforeFinal, 1, '高清重启取回只下原单')
      console.log(`  recovery 1080p POST ${beforeFinal} → ${videoPosts(fake)}（+1）`)
    })

  } catch (error) {
    if (!error?.stationRed) {
      failed = true
      summary.push({ run: `${locale}-${scheme}`, station: 'setup', ok: false, error: String(error?.message || error).split('\n').slice(0, 6).join('\n') })
      console.log(`✗ ${locale}/${scheme} setup\n${String(error?.message || error).split('\n').slice(0, 8).join('\n')}`)
    }
    await screenshotSettled(win, { path: shot('zz-failure') }).catch(() => undefined)
  } finally {
    fs.writeFileSync(path.join(OUT, `vendor-requests.${locale}.${scheme}.json`), JSON.stringify(fake.hits, null, 2))
    await app.close().catch(() => undefined)
    await fake.close()
    world.cleanup?.()
  }
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ out: OUT, stations: summary }, null, 2))
console.log(`证据：${OUT}`)
process.exit(failed ? 1 : 0)
