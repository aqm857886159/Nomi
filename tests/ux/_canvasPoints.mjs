// 画布几何取点 · 走查/脚本共用
//
// 三件事以前散在六七个文件里各抄一份，每份都在同一个坑上：
//   ① 找「画布空白点」只在扫描那一刻 elementFromPoint 一次，然后信它——但真实鼠标一到，
//      节点侧边的磁性连接句柄（那个蓝色「+」，hit-area 挂在 React Flow 节点壳上、伸到卡片外面）
//      就在光标下面，点击被它吃掉。stage 变窄（常驻 Agent 面板占掉右侧）后行列扫描落点一变，
//      「点空白取消选中」这一步就随机翻红（2026-09-05 #488 CI + 本机 2/2 复现）。
//   ② 框选手势的起/终点只要求在 stage 内 8px——而 React Flow 的 Pane 在框选时离容器边 40px 内
//      会持续 autoPan（@xyflow/system `calcAutoPan(pos, bounds, speed, distance = 40)`），
//      鼠标按着不动、画布却一直在走，`screenshotSettled` 永远等不到安定。
//   ③ 点连线命中层时让 Playwright 点 path 的包围盒中心——弯曲的贝塞尔中心多半压在节点卡上，
//      「subtree intercepts pointer events」超时。
//
// 原则：**取点之后必须在真实光标/真实几何下再验一次**，不信早先那一次采样
// （docs/lessons/dead-selector-lies-both-ways.md · expect-absent-passes-too-early.md）。

/** React Flow Pane 框选自动平移的触发带宽（px，离容器边）。出处：@xyflow/system calcAutoPan 默认 distance。 */
export const REACT_FLOW_AUTO_PAN_EDGE_PX = 40

/** 框选起/终点离 stage 边至少这么远：越过 autoPan 带，再留 8px 让 elementFromPoint 落在 stage 内。 */
export const MARQUEE_STAGE_MARGIN_PX = REACT_FLOW_AUTO_PAN_EDGE_PX + 8

/**
 * 不算「空白」的东西：节点（含 React Flow 节点壳——磁性句柄 hit-area 挂在壳上、卡片外面）、
 * 各种浮层与控件、连线命中层、小地图、导航栈、多选包围层。
 * 各文件以前各留一份略有出入的清单，这里取并集：漏掉任何一项都是「点中错的东西也算过」。
 */
export const CANVAS_BLANK_EXCLUSIONS = [
  '.react-flow__node',
  '.generation-canvas-v2-node',
  '.generation-canvas-v2-node__composer',
  '.generation-canvas-v2-node__magnetic-handle',
  '.generation-canvas-v2-toolbar',
  '.generation-canvas-v2__zoom-bar',
  '.generation-canvas-v2__selection-bounds',
  '.generation-canvas-v2__selection-toolbar',
  '.react-flow__nodesselection',
  '.generation-canvas-v2__edge-hit',
  '.generation-canvas-v2__edge-path',
  '.generation-canvas-v2__minimap',
  '.generation-canvas-v2__navigation-stack',
  'button',
  'input',
  'textarea',
  '[role="menu"]',
  '[role="toolbar"]',
].join(', ')

/** 默认扫描顺序：先右上（远离左侧工具栏与底部 composer），再往左往下。 */
export const DEFAULT_BLANK_ROWS = Object.freeze([0.2, 0.28, 0.36, 0.5, 0.64, 0.76, 0.88, 0.12])
export const DEFAULT_BLANK_COLUMNS = Object.freeze([0.62, 0.7, 0.78, 0.86, 0.93, 0.54, 0.42, 0.3, 0.2, 0.12, 0.06])
/** 从底往上扫（给「底部空白」类手势用）。 */
export const BOTTOM_FIRST_BLANK_ROWS = Object.freeze([0.88, 0.78, 0.68, 0.58, 0.48, 0.38, 0.28, 0.18, 0.1])

const STAGE_SELECTOR = '.generation-canvas-v2__stage'

/** 光标到位后等这么久再复验：React 提交一次 hover 态 + 一帧。磁性句柄的 opacity 过渡 180ms 不影响命中，不用等它。 */
const HOVER_SETTLE_MS = 90

function isBlankAt(win, point, exclusions) {
  return win.evaluate(
    ({ x, y, excluded, stageSelector }) => {
      const stage = document.querySelector(stageSelector)
      if (!stage) return { blank: false, hit: 'no-stage' }
      const hit = document.elementFromPoint(x, y)
      if (!hit || !stage.contains(hit)) return { blank: false, hit: hit ? hit.className : 'null' }
      if (hit.closest(excluded)) return { blank: false, hit: `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}` }
      return { blank: true, hit: null }
    },
    { x: point.x, y: point.y, excluded: exclusions, stageSelector: STAGE_SELECTOR },
  )
}

