// 走查：Nomi 入口收进顶栏最右（NomiEntryTopbar 板；设计卡 docs/plan/2026-11-22-nomi-entry-topbar.md；对照表 NomiEntryTopbar.mapping.md）。
//
// 真实用户任务：创作者把面板收起来接着干活——生成页画布、分镜表的「生成剩余」、预览页导出都要点得到；Nomi 在做、等你确认、
// 有一步没成时，从顶栏最右那张脸上看得出来；窗口拖窄到 700，顶栏按 ① 导出收图标 → ② 分段左挪 / 项目名变短再藏 →
// ③ 藏进度数字 → ④「新版本」收小点 的顺序让，分段离两簇都留 12px。
// 改前：内容区右下有一颗能拖的小球，收起后压住「生成剩余」等右下角的控件；顶栏没有 Nomi。
//
// 每一步量真实像素：
//   ① 不压内容：700 / 900 / 1100 / 1440 × 项目库 / 创作（分镜表）/ 生成 / 预览，
//      内容区每个可点控件露出的那块取中心 + 四个 1/4 点 elementFromPoint 都落回它自己（被压住的个数 = 0）；
//      项目库顶栏没有入口（先在工作台证同一个探针量得到，再回项目库量不到）；
//   ② 入口：五种脸、角标（1 / 9 / 12 / 120 → 9+）、胶囊（≥900 放得下且面板没开）、点（未读蓝 / 没成红，有角标时不出）、
//      悬停提示（打开 Nomi（⌘J）/ 收起面板（⌘\）· 状态 · 新消息），静止 / 悬停 / 按下 / 焦点和旁边「设置」钮一致；
//   ③ 让位：同样几件事全开（新版本 + 3 个任务 + 待确认 + 进度数字），700 / 900 每格走到第几步和对照表一致；1100 / 1440 不让；
//      来回拖窗每个阈值只翻一次。
// 零额度：Agent 状态、任务、更新事件都是走查摆出来的（E2E 桥 + 主进程往窗口发 nomi:update:event），不发消息、不碰生成。
// 四轮：中文浅 / 中文深 / 英文浅 / 英文深（NOMI_WALK_ROUNDS=zh-light,en-dark 只跑其中几轮）。
// Run: pnpm run build && node tests/ux/nomi-entry-topbar.walk.mjs
//      截图目录：NOMI_ENTRY_SHOTS=<绝对路径>（默认 tests/ux/shots/nomi-entry-topbar）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { AGENT_PANEL, COLLAPSED_SHELL, backToLibrary, switchWorkspace } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = process.env.NOMI_ENTRY_SHOTS ? path.resolve(process.env.NOMI_ENTRY_SHOTS) : path.join(repoRoot, 'tests/ux/shots/nomi-entry-topbar')
fs.mkdirSync(shotsDir, { recursive: true })
const executablePath = process.env.NOMI_WALK_APP ? path.resolve(process.env.NOMI_WALK_APP) : undefined
const rounds = [
  { locale: 'zh-CN', scheme: 'light', tag: 'zh-light', projectName: '入口走查 · 一个名字很长很长的短片项目' },
  { locale: 'zh-CN', scheme: 'dark', tag: 'zh-dark', projectName: '入口走查 · 一个名字很长很长的短片项目' },
  { locale: 'en', scheme: 'light', tag: 'en-light', projectName: 'Entry walk · a short film with a very long name' },
  { locale: 'en', scheme: 'dark', tag: 'en-dark', projectName: 'Entry walk · a short film with a very long name' },
].filter((round) => !process.env.NOMI_WALK_ROUNDS || process.env.NOMI_WALK_ROUNDS.split(',').includes(round.tag))

const HEIGHT = 800
const WIDTHS = [700, 900, 1100, 1440]
const PAGES = ['creation', 'generation', 'preview']
const GAP = 12
const ENTRY = '[data-shell-nomi-entry]'
const SURFACES = ['creation', 'storyboard', 'generation', 'preview']

// 拍板清单元素断言（check:board-parity 认这些名字）。
const BOARD = {
  entry: 'board:NomiEntryTopbar/nomi-entry',
  face: 'board:NomiEntryTopbar/nomi-entry.face',
  badge: 'board:NomiEntryTopbar/nomi-entry.pending-badge',
  capsule: 'board:NomiEntryTopbar/nomi-entry.pending-capsule',
  dot: 'board:NomiEntryTopbar/nomi-entry.dot',
  tooltip: 'board:NomiEntryTopbar/nomi-entry.tooltip',
  bar: 'board:NomiEntryTopbar/topbar.bar',
  left: 'board:NomiEntryTopbar/topbar.left-cluster',
  segment: 'board:NomiEntryTopbar/topbar.segment',
  meta: 'board:NomiEntryTopbar/topbar.segment-meta',
  switcher: 'board:NomiEntryTopbar/topbar.view-switcher',
  export: 'board:NomiEntryTopbar/topbar.export',
  update: 'board:NomiEntryTopbar/topbar.update-pill',
  right: 'board:NomiEntryTopbar/topbar.right-cluster',
  yield: 'board:NomiEntryTopbar/topbar.yield-order',
  library: 'board:NomiEntryTopbar/library.topbar-no-entry',
  formSwitch: 'board:NomiEntryTopbar/panel.form-switch',
  uncovered: 'board:NomiEntryTopbar/shell.content-uncovered',
}

// 「最挤」那几行该走到第几步（对照表 E1–E10；E5 / E6 是 Windows，这台机器量不到，记 unverified）。
const CROWDED_STEPS = {
  'zh-CN': { 700: 2, 900: 2, '900-installFailed': 3 },
  en: { 700: 3, 900: 3, '900-installFailed': 4 },
}
// 胶囊宽（对照表 C1 / B4：等你确认 2 = 99、Confirm 2 = 98、等你确认 120 = 116、Confirm 120 = 115）。
const CAPSULE_WIDTH = { 'zh-CN': { 2: 99, 120: 116 }, en: { 2: 98, 120: 115 } }

const failures = []
const unverified = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const note = (text) => console.log(`  · ${text}`)

const clip = (id, type, startFrame, endFrame) => ({
  id, type, sourceNodeId: `node-${id}`, label: id, startFrame, endFrame, frameCount: endFrame - startFrame + 60, offsetStartFrame: 0, offsetEndFrame: 0,
})
const TIMELINE = {
  version: 1, fps: 30, scale: 1, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: 'image', clips: [clip('clip-image', 'image', 0, 90)] },
    { id: 'videoTrack', type: 'video', label: 'video', clips: [clip('clip-video', 'video', 0, 22_000)] },
  ],
  textClips: [],
  transitions: [],
}
const NODE_IDS = ['entry-node-1', 'entry-node-2', 'entry-node-3']

/** 老用户真实存过的分镜方案（v0.24.1 夹具）：创作页打开分镜表，底栏右端是「生成剩余」——小球收起后正压在它上面。 */
function storyboardPayload() {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project/.nomi/project.json'), 'utf8'))
  const { workbenchDocuments, activeDocumentId, storyboardDesignsByDocumentId } = fixture.payload
  return { workbenchDocuments, activeDocumentId, storyboardDesignsByDocumentId }
}

