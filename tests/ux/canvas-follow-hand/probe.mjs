// 画布跟手量具 · 页面探针（在 React 加载前注入）。
//
// 记四样东西，全部是页面自己的时钟（performance.now），不依赖 Playwright 往返：
//   ① rAF 环：每帧时间戳 → 最长帧 / 按键到画面；
//   ② 捕获阶段的输入与媒体事件（keydown / pointermove / playing …）→ 输入排队、起播耗时；
//   ③ 选择器范围内的 DOM 变更时间 → 「这次输入第一次改到画面」；
//   ④ React DevTools 钩子：每次提交都计数（很便宜）；开了 countRenders 才遍历 fiber，
//      数出这次提交里**真正执行了 render** 的组件（swap-buffer + PerformedWork 判据），按区域归类。
// 区域：composer（提示词面板）/ mentionList（@ 候选）/ node:<id>（某张卡）/ edges / canvas-other / app-other / nohost（portal 等无宿主）。
export const PAGE_PROBE = String.raw`(() => {
  if (window.__cfhProbe) return
  const N = 60000
  const ft = new Float64Array(N)
  let fi = 0
  const loop = () => { ft[fi % N] = performance.now(); fi++; requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  const longtasks = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longtasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch (e) {}
  const events = []
  const desc = (t) => { if (!t || !t.tagName) return String(t && t.nodeName); const c = (typeof t.className === 'string' ? t.className : '').split(' ').slice(0, 2).join('.'); return t.tagName.toLowerCase() + (c ? '.' + c : '') }
  const nodeIdOf = (t) => { const n = t && t.closest ? t.closest('.react-flow__node') : null; return n ? n.getAttribute('data-id') : null }
  const INPUT = ['keydown','keyup','pointerdown','pointerup','pointermove','pointerover','click','dragstart','pointercancel','lostpointercapture','contextmenu','wheel']
  for (const type of INPUT) {
    window.addEventListener(type, (e) => {
      if (!probe.rec) return
      events.push({ type, t: e.timeStamp, now: performance.now(), key: e.key, x: e.clientX, y: e.clientY, buttons: e.buttons, target: desc(e.target), node: type === 'pointerover' || type === 'pointerdown' ? nodeIdOf(e.target) : undefined })
    }, { capture: true, passive: true })
  }
  // 媒体事件不冒泡，但捕获阶段照样经过 window。
  const media = []
  for (const type of ['play', 'playing', 'pause', 'loadeddata', 'emptied']) {
    window.addEventListener(type, (e) => { if (probe.rec) media.push({ type, t: performance.now(), node: nodeIdOf(e.target) }) }, true)
  }
  // 挂载中的 <video> 与在播数：每帧看一眼（活的 HTMLCollection，很便宜）。
  const videos = document.getElementsByTagName('video')
  const vstat = { maxMounted: 0, maxPlaying: 0 }
  const vloop = () => {
    if (probe.rec) {
      const n = videos.length
      if (n > vstat.maxMounted) vstat.maxMounted = n
      let p = 0
      for (let i = 0; i < n; i++) { const v = videos[i]; if (!v.paused && !v.ended) p++ }
      if (p > vstat.maxPlaying) vstat.maxPlaying = p
    }
    requestAnimationFrame(vloop)
  }
  requestAnimationFrame(vloop)
  const mutations = []
  const mo = new MutationObserver((records) => {
    if (!probe.watch) return
    const now = performance.now()
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement
      if (el && el.closest && el.closest(probe.watch)) { mutations.push(now); break }
    }
  })
  const startMo = () => mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'data-index', 'aria-valuenow', 'src'] })
  if (document.documentElement) startMo(); else document.addEventListener('DOMContentLoaded', startMo)

  const roots = new Set()
  let prev = new WeakSet()
  const commits = []
  const commitTimes = []
  const COMP = new Set([0, 1, 11, 14, 15])
  function hostOf(f) { let c = f; let guard = 0; while (c && guard++ < 60) { if (c.tag === 5) return c.stateNode; c = c.child } return null }
  function region(f) {
    const el = hostOf(f)
    if (!el || !el.closest) return 'nohost'
    if (el.closest('[data-mention-list]')) return 'mentionList'
    if (el.closest('[data-composer-host]')) return 'composer'
    const n = el.closest('.react-flow__node')
    if (n) return 'node:' + n.getAttribute('data-id')
    if (el.closest('.react-flow__edges, .react-flow__edge, .react-flow__edgelabel-renderer')) return 'edges'
    if (el.closest('.react-flow, .generation-canvas-v2__stage')) return 'canvas-other'
    return 'app-other'
  }
  function typeName(f) {
    const t = f.type
    return (t && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)))) || ('tag' + f.tag)
  }
  function walk(root, collect, next) {
    const stack = [root.current]
    while (stack.length) {
      const f = stack.pop()
      if (!f) continue
      next.add(f)
      if (collect && COMP.has(f.tag) && !prev.has(f) && (f.flags & 1)) collect.push(f)
      if (f.sibling) stack.push(f.sibling)
      if (f.child) stack.push(f.child)
    }
  }
  const types = []
  const typeIndex = new Map()
  const hook = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(id, root) {
      roots.add(root)
      if (probe.rec) commitTimes.push(performance.now())
      if (!probe.countRenders) return
      const t0 = performance.now()
      const rendered = []
      const next = new WeakSet()
      walk(root, rendered, next)
      for (const r of roots) if (r !== root) walk(r, null, next)
      prev = next
      const byRegion = {}
      const names = {}
      const otherNodes = new Set()
      // 重渲的「起点」：父组件这次没重渲、它自己却重渲了——就是状态 / props / context 变了的那个订阅者。
      const renderedSet = new Set(rendered)
      const rootNames = {}
      for (const f of rendered) {
        let p = f.return
        while (p && !COMP.has(p.tag)) p = p.return
        if (p && renderedSet.has(p)) continue
        const reg = region(f)
        const key = reg.startsWith('node:') ? (reg === 'node:' + probe.focusNode ? 'focusNode' : 'otherNodes') : reg
        const nm = typeName(f) + '@' + key
        rootNames[nm] = (rootNames[nm] || 0) + 1
      }
      for (const f of rendered) {
        const reg = region(f)
        let key = reg
        if (reg.startsWith('node:')) {
          if (reg === 'node:' + probe.focusNode) key = 'focusNode'
          else { key = 'otherNodes'; otherNodes.add(reg.slice(5)) }
        }
        byRegion[key] = (byRegion[key] || 0) + 1
        let ti = typeIndex.get(f.type)
        if (ti === undefined && f.type && typeof f.type !== 'string') { ti = types.length; types.push(f.type); typeIndex.set(f.type, ti) }
        const nm = typeName(f) + (ti === undefined ? '' : '#' + ti) + '@' + key
        names[nm] = (names[nm] || 0) + 1
      }
      commits.push({ at: t0, total: rendered.length, byRegion, otherNodeIds: [...otherNodes], cost: performance.now() - t0, names, rootNames })
    },
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook

  const probe = {
    rec: false, watch: null, countRenders: false, focusNode: null,
    events, media, longtasks, mutations, commits, commitTimes, vstat, types,
    frameTimes(t0, t1) { const out = []; const start = Math.max(0, fi - N); for (let i = start; i < fi; i++) { const t = ft[i % N]; if (t >= t0 && t <= t1) out.push(t) } return out },
    primeRenders() { const next = new WeakSet(); for (const r of roots) walk(r, null, next); prev = next; commits.length = 0; probe.countRenders = true },
    reset() { events.length = 0; media.length = 0; mutations.length = 0; commits.length = 0; commitTimes.length = 0; vstat.maxMounted = videos.length; vstat.maxPlaying = 0 },
    hookInstalled() { return this === window.__cfhProbe && hook.renderers.size > 0 },
  }
  window.__cfhProbe = probe
})()`