/**
 * 找一块真·空白，并把真实鼠标移到那里复验。
 *
 * 返回 `{ x, y }`（视口坐标，已取整）；找不到返回 null——调用方自己决定是 throw 还是换策略，
 * 别在这里兜底成「随便给个点」。返回时鼠标已经停在该点上，接着 `mouse.click/down` 就是同一位置。
 *
 * @param {import('playwright').Page} win
 * @param {{ rows?: readonly number[], columns?: readonly number[], exclusions?: string }} [options]
 */
export async function findBlankCanvasPoint(win, options = {}) {
  const rows = options.rows ?? DEFAULT_BLANK_ROWS
  const columns = options.columns ?? DEFAULT_BLANK_COLUMNS
  const exclusions = options.exclusions ?? CANVAS_BLANK_EXCLUSIONS
  const candidates = await win.evaluate(
    ({ rows: ry, columns: rx, excluded, stageSelector }) => {
      const stage = document.querySelector(stageSelector)
      if (!stage) return []
      const rect = stage.getBoundingClientRect()
      const found = []
      for (const r of ry) {
        for (const c of rx) {
          const x = rect.left + rect.width * c
          const y = rect.top + rect.height * r
          const hit = document.elementFromPoint(x, y)
          if (!hit || !stage.contains(hit)) continue
          if (hit.closest(excluded)) continue
          found.push({ x: Math.round(x), y: Math.round(y) })
        }
      }
      return found
    },
    { rows: [...rows], columns: [...columns], excluded: exclusions, stageSelector: STAGE_SELECTOR },
  )
  for (const point of candidates) {
    await win.mouse.move(point.x, point.y)
    await win.waitForTimeout(HOVER_SETTLE_MS)
    const verdict = await isBlankAt(win, point, exclusions)
    if (verdict.blank) return point
    // 光标一到就冒出来的东西（磁性「+」、hover 浮层）：这个点不是空白，换下一个。
  }
  return null
}

/**
 * 点一条连线的命中层：沿 path 取样，只点 elementFromPoint 真能命中这条 path 的那一点。
 * Playwright 默认点包围盒中心，贝塞尔的中心多半悬在空中或压在节点上。
 *
 * @param {import('playwright').Page} win
 * @param {import('playwright').Locator} locator 指向 `.generation-canvas-v2__edge-hit` 之类的 path
 * @param {string} label 失败信息用，说人话
 */
export async function clickEdgeHitPath(win, locator, label) {
  if (!label || typeof label !== 'string') throw new Error('clickEdgeHitPath(win, locator, label)：label 必填')
  await locator.first().waitFor({ state: 'visible', timeout: 15_000 })
  const total = await locator.count()
  const pickTopmostPoint = (path) => {
    if (typeof path.getTotalLength !== 'function') return null
    const length = path.getTotalLength()
    const matrix = path.getScreenCTM()
    if (!matrix || !(length > 0)) return null
    for (let index = 1; index <= 19; index += 1) {
      const local = path.getPointAtLength((length * index) / 20)
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix)
      if (screen.x < 16 || screen.x > window.innerWidth - 16 || screen.y < 16 || screen.y > window.innerHeight - 16) continue
      if (document.elementFromPoint(screen.x, screen.y) === path) return { x: screen.x, y: screen.y }
    }
    return null
  }
  // 匹配到多条线时逐条试：第一条整条被压住，就点下一条（clip-node 五条输出线就是这种）。
  for (let index = 0; index < total; index += 1) {
    const target = locator.nth(index)
    const point = await target.evaluate(pickTopmostPoint)
    if (!point) continue
    await win.mouse.move(point.x, point.y)
    await win.waitForTimeout(HOVER_SETTLE_MS)
    const stillOnPath = await target.evaluate((path, at) => document.elementFromPoint(at.x, at.y) === path, point)
    if (!stillOnPath) continue // 鼠标到位后有 hover 浮层盖上来了：这一点不算，换下一条
    await win.mouse.click(point.x, point.y)
    return
  }
  throw new Error(
    `点不到「${label}」：${total} 条连线各取 19 个采样点，没有一个点在最上层——整条线都被节点卡或浮层压住了。\n`
      + '别加 force:true 硬点：那会点在压住它的东西上，动作没发生却报绿。先看几何为什么重叠。',
  )
}