function writeProject(projectsDir, projectId, name) {
  const root = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const now = Date.now()
  const nodes = NODE_IDS.map((id, index) => ({
    id, kind: 'image', title: `shot ${index + 1}`, prompt: '', categoryId: 'shots', references: [], runs: [],
    status: 'idle', position: { x: 120 + index * 360, y: 160 }, size: { width: 320, height: 180 },
  }))
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify({
    id: projectId, name, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
    payload: { ...storyboardPayload(), timeline: TIMELINE, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] } },
  }))
}

/**
 * 内容区里被压住的可点控件：在它露出来的那块（被滚动区 / 窗口裁掉的部分不算）取中心 + 四个 1/4 点做 elementFromPoint，
 * 任一点落到别的东西上就算被压住。只取中心点量不出今天的病：1100 分镜表「生成剩余」被小球压住了右半截字，中心点刚好露在球下沿外面。
 */
function coveredControls(win) {
  return win.evaluate(() => {
    const main = document.querySelector('[data-shell-main]') ?? document.querySelector('main') ?? document.body
    const selector = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="radio"]'
    const vw = window.innerWidth
    const vh = window.innerHeight
    const visibleBox = (el) => {
      let box = el.getBoundingClientRect()
      let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(vw, box.right), bottom = Math.min(vh, box.bottom)
      for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          box = parent.getBoundingClientRect()
          left = Math.max(left, box.left); top = Math.max(top, box.top); right = Math.min(right, box.right); bottom = Math.min(bottom, box.bottom)
        }
      }
      if (right - left < 2 || bottom - top < 2) return null
      const at = (fx, fy) => ({ x: left + (right - left) * fx, y: top + (bottom - top) * fy })
      return [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)]
    }
    const describe = (el) => {
      if (!el) return 'null'
      const attrs = [...el.attributes].filter((a) => a.name.startsWith('data-')).slice(0, 2).map((a) => `${a.name}${a.value ? `=${a.value.slice(0, 20)}` : ''}`)
      return `${el.tagName.toLowerCase()}${attrs.length ? `[${attrs.join('][')}]` : ''}`
    }
    const covered = []
    let total = 0
    for (const el of main.querySelectorAll(selector)) {
      if (el.closest('[hidden], [aria-hidden="true"], [data-shell-agent-layer]')) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0) continue
      if (el.getClientRects().length === 0) continue
      const points = visibleBox(el)
      if (!points) continue
      total += 1
      const hit = points.map((point) => document.elementFromPoint(point.x, point.y)).find((h) => h && el !== h && !el.contains(h) && !h.contains(el))
      if (!hit) continue
      covered.push(`${(el.getAttribute('aria-label') || el.textContent || describe(el)).trim().slice(0, 24)} ← ${describe(hit)}`)
    }
    return { total, covered }
  })
}

/** 顶栏一次量全：分段（连同「画布 / 列表」）、两簇、入口、导出、新版本、进度数字。 */
function measureBar(win) {
  return win.evaluate((entrySelector) => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const shown = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
    const header = document.querySelector('[data-shell-topbar]')
    const toolbar = header?.querySelector('[role="toolbar"]')
    const segment = header?.querySelector('[data-shell-stage-center]')
    const switcher = header?.querySelector('[data-shell-view-switcher-slot]')
    const menu = header?.querySelector('[data-shell-project-menu]')
    const name = header?.querySelector('[data-shell-project-name]')
    const left = header?.querySelector('[data-shell-left-cluster]')
    const entry = header?.querySelector(entrySelector)
    const anyEntry = document.querySelector(entrySelector)
    const exportButton = header?.querySelector('[data-shell-export]')
    const update = header?.querySelector('[data-update-badge]')
    const updateLabel = update ? [...update.querySelectorAll('span')].find((span) => span.textContent.trim().length > 1) : null
    const settings = header?.querySelector('[data-shell-settings]')
    const meta = [...(header?.querySelectorAll('[data-stepper-meta]') ?? [])]
    const steps = [...(header?.querySelectorAll('.nomi-stepper__step') ?? [])]
    const segRect = rect(segment)
    const switcherRect = shown(switcher?.firstElementChild ?? null) ? rect(switcher) : null
    const segRight = Math.max(segRect?.right ?? 0, switcherRect?.right ?? 0)
    const toolbarRect = rect(toolbar)
    const headerRect = rect(header)
    const children = toolbar ? [...toolbar.children].filter((child) => shown(child) || [...child.querySelectorAll('*')].some(shown)) : []
    const childKey = (child) => {
      if (child.matches(entrySelector) || child.querySelector(entrySelector)) return 'entry'
      if (child.querySelector('[data-shell-export]') || child.matches('[data-shell-export]')) return 'export'
      if (child.matches('[data-task-center-trigger]') || child.querySelector('[data-task-center-trigger]')) return 'tasks'
      if (child.matches('[data-shell-browser]') || child.querySelector('[data-shell-browser]')) return 'browser'
      if (child.matches('[data-update-badge]') || child.querySelector('[data-update-badge]')) return 'update'
      if (child.matches('[data-shell-settings]') || child.querySelector('[data-shell-settings]')) return 'settings'
      return 'layout'
    }
    const entryStyle = entry ? getComputedStyle(entry) : null
    return {
      vw: window.innerWidth,
      header: headerRect,
      step: header?.getAttribute('data-shell-yield-step'),
      segment: segRect,
      segRight,
      switcher: switcherRect,
      menuRight: rect(menu)?.right ?? null,
      leftWidth: left ? left.getBoundingClientRect().width : null,
      leftContent: left ? left.clientWidth - parseFloat(getComputedStyle(left).paddingLeft) - parseFloat(getComputedStyle(left).paddingRight) : null,
      nameShown: shown(name),
      toolbar: toolbarRect,
      order: children.map(childKey),
      entryCount: document.querySelectorAll(entrySelector).length,
      entryInHeader: Boolean(entry),
      entry: entry ? {
        rect: rect(entry),
        status: entry.getAttribute('data-status'),
        pending: entry.getAttribute('data-pending'),
        shape: entry.getAttribute('data-shape'),
        pressed: entry.getAttribute('aria-pressed'),
        label: entry.getAttribute('aria-label'),
        badge: entry.querySelector('[data-nomi-entry-badge]')?.textContent ?? null,
        badgeRect: rect(entry.querySelector('[data-nomi-entry-badge]')),
        dot: entry.querySelector('[data-nomi-entry-dot]')?.getAttribute('data-nomi-entry-dot') ?? null,
        dotRect: rect(entry.querySelector('[data-nomi-entry-dot]')),
        dotColor: entry.querySelector('[data-nomi-entry-dot]') ? getComputedStyle(entry.querySelector('[data-nomi-entry-dot]')).backgroundColor : null,
        capsuleText: entry.querySelector('[data-nomi-entry-capsule]')?.textContent ?? null,
        capsuleClipped: (() => { const c = entry.querySelector('[data-nomi-entry-capsule]'); return c ? c.scrollWidth > c.clientWidth + 1 : null })(),
        faceSpinning: [...entry.querySelectorAll('*')].some((node) => getComputedStyle(node).animationName.includes('spin') && getComputedStyle(node).animationPlayState === 'running'),
        bg: entryStyle.backgroundColor,
      } : null,
      entryOutsideHeader: Boolean(anyEntry) && !entry,
      settings: settings ? { rect: rect(settings), bg: getComputedStyle(settings).backgroundColor } : null,
      exportCompact: exportButton ? exportButton.getAttribute('data-shell-export-compact') === 'true' : null,
      exportRect: rect(exportButton),
      update: update ? { phase: update.getAttribute('data-update-badge'), labelShown: shown(updateLabel), title: update.getAttribute('title'), rect: rect(update) } : null,
      metaShown: meta.filter(shown).length,
      metaTotal: meta.length,
      stepTitles: steps.map((step) => step.getAttribute('title')).filter(Boolean),
    }
  }, ENTRY)
}