/** 开始记录：清空缓冲，可选 watch 选择器 / 渲染计数。返回页面时钟起点。 */
export function beginMeasure(win, { watch = null, renders = false, focusNode = null } = {}) {
  return win.evaluate(({ watch, renders, focusNode }) => {
    const p = window.__cfhProbe
    p.reset(); p.watch = watch; p.focusNode = focusNode; p.rec = true
    if (renders) p.primeRenders()
    return performance.now()
  }, { watch, renders, focusNode })
}

export async function endMeasure(win, t0, { settleMs = 500 } = {}) {
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  return win.evaluate(({ t0 }) => {
    const p = window.__cfhProbe
    const t1 = performance.now()
    p.rec = false; p.countRenders = false; p.watch = null
    return {
      t0, t1, timeOrigin: performance.timeOrigin,
      events: p.events.slice(),
      media: p.media.slice(),
      mutations: p.mutations.slice(),
      frames: p.frameTimes(t0 - 200, t1),
      longtasks: p.longtasks.filter(([st, d]) => st + d >= t0 && st <= t1).map(([st, d]) => [Math.round(st * 10) / 10, Math.round(d)]),
      commitTimes: p.commitTimes.slice(),
      commits: p.commits.map((c) => ({ at: c.at, total: c.total, byRegion: c.byRegion, otherNodeIds: c.otherNodeIds, names: c.names, rootNames: c.rootNames })),
      video: { ...p.vstat },
    }
  }, { t0 })
}

export const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10)
export function median(xs) { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
export function maxOf(xs) { const a = xs.filter((x) => Number.isFinite(x)); return a.length ? Math.max(...a) : null }
export function pct(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null }
export function firstAfter(arr, t) { for (const x of arr) if (x >= t) return x; return null }
/** [a, b] 区间内相邻两帧的最大间隔（区间两端各延伸一帧）。 */
export function maxGapIn(frames, a, b) { let max = 0; for (let i = 1; i < frames.length; i++) { if (frames[i] < a) continue; if (frames[i - 1] > b) break; max = Math.max(max, frames[i] - frames[i - 1]) } return r1(max) }

/** 每个按键：keydown → 被观察区首个变更 → 其后首帧。 */
export function perKeyLatency(m, keyFilter = () => true) {
  return m.events.filter((e) => e.type === 'keydown' && keyFilter(e)).map((e) => {
    const mu = firstAfter(m.mutations, e.t)
    const paint = mu != null ? firstAfter(m.frames, mu) : null
    return { key: e.key, queue: r1(e.now - e.t), toPaint: paint != null ? r1(paint - e.t) : null }
  })
}

/** 按区域汇总一段时间里的重渲；top 为组件名（含 #类型序号，便于回查源码位置）。 */
export function renderSummary(commits, { top = 15 } = {}) {
  const byRegion = {}; const names = {}; const roots = {}; let total = 0; const otherNodes = new Set()
  for (const c of commits) {
    total += c.total
    for (const id of c.otherNodeIds) otherNodes.add(id)
    for (const [k, v] of Object.entries(c.byRegion)) byRegion[k] = (byRegion[k] || 0) + v
    for (const [k, v] of Object.entries(c.names || {})) names[k] = (names[k] || 0) + v
    for (const [k, v] of Object.entries(c.rootNames || {})) roots[k] = (roots[k] || 0) + v
  }
  return {
    commits: commits.length,
    rendered: total,
    byRegion,
    otherNodesRerendered: otherNodes.size,
    top: Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, top),
    /** 重渲起点（父组件没重渲、它自己重渲了）：顺着它找是谁订阅了变化。 */
    roots: Object.entries(roots).sort((a, b) => b[1] - a[1]).slice(0, top),
  }
}