const gaps = (bar) => ({
  left: bar.segment && bar.menuRight != null ? bar.segment.left - bar.menuRight : null,
  right: bar.segment && bar.toolbar ? bar.toolbar.left - bar.segRight : null,
  shift: bar.segment && bar.header ? (bar.header.left + bar.header.width / 2) - (bar.segment.left + bar.segment.width / 2) : null,
})

async function runRound({ locale, scheme, tag, projectName }) {
  console.log(`\n── ${tag} ──`)
  const tempRoot = makeTempDir('nomi-entry-topbar-')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectId = `walk-entry-topbar-${tag}`
  writeProject(projectsDir, projectId, projectName)
  // 词典里没有这条（改前的代码）就给一个认得出的占位，让每条检查各自红，不在中途抛错。
  const t = (key, values) => {
    try { return values ? uiTextWith(locale, key, values) : uiText(locale, key) } catch { return `«${key}»` }
  }
  // 英文轨里出现中文字 / 全角标点 = 英文那条漏改（★9 反例「只改了中文文案」）。期望值是按键从词典取的，漏改时它也是中文，只比相等抓不到。
  const englishOnly = (text) => !/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(text ?? '')
  const shot = async (win, name, header = false) => {
    const file = path.join(shotsDir, `${tag}-${name}.png`)
    if (header) await win.locator('[data-shell-topbar]').first().screenshot({ path: file }).catch(() => undefined)
    else await screenshotSettled(win, { path: file }).catch(() => undefined)
  }
  /** 只截一块：元素四周各放 pad 像素（清单外样子变化的改前 / 改后并排图用）。 */
  const shotAround = async (win, name, selector, pad = 24) => {
    const box = await win.locator(selector).first().boundingBox().catch(() => null)
    if (!box) return
    const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad))
    await win.screenshot({ path: path.join(shotsDir, `${tag}-${name}.png`), clip: { x, y, width: Math.ceil(box.width + pad * 2), height: Math.ceil(box.height + pad * 2) } }).catch(() => undefined)
  }
  let app
  try {
    const launched = await launchNomiApp({
      name: `nomi-entry-topbar-${tag}`, tempRoot, projectsDir, settleMs: 0, timeout: 300_000,
      ...(executablePath ? { executablePath } : {}),
      viewportSize: { width: 1440, height: HEIGHT },
      mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
      env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_DISABLE_AUTO_UPDATE: '1' },
      initialLocalStorage: {
        'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
        'nomi-color-scheme': scheme, __nomiE2E: '1',
      },
    })
    app = launched.app
    let win = launched.win
    win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))
    const resize = async (width, height = HEIGHT) => {
      const browserWindow = await app.browserWindow(win)
      await browserWindow.evaluate((windowRef, size) => windowRef.setContentSize(size.width, size.height), { width, height })
      await win.setViewportSize({ width, height })
      await win.waitForTimeout(120)
    }
    const sendUpdate = (events) => app.evaluate(({ BrowserWindow }, list) => {
      for (const event of list) for (const windowRef of BrowserWindow.getAllWindows()) windowRef.webContents.send('nomi:update:event', event)
    }, events)
    const UPDATE_AVAILABLE = { type: 'available', version: '0.99.0', notes: [], sizeBytes: null, releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/tag/v0.99.0' }

    // ── 项目库：不压内容（I1 项目库那一页）；「顶栏没有入口」（H1）放在这一轮最后，先在工作台证探针 ──
    await win.locator('[data-project-card]').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    for (const width of [700, 1440]) {
      await resize(width)
      const cover = await coveredControls(win)
      check(`${BOARD.uncovered} 项目库 ${width}：没有被压住的控件（共 ${cover.total} 个）`, cover.covered.length === 0, `压住 ${cover.covered.length}${cover.covered.length ? `：${cover.covered.slice(0, 4).join('；')}` : ''}`)
      await shot(win, `library-${width}`, true)
    }

    await resize(1440)
    await clickOrFail(win.locator('[data-project-card]', { hasText: projectName.slice(0, 8) }).first(), 'open project', { timeout: stationTimeout() })
    for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
    win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
    await resize(1440)
    await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    await win.waitForFunction(() => Boolean(window.__nomiAgentForm && window.__nomiResidentActivityStore), null, { timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined)

    const collapseAll = () => win.evaluate((surfaces) => { for (const surface of surfaces) window.__nomiAgentForm?.collapseAgent(surface) }, SURFACES)
    const placeOn = (surface, placement) => win.evaluate(({ s, p }) => window.__nomiAgentForm?.chooseAgentPlacement(s, p), { s: surface, p: placement })
    /** 摆一种 Agent 状态（face = 脸的状态；有待确认时合并状态是 needs-confirm，同生产 resolveDockStatus）。 */
    const setAgent = async ({ face = 'idle', pending = 0, unread = 0 } = {}) => {
      await win.evaluate(({ face, pending, unread }) => {
        const store = window.__nomiResidentActivityStore
        if (!store) return
        store.setState({ dockStatus: pending > 0 ? 'needs-confirm' : face, dockFaceStatus: face, dockPendingCount: pending, dockUnreadCount: unread })
      }, { face, pending, unread })
      await win.waitForTimeout(80)
    }
    const setTasks = (count) => win.evaluate(({ ids, count, projectId }) => {
      const queue = window.__nomiQueueStore
      if (!queue) return false
      queue.setState({ entries: [], batches: {} })
      if (count > 0) {
        const batch = queue.getState().enqueueBatch([ids.slice(0, count)], projectId)
        queue.getState().markRunning(batch, ids[0])
      }
      return true
    }, { ids: NODE_IDS, count, projectId })
    const ensureStoryboard = async () => {
      if (await win.locator('.workbench-storyboard:visible').first().isVisible().catch(() => false)) return
      await openStoryboardEditor(win, { pick: 'first' }, '打开分镜表（「生成剩余」在底栏右端）').catch((error) => note(`分镜表没打开：${String(error?.message ?? error).split('\n')[0]}`))
    }
    const goPage = async (page) => {
      await switchWorkspace(win, page)
      if (page === 'creation') await ensureStoryboard()
      await win.waitForTimeout(150)
    }
    // stay：读完提示不挪开鼠标（要拍「悬停着」的样子时用；拍完调用方自己挪开）。
    const hoverTooltip = async ({ stay = false } = {}) => {
      const entry = win.locator(ENTRY).first()
      if (!(await entry.isVisible().catch(() => false))) return null
      await win.mouse.move(5, HEIGHT - 5)
      await win.waitForTimeout(120)
      await entry.hover()
      const content = win.locator('[data-radix-popper-content-wrapper] > *').last()
      const ok = await content.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)
      if (!ok) return null
      const info = await content.evaluate((el) => ({ text: [...el.querySelectorAll(':scope > span.block')].map((s) => s.textContent).join(' · ') || el.textContent, height: el.getBoundingClientRect().height, lines: el.querySelectorAll(':scope > span.block').length, clipped: el.scrollWidth > el.clientWidth + 1 }))
      if (stay) return info
      await win.mouse.move(5, HEIGHT - 5)
      await win.waitForTimeout(120)
      return info
    }
    const leaveEntry = async () => {
      await win.mouse.move(5, HEIGHT - 5)
      await win.waitForTimeout(120)
    }
    // 每种长相真点一次（任务书「入口五种脸 × 胶囊 / 角标各真点一次」）：点 → 面板打开、入口按下；再用 store 收回去，
    // 让下一格从收着量起（「再点入口收起」那一下由 D3 单独判，这里不重复）。
    const clickEntryOpens = async (label) => {
      const entry = win.locator(ENTRY).first()
      if (!(await entry.isVisible().catch(() => false))) {
        check(`${BOARD.entry} ${label}：点入口`, false, '顶栏没有入口')
        return
      }
      try {
        await entry.click({ timeout: 3000 })
        await win.waitForTimeout(300)
        const pressed = await entry.getAttribute('aria-pressed', { timeout: 2000 }).catch(() => null)
        const opened = await win.locator(AGENT_PANEL).first().isVisible().catch(() => false)
        check(`${BOARD.entry} ${label}：点入口 → 面板打开、入口按下`, opened && pressed === 'true', `面板 ${opened} / 按下 ${pressed}`)
      } catch (error) {
        check(`${BOARD.entry} ${label}：点入口 → 面板打开、入口按下`, false, `点不动：${String(error?.message ?? error).split('\n')[0]}`)
      } finally {
        await collapseAll().catch(() => undefined)
        await leaveEntry().catch(() => undefined)
        await win.waitForTimeout(200)
      }
    }

    // ── I1：收起后不压内容（4 宽 × 3 页） ──
    await collapseAll()
    for (const width of WIDTHS) {
      await resize(width)
      for (const page of PAGES) {
        await goPage(page)
        await collapseAll()
        await win.waitForTimeout(250)
        const cover = await coveredControls(win)
        check(`${BOARD.uncovered} ${width} ${page}：内容区可点控件被压住 = 0（共 ${cover.total} 个）`, cover.covered.length === 0, cover.covered.slice(0, 5).join('；'))
        if (width === 1100) await shot(win, `uncovered-${page}-1100`)
      }
    }

    // ── 入口在顶栏最右；静止 / 悬停 / 焦点和「设置」一致（D1、D2、D4、topbar.bar、right-cluster） ──
    await resize(1440)
    await goPage('generation')
    await collapseAll()
    await setAgent({})
    {
      const bar = await measureBar(win)
      check(`${BOARD.entry} 入口在顶栏里、只有一个`, bar.entryInHeader && bar.entryCount === 1 && !bar.entryOutsideHeader, `顶栏里 ${bar.entryInHeader} / 共 ${bar.entryCount}`)
      const rightGap = bar.entry && bar.header ? bar.header.right - bar.entry.rect.right : null
      check(`${BOARD.bar} 顶栏高 40、入口 28×28、入口右沿离顶栏右沿 8px`, bar.header?.height === 40 && bar.entry?.rect.width === 28 && bar.entry?.rect.height === 28 && rightGap !== null && Math.abs(rightGap - 8) <= 0.5, `高 ${bar.header?.height} / 入口 ${bar.entry?.rect.width}×${bar.entry?.rect.height} / 右留 ${rightGap}`)
      check(`${BOARD.right} 右簇顺序：…设置之后是入口（入口在最右）`, bar.order.at(-1) === 'entry' && bar.order.at(-2) === 'settings', bar.order.join(' > '))
      check(`${BOARD.entry} D1 静止底色 = 「设置」钮底色`, Boolean(bar.entry) && bar.entry.bg === bar.settings?.bg, `${bar.entry?.bg} vs ${bar.settings?.bg}`)
      const hoverBg = async (selector) => {
        const target = win.locator(selector).first()
        if (!(await target.isVisible().catch(() => false))) return null
        await target.hover()
        await win.waitForTimeout(250)
        const bg = await target.evaluate((el) => getComputedStyle(el).backgroundColor)
        await win.mouse.move(5, HEIGHT - 5)
        await win.waitForTimeout(250)
        return bg
      }
      const settingsHover = await hoverBg('[data-shell-settings]')
      const entryHover = await hoverBg(ENTRY)
      check(`${BOARD.entry} D2 悬停底色 = 「设置」钮悬停底色`, entryHover !== null && entryHover === settingsHover, `${entryHover} vs ${settingsHover}`)
      unverified.push('D2 浅色下悬停底色和顶栏底色看不看得出（画布便签 651，全顶栏同样）')
      const focusRing = (selector) => win.locator(selector).first().evaluate((el) => {
        el.focus({ focusVisible: true })
        const style = getComputedStyle(el)
        const ring = { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, visible: el.matches(':focus-visible') }
        el.blur()
        return ring
      }).catch(() => null)
      const settingsRing = await focusRing('[data-shell-settings]')
      const entryRing = await focusRing(ENTRY)
      check(`${BOARD.entry} D4 键盘焦点：2px 描边，颜色 = 「设置」钮`, Boolean(entryRing?.visible) && entryRing.width === '2px' && entryRing.style === settingsRing?.style && entryRing.color === settingsRing?.color, `${JSON.stringify(entryRing)} vs ${JSON.stringify(settingsRing)}`)
      await shot(win, 'bar-1440-idle', true)
    }

    // ── 五种脸 + 点（A1–A5）、角标 / 胶囊（B1–B6）、提示（D5、G1） ──
    const lead = t('appShell.agent.entryOpen', { shortcut: '⌘J' })
    const status = (key, values) => t(`agentPanelV4.${key}`, values)
    const faceCases = [
      { id: 'A1', name: 'idle', set: {}, status: 'idle', dot: null, tip: [lead, status('dockIdle')] },
      { id: 'A2', name: 'unread', set: { unread: 3 }, status: 'unread', dot: 'unread', tip: [lead, status('dockIdle'), t('appShell.agent.entryUnread', { count: 3 })] },
      { id: 'A3', name: 'running', set: { face: 'running' }, status: 'running', dot: null, tip: [lead, status('dockRunning')] },
      { id: 'A4', name: 'done', set: { face: 'done' }, status: 'done', dot: null, tip: [lead, status('dockDone')] },
      { id: 'A5', name: 'failed', set: { face: 'failed' }, status: 'failed', dot: 'failed', tip: [lead, status('dockFailed')] },
    ]
    await resize(1440)
    for (const item of faceCases) {
      await setAgent(item.set)
      const bar = await measureBar(win)
      const element = item.dot ? BOARD.dot : BOARD.face
      check(`${element} ${item.id} ${item.name}：data-status=${item.status}，${item.dot ? `点 ${item.dot}` : '无点'}、无角标`, bar.entry?.status === item.status && bar.entry?.dot === item.dot && bar.entry?.badge === null && bar.entry?.shape === 'face', JSON.stringify(bar.entry && { status: bar.entry.status, dot: bar.entry.dot, badge: bar.entry.badge, shape: bar.entry.shape }))
      if (item.dot && bar.entry?.dotRect) {
        const inside = bar.entry.dotRect.right <= bar.entry.rect.right + 0.5 && bar.entry.dotRect.top >= bar.entry.rect.top - 0.5
        check(`${BOARD.dot} ${item.id} 点在按钮内`, inside, JSON.stringify(bar.entry.dotRect))
      }
      if (item.name === 'running') check(`${BOARD.face} A3 在做时弧在转`, Boolean(bar.entry?.faceSpinning))
      await shot(win, `face-${item.name}`, true)
      // 空闲脸另拍一张悬停着的（D2 悬停底色的并排图用），提示出在顶栏下面、不进这张顶栏图。
      const tip = await hoverTooltip({ stay: item.name === 'idle' })
      check(`${BOARD.tooltip} ${item.id} 悬停提示 = 「${item.tip.join(' · ')}」`, tip?.text === item.tip.join(' · '), tip?.text ?? '没出提示')
      if (item.name === 'idle') {
        await shot(win, 'face-idle-hover', true)
        await leaveEntry()
      }
      await clickEntryOpens(`${item.id} ${item.name} 脸`)
    }
    {
      await win.emulateMedia({ reducedMotion: 'reduce' })
      await setAgent({ face: 'running' })
      const bar = await measureBar(win)
      check(`${BOARD.face} A3 减弱动效下弧不转`, bar.entry?.status === 'running' && !bar.entry.faceSpinning)
      await win.emulateMedia({ reducedMotion: 'no-preference' })
    }
    // 角标在窄窗（<900 不出胶囊）：1 / 9 / 12 / 120。
    await resize(700)
    for (const count of [1, 9, 12, 120]) {
      await setAgent({ pending: count })
      const bar = await measureBar(win)
      const text = count > 9 ? '9+' : String(count)
      check(`${BOARD.badge} 700 等你确认 ${count}：角标 ${text}、data-pending=${count}、data-shape=face`, bar.entry?.badge === text && bar.entry?.pending === String(count) && bar.entry?.shape === 'face', JSON.stringify(bar.entry && { badge: bar.entry.badge, pending: bar.entry.pending, shape: bar.entry.shape }))
      if (bar.entry?.badgeRect) check(`${BOARD.badge} 700 等你确认 ${count}：角标右沿不超出按钮右沿、上沿比按钮高 4`, bar.entry.badgeRect.right <= bar.entry.rect.right + 0.5 && Math.abs(bar.entry.badgeRect.top - (bar.entry.rect.top - 4)) <= 0.5, `${JSON.stringify(bar.entry.badgeRect)} / 按钮 ${JSON.stringify(bar.entry.rect)}`)
      const tip = await hoverTooltip()
      const expected = [lead, status('dockNeedsConfirm', { count })].join(' · ')
      check(`${BOARD.tooltip} 700 等你确认 ${count}：提示写全数「${expected}」`, tip?.text === expected, tip?.text ?? '没出提示')
      await shot(win, `badge-${count}-700`, true)
      await clickEntryOpens(`700 等你确认 ${count} 角标`)
    }
    {
      await setAgent({ face: 'running', pending: 2 })
      const bar = await measureBar(win)
      check(`${BOARD.face} B5 在做 + 等确认 2：脸 running、角标 2`, bar.entry?.status === 'running' && bar.entry?.badge === '2' && Boolean(bar.entry?.faceSpinning), JSON.stringify(bar.entry && { status: bar.entry.status, badge: bar.entry.badge, spin: bar.entry.faceSpinning }))
      const tip = await hoverTooltip()
      const expected = [lead, status('dockNeedsConfirm', { count: 2 })].join(' · ')
      check(`${BOARD.tooltip} B5 提示中段用合并状态「${expected}」`, tip?.text === expected, tip?.text ?? '没出提示')
      await shot(win, 'running-pending-2-700', true)
      await setAgent({ face: 'failed', pending: 1 })
      const failed = await measureBar(win)
      check(`${BOARD.dot} B6 没成 + 等确认 1：角标 1、没有点`, failed.entry?.badge === '1' && failed.entry?.dot === null && failed.entry?.status === 'failed', JSON.stringify(failed.entry && { status: failed.entry.status, badge: failed.entry.badge, dot: failed.entry.dot }))
      await shot(win, 'failed-pending-1-700', true)
      // 未读 + 等确认：只报等确认，提示不再加「N 条新消息」。
      await setAgent({ pending: 2, unread: 5 })
      const tipPending = await hoverTooltip()
      check(`${BOARD.tooltip} 有待确认时不加新消息那一段`, tipPending?.text === [lead, status('dockNeedsConfirm', { count: 2 })].join(' · '), tipPending?.text ?? '没出提示')
      // C2：899 也是角标。
      await resize(899)
      await setAgent({ pending: 2 })
      const at899 = await measureBar(win)
      check(`${BOARD.badge} C2 899 等你确认 2：data-shape=face、角标 2`, at899.entry?.shape === 'face' && at899.entry?.badge === '2', JSON.stringify(at899.entry && { shape: at899.entry.shape, badge: at899.entry.badge }))
    }
    // 胶囊：≥900 放得下、面板没开（C1、B4）。
    for (const width of [900, 1100, 1440]) {
      await resize(width)
      for (const count of [2, 120]) {
        await setAgent({ pending: count })
        const bar = await measureBar(win)
        const text = t('appShell.agent.entryPending', { count })
        const want = CAPSULE_WIDTH[locale][count]
        check(`${BOARD.capsule} ${width} 等你确认 ${count}：data-shape=capsule、写「${text}」、不截断、宽 ${want}±2`, bar.entry?.shape === 'capsule' && bar.entry?.capsuleText === text && bar.entry?.capsuleClipped === false && Math.abs((bar.entry?.rect.width ?? 0) - want) <= 2 && bar.entry?.badge === null, JSON.stringify(bar.entry && { shape: bar.entry.shape, text: bar.entry.capsuleText, width: bar.entry.rect.width, badge: bar.entry.badge }))
        const rightGap = bar.entry && bar.header ? bar.header.right - bar.entry.rect.right : null
        check(`${BOARD.bar} ${width} 胶囊右沿离顶栏右沿 8px`, rightGap !== null && Math.abs(rightGap - 8) <= 0.5, `右留 ${rightGap}`)
        if (width === 900) {
          const tip = await hoverTooltip()
          const expected = [text, status('dockNeedsConfirm', { count })].join(' · ')
          check(`${BOARD.tooltip} 900 胶囊悬停「${expected}」`, tip?.text === expected, tip?.text ?? '没出提示')
          await shot(win, `capsule-${count}-900`, true)
        }
        await clickEntryOpens(`${width} 胶囊 ${count}`)
      }
    }
    // 最长提示（D5）：新消息 120，一行不折。
    {
      await resize(1440)
      await setAgent({ unread: 120 })
      const tip = await hoverTooltip({ stay: true })
      const expected = [lead, status('dockIdle'), t('appShell.agent.entryUnread', { count: 120 })].join(' · ')
      check(`${BOARD.tooltip} D5 最长提示「${expected}」一行不截断`, tip?.text === expected && tip.lines === 1 && tip.height <= 23 && !tip.clipped, JSON.stringify(tip))
      if (locale === 'en') {
        const label = await win.locator(`[data-shell-topbar] ${ENTRY}`).first().getAttribute('aria-label').catch(() => null)
        check(`${BOARD.tooltip} G1 / D5 英文轨：入口提示和名字里没有中文字`, Boolean(tip?.text) && Boolean(label) && englishOnly(tip?.text) && englishOnly(label), `${tip?.text ?? '没出提示'} | ${label}`)
      }
      // 悬停着整窗拍：提示浮在顶栏下面。
      await shot(win, 'tooltip-longest')
      await leaveEntry()
      unverified.push('D5 / G1 Windows「Ctrl+J」：这台是 Mac，真窗口量不到；快捷键前缀按平台写由 nomiEntryLook.test.ts 覆盖')
    }

    // ── 面板开着（D3、C4、C5）+ 形态切换（K1） ──
    {
      await resize(1440)
      await goPage('creation')
      await placeOn('storyboard', 'dock')
      await placeOn('creation', 'dock')
      await win.waitForTimeout(300)
      await setAgent({ pending: 2 })
      const bar = await measureBar(win)
      check(`${BOARD.badge} C4 1440 面板停靠开着 + 等你确认 2：data-shape=face、aria-pressed=true、角标 2`, bar.entry?.shape === 'face' && bar.entry?.pressed === 'true' && bar.entry?.badge === '2', JSON.stringify(bar.entry && { shape: bar.entry.shape, pressed: bar.entry.pressed, badge: bar.entry.badge }))
      const pressedBg = await win.evaluate(() => {
        const probe = document.createElement('div')
        probe.className = 'bg-nomi-ink-10'
        document.querySelector('[data-shell-topbar]')?.appendChild(probe)
        const bg = getComputedStyle(probe).backgroundColor
        probe.remove()
        return bg
      })
      check(`${BOARD.entry} D3 面板开着：按下底色 = 任务钮开着时的底色（ink-10）`, bar.entry?.bg === pressedBg, `${bar.entry?.bg} vs ${pressedBg}`)
      const collapseLead = t('appShell.agent.withShortcut', { label: t('agentPanelV4.collapsePanel'), shortcut: '⌘\\' })
      const tip = await hoverTooltip()
      check(`${BOARD.entry} D3 / C4 提示以「${collapseLead} · ${status('dockNeedsConfirm', { count: 2 })}」开头`, Boolean(tip?.text?.startsWith(`${collapseLead} · ${status('dockNeedsConfirm', { count: 2 })}`)), tip?.text ?? '没出提示')
      await shot(win, 'open-pending-2-1440', true)
      await shot(win, 'open-pending-2-1440-full')
      // K1：面板头只有 收起 / 浮窗 / 停靠。
      const forms = await win.locator(`${AGENT_PANEL} [data-agent-form-to]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-agent-form-to')))
      check(`${BOARD.formSwitch} K1 形态切换只有 collapse / float / dock`, forms.join(',') === 'collapse,float,dock', forms.join(','))
      const collapseTitle = await win.locator(`${AGENT_PANEL} [data-agent-form-to="collapse"]`).first().getAttribute('title').catch(() => null)
      check(`${BOARD.formSwitch} K1「收起」悬停写「${t('appShell.agent.withShortcut', { label: t('appShell.agent.toCollapse'), shortcut: '⌘\\' })}」`, collapseTitle === t('appShell.agent.withShortcut', { label: t('appShell.agent.toCollapse'), shortcut: '⌘\\' }), String(collapseTitle))
      if (locale === 'en') check(`${BOARD.formSwitch} K1 英文轨：「收起」悬停里没有中文字`, Boolean(collapseTitle) && englishOnly(collapseTitle), String(collapseTitle))
      const collapse = win.locator(`${AGENT_PANEL} [data-agent-form-to="collapse"]`).first()
      if (await collapse.isVisible().catch(() => false)) {
        await collapse.click()
        await win.waitForTimeout(300)
        const after = await measureBar(win)
        const collapsed = await win.locator(COLLAPSED_SHELL).count()
        check(`${BOARD.formSwitch} K1 点「收起」：面板收起，入口回到顶栏、不再按下`, collapsed > 0 && after.entry?.pressed === 'false' && after.entryCount === 1, `收起壳 ${collapsed} / 入口按下 ${after.entry?.pressed} / 入口 ${after.entryCount}`)
      } else {
        check(`${BOARD.formSwitch} K1 面板头找得到「收起」`, false)
      }
      // D3：点入口开、再点入口收。
      const entry = win.locator(ENTRY).first()
      if (await entry.isVisible().catch(() => false)) {
        await entry.click()
        await win.waitForTimeout(300)
        const opened = await win.locator(AGENT_PANEL).first().isVisible().catch(() => false)
        check(`${BOARD.entry} D3 点入口：面板打开、回到停靠`, opened && (await win.locator('[data-shell-agent-layer][data-agent-form="dock"]').count()) > 0)
        await entry.click()
        await win.waitForTimeout(300)
        check(`${BOARD.entry} D3 再点入口：面板收起`, (await win.locator(COLLAPSED_SHELL).count()) > 0 && !(await win.locator(AGENT_PANEL).first().isVisible().catch(() => false)))
      } else {
        check(`${BOARD.entry} D3 点入口开 / 收`, false, '顶栏没有入口')
      }
      // C5：700 浮窗开着 + 等你确认 2。
      await resize(700)
      await goPage('generation')
      await placeOn('generation', 'float')
      await win.waitForTimeout(300)
      await setAgent({ pending: 2 })
      const narrow = await measureBar(win)
      check(`${BOARD.badge} C5 700 浮窗开着 + 等你确认 2：data-shape=face、aria-pressed=true、角标 2`, narrow.entry?.shape === 'face' && narrow.entry?.pressed === 'true' && narrow.entry?.badge === '2', JSON.stringify(narrow.entry && { shape: narrow.entry.shape, pressed: narrow.entry.pressed, badge: narrow.entry.badge }))
      await shot(win, 'open-float-pending-2-700', true)
      await collapseAll()
      await win.waitForTimeout(200)
    }

    // ── 让位（E1–E12、F1–F3、topbar.*） ──
    await goPage('preview')
    await collapseAll()
    await setTasks(3)
    // 分段进度照拍板图摆成「生成 38/120」：夹具只有 3 个节点（「0/3」窄 15px 左右），中文 900 装失败那一格画布上是「差 3px 走到第 ③ 步」，
    // 拿「0/3」量会停在第 ② 步，对不上图。只在让位这一段加 117 个节点，量完放回原来 3 个（E11 起回到生成页）。
    const seededNodes = await win.evaluate(({ total, done }) => {
      const store = window.__nomiCanvasStore
      if (!store) return null
      const original = store.getState().nodes
      const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      const extra = Array.from({ length: total - original.length }, (_, index) => ({
        id: `entry-seed-${index}`, kind: 'image', title: `seed ${index}`, prompt: '', categoryId: 'shots', references: [], runs: [],
        status: index < done ? 'success' : 'idle', ...(index < done ? { result: { url: pixel } } : {}),
        position: { x: 120 + (index % 10) * 360, y: 600 + Math.floor(index / 10) * 240 }, size: { width: 320, height: 180 },
      }))
      store.setState({ nodes: [...original, ...extra] })
      return original.length
    }, { total: 120, done: 38 })
    if (seededNodes == null) note('画布 store 没挂出来（__nomiCanvasStore），分段进度照夹具「0/3」量，中文 900 装失败那一格会停在第 ② 步')
    await sendUpdate([UPDATE_AVAILABLE])
    await win.waitForTimeout(400)
    const crowded = async (width, key, pending) => {
      await resize(width)
      await setAgent({ pending })
      await win.waitForTimeout(250)
      const bar = await measureBar(win)
      const g = gaps(bar)
      const want = CROWDED_STEPS[locale][key]
      check(`${BOARD.yield} ${key} 最挤（新版本 + 3 个任务 + 等你确认 ${pending} + 进度数字）：走到第 ${want} 步`, bar.step === String(want), `data-shell-yield-step=${bar.step}`)
      check(`${BOARD.segment} ${key} 分段离左簇 ≥12、离右簇 ≥12`, g.left !== null && g.left >= GAP - 0.5 && g.right !== null && g.right >= GAP - 0.5, `离左 ${g.left?.toFixed(1)} / 离右 ${g.right?.toFixed(1)} / 左移 ${g.shift?.toFixed(1)}`)
      check(`${BOARD.export} ${key}：第 ① 步导出收成图标`, bar.exportCompact === (want >= 1), `compact ${bar.exportCompact}`)
      check(`${BOARD.left} ${key}：项目名放不下两个字就藏（左簇内容宽 ${bar.leftContent?.toFixed(1)}）`, bar.nameShown === ((bar.leftContent ?? 0) > 89), `名字 ${bar.nameShown ? '露' : '藏'}`)
      check(`${BOARD.meta} ${key}：${want >= 3 ? '第 ③ 步藏起进度数字，悬停分段照样带数字' : '进度数字还在'}`, want >= 3 ? bar.metaShown === 0 && bar.metaTotal >= 0 && bar.stepTitles.length >= 2 : bar.metaShown >= 2, `露 ${bar.metaShown} / 悬停 ${bar.stepTitles.join(' | ')}`)
      check(`${BOARD.update} ${key}：${width < 900 || want >= 4 ? '「新版本」只留点，悬停出全句' : '「新版本」带字'}`, Boolean(bar.update) && bar.update.labelShown === !(width < 900 || want >= 4) && Boolean(bar.update.title), JSON.stringify(bar.update))
      check(`${BOARD.right} ${key}：入口还在最右、右留 8`, bar.order.at(-1) === 'entry' && bar.entry && Math.abs(bar.header.right - bar.entry.rect.right - 8) <= 0.5, bar.order.join(' > '))
      check(`${BOARD.capsule} ${key}：${width >= 900 ? '≥900 胶囊照样带字（C3，胶囊不在让位顺序里）' : '<900 是角标'}`, width >= 900 ? bar.entry?.shape === 'capsule' : bar.entry?.shape === 'face' && bar.entry?.badge === '9+', JSON.stringify(bar.entry && { shape: bar.entry.shape, badge: bar.entry.badge, width: bar.entry.rect.width }))
      await shot(win, `crowded-${key}`, true)
      return bar
    }
    await crowded(700, 700, 12)
    await crowded(900, 900, 120)
    await sendUpdate([UPDATE_AVAILABLE, { type: 'error', message: '', stage: 'install', reason: 'other' }])
    await win.waitForTimeout(300)
    const failedBar = await crowded(900, '900-installFailed', 120)
    {
      const overlap = failedBar.update?.rect && failedBar.segment ? Math.max(0, failedBar.segRight - failedBar.toolbar.left) : null
      check(`${BOARD.update} F3 900 装失败：右簇压上分段 = 0px（今天 88）`, overlap === 0, `压上 ${overlap}`)
      check(`${BOARD.update} F3 900 装失败：data-update-badge=error`, failedBar.update?.phase === 'error', JSON.stringify(failedBar.update))
      if (locale === 'zh-CN') check(`${BOARD.update} F3 900 中文「上次没装上 · 点一下重试」带字 184±4px`, Boolean(failedBar.update?.labelShown) && Math.abs((failedBar.update?.rect.width ?? 0) - 184) <= 4, `宽 ${failedBar.update?.rect.width}`)
    }
    // F2：下载中（只补截图，同 F1 宽度规则）。
    await sendUpdate([UPDATE_AVAILABLE, { type: 'progress', percent: 100 }])
    await win.waitForTimeout(300)
    for (const width of [700, 1440]) {
      await resize(width)
      const bar = await measureBar(win)
      check(`${BOARD.update} F2 ${width} 下载中：${width < 900 ? '只留点' : '带字'}`, Boolean(bar.update) && bar.update.labelShown === (width >= 900), JSON.stringify(bar.update))
      await shot(win, `update-downloading-${width}`, true)
    }
    await sendUpdate([UPDATE_AVAILABLE])
    await win.waitForTimeout(300)
    // F1：1440 带字。
    {
      await resize(1440)
      const bar = await measureBar(win)
      check(`${BOARD.update} F1 1440 有新版本带字`, Boolean(bar.update?.labelShown), JSON.stringify(bar.update))
      await shot(win, 'crowded-1440', true)
    }
    // E12：1440 → 700 → 1440 每 4px 一步，同一宽度两个方向一样，每个阈值只翻一次。
    // 900 是另一条已有的线（≥900「新版本」带字、等你确认是胶囊；窄于 900 只留点、出角标）：过这条线右簇一下窄 / 宽一大截，
    // 步数跟着回落是内容变了，不是抖。所以按 900 两边各算：每边里窗口越窄步数只增不减，每个阈值只翻一次。
    {
      await setAgent({ pending: 12 })
      const down = new Map()
      const up = new Map()
      for (let width = 1440; width >= 700; width -= 4) {
        await resize(width)
        down.set(width, (await measureBar(win)).step)
      }
      for (let width = 700; width <= 1440; width += 4) {
        await resize(width)
        up.set(width, (await measureBar(win)).step)
      }
      const sideStats = (map) => [[900, Infinity], [0, 900]].map(([lo, hi]) => {
        const ordered = [...map].filter(([width]) => width >= lo && width < hi).sort((a, b) => b[0] - a[0])
        let flips = 0
        let monotonic = true
        for (let index = 1; index < ordered.length; index += 1) {
          if (ordered[index][1] !== ordered[index - 1][1]) flips += 1
          if (Number(ordered[index][1]) < Number(ordered[index - 1][1])) monotonic = false
        }
        return { flips, distinct: new Set(ordered.map(([, step]) => step)).size, monotonic }
      })
      const transitions = (map) => [...map].sort((a, b) => b[0] - a[0]).filter(([, step], index, all) => index === 0 || all[index - 1][1] !== step).map(([width, step]) => `${width}:${step}`).join(' ')
      const mismatched = [...down.keys()].filter((width) => down.get(width) !== up.get(width))
      const sides = [...sideStats(down), ...sideStats(up)]
      check(`${BOARD.yield} E12 来回拖窗：同一宽度两个方向结果一致`, mismatched.length === 0 && down.get(700) != null, `不一致 ${mismatched.slice(0, 6).join(',')}`)
      check(`${BOARD.yield} E12 来回拖窗：900 两边各自窗口越窄步数只增不减、每个阈值只翻一次`, sides.every((side) => side.monotonic && side.flips === side.distinct - 1) && new Set(down.values()).size > 1, `往窄拖 ${transitions(down)} / 往宽拖 ${transitions(up)}`)
    }
    if (seededNodes != null) await win.evaluate((keep) => {
      const store = window.__nomiCanvasStore
      store?.setState({ nodes: store.getState().nodes.slice(0, keep) })
    }, seededNodes)
    // E11：宽窗不让（没有新版本 / 任务 / 待确认）。「新版本」要真收掉：前面一直挂着「有新版本」，英文 1100 预览页带着
    // 「Update 0.99」放不下导出全字（差 18px 左右），会走到第 ① 步——那是另一种局面，不是 E11 量的「宽窗不让」。
    await setTasks(0)
    await setAgent({})
    await sendUpdate([{ type: 'up-to-date' }])
    await win.waitForTimeout(300)
    for (const page of ['preview', 'generation']) {
      await goPage(page)
      await collapseAll()
      for (const width of [1100, 1440]) {
        await resize(width)
        await win.waitForTimeout(150)
        const bar = await measureBar(win)
        const g = gaps(bar)
        check(`${BOARD.yield} E11 ${page} ${width}：没有「新版本」时 data-shell-yield-step=0，分段整窗居中（差 ≤1px）`, !bar.update && bar.step === '0' && g.shift !== null && Math.abs(g.shift) <= 1, `新版本 ${bar.update ? '还在' : '没有'} / step ${bar.step} / 差 ${g.shift?.toFixed(1)}`)
        if (page === 'generation') {
          check(`${BOARD.switcher} ${width} 生成页「画布 / 列表」跟在分段右边、离右簇 ≥12`, Boolean(bar.switcher) && bar.switcher.left >= (bar.segment?.right ?? 0) && g.right >= GAP - 0.5, `${JSON.stringify(bar.switcher)} / 离右 ${g.right}`)
        }
        await shot(win, `wide-${page}-${width}`, true)
        if (page === 'generation' && width === 1440) {
          // 清单外：「画布 / 列表」钮改引顶栏图标钮那一个家，描边 1.5 → 1.8。静止一张、悬停一张。
          await win.mouse.move(5, HEIGHT - 5)
          await win.waitForTimeout(150)
          await shotAround(win, 'view-switcher-rest', '[data-generation-view-switcher]', 20)
          await win.locator('[data-generation-view-switcher]').first().hover().catch(() => undefined)
          await win.waitForTimeout(250)
          await shotAround(win, 'view-switcher-hover', '[data-generation-view-switcher]', 20)
          await win.mouse.move(5, HEIGHT - 5)
        }
      }
    }
    // 生成页 700 最挤：「画布 / 列表」跟着分段一起让。
    {
      await goPage('generation')
      await collapseAll()
      await setTasks(3)
      await sendUpdate([UPDATE_AVAILABLE])
      await setAgent({ pending: 12 })
      await resize(700)
      await win.waitForTimeout(300)
      const bar = await measureBar(win)
      const g = gaps(bar)
      check(`${BOARD.switcher} 700 生成页最挤：「画布 / 列表」紧跟分段、离右簇 ≥12`, Boolean(bar.switcher) && g.right !== null && g.right >= GAP - 0.5 && g.left >= GAP - 0.5, `离左 ${g.left?.toFixed(1)} / 离右 ${g.right?.toFixed(1)} / step ${bar.step}`)
      await shot(win, 'crowded-generation-700', true)
      await shot(win, 'crowded-generation-700-full')
      await setTasks(0)
    }
    // 名字截短（已知偏离：生产沿用「左簇 ≤89 才藏」，700 宽名字截短露出）：两种语言各一张真截图。
    {
      await goPage('preview')
      await setAgent({})
      await resize(700)
      await win.waitForTimeout(200)
      const bar = await measureBar(win)
      note(`700 预览页默认：项目名${bar.nameShown ? '截短露出' : '藏起'}（左簇内容宽 ${bar.leftContent?.toFixed(1)}）`)
      await shot(win, 'name-700', true)
    }
    // ── H1：项目库顶栏没有入口。同一个探针先在工作台顶栏量到 1 个（证明量得到），再回项目库，持续量到 0。 ──
    {
      await resize(1440)
      const entryInBar = win.locator(`[data-shell-topbar] ${ENTRY}`)
      const proof = await proveProbe(entryInBar, '工作台顶栏最右有 Nomi 入口')
      await backToLibrary(win, { timeout: stationTimeout() })
      await win.locator('[data-project-card]').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
      for (const width of [1440, 700]) {
        await resize(width)
        const absent = await expectAbsent(entryInBar, { provenBy: proof, message: `项目库 ${width}：顶栏没有 Nomi 入口` }, 3000).then(() => '', (error) => String(error?.message ?? error).split('\n')[0])
        check(`${BOARD.library} 项目库 ${width}：顶栏没有入口`, absent === '', absent)
      }
    }
  } catch (error) {
    failures.push(`${tag} 中途出错：${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ')}`)
    console.log(`  ❌ ${tag} 中途出错：${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await app?.close().catch(() => undefined)
  }
}

for (const round of rounds) await runRound(round)
console.log(`\n截图：${shotsDir}`)
if (unverified.length) console.log(`未验证：\n${[...new Set(unverified)].map((line) => `  - ${line}`).join('\n')}`)
if (failures.length) {
  console.log(`\n❌ ${failures.length} 条没过：`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\n✅ nomi-entry-topbar 全过')
}
