// 监视器装进被测页面里的那只「眼睛」：只读 DOM、只记时间线，不碰任何 store、不改任何节点。
//
// 为什么放在页面里、而不是每一步结束时拍一张快照比：铁律 6（没人动的东西不许自己动）和铁律 5（转圈）
// 的违反往往**发生在两步之间**——Agent 回合跑着的时候分镜表自己弹出来、又被下一次点击盖掉；
// 一张收尾快照看不见它。页内观察者把每一次「面」的变化、每一次真实输入、每一个永动动画的起止都带上时刻记下来，
// 监视器再按步骤的时间窗去归因。
//
// 输入事件只认 `isTrusted`：Playwright 的鼠标键盘走 CDP，产生的就是可信事件（与真人同一类），
// 页面脚本自己 dispatch 的不算。

/** 「已保存到项目」回执（9b）的中英原文，从词典读——页内观察者不自己写界面原话。 */
/** 注入页面的函数本体（`win.evaluate(installProbe, options)`）。幂等：已经装过就只回报 already。 */
export function installProbe() {
  const VERSION = 7
  if (window.__nomiFullWalk?.version === VERSION) return 'already'
  const state = {
    version: VERSION, installedAt: Date.now(), inputs: [], surfaces: [], current: null,
    spinners: {}, versionPills: {}, toasts: {}, nextId: 1,
  }
  window.__nomiFullWalk = state

  const visible = (el) => {
    if (!el || !el.isConnected) return false
    if (!el.getClientRects().length) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && Number(style.opacity) > 0.01
  }
  const brief = (el) => {
    if (!(el instanceof Element)) return String(el?.nodeName ?? '')
    const attrs = ['data-v4-control', 'data-v4-block', 'aria-label', 'data-node-id', 'data-testid']
      .map((name) => el.getAttribute(name) ? `[${name}=${String(el.getAttribute(name)).slice(0, 40)}]` : '').join('')
    return `${el.tagName.toLowerCase()}${attrs}`
  }
  const ownerOf = (el) => {
    const node = el.closest?.('[data-node-id]')
    if (node) return `node:${node.getAttribute('data-node-id')}`
    if (el.closest?.('[data-production-task-card]')) return 'task-card'
    const right = el.closest?.('[data-nomi-right-panel]')
    if (right) return `right-panel:${right.getAttribute('data-nomi-right-panel')}`
    const block = el.closest?.('[data-v4-block]')
    if (block) return `agent:${block.getAttribute('data-v4-block')}`
    if (el.closest?.('[data-agent-resident]')) return 'agent-panel'
    if (el.closest?.('.mantine-Notification-root')) return 'toast'
    if (el.closest?.('[role="dialog"]')) return 'dialog'
    return 'page'
  }
  const contextText = (el) => {
    const holder = el.closest?.('[data-v4-block],[data-node-id],[data-production-task-card],[role="status"],.mantine-Notification-root') ?? el.parentElement
    return String(holder?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  }

  const readSurfaces = () => {
    const ws = document.querySelector('[data-workspace-mode]')
    const storyboard = [...document.querySelectorAll('[data-storyboard-rows="true"]')].some(visible)
    const right = [...document.querySelectorAll('[data-nomi-right-panel]')].filter(visible)
      .map((el) => el.getAttribute('data-nomi-right-panel')).sort().join(',')
    const agentOpen = [...document.querySelectorAll('[data-agent-resident="true"][data-agent-panel="true"]')].some(visible)
    const agentCollapsed = [...document.querySelectorAll('[data-agent-resident="true"][data-agent-collapsed="true"]')].some(visible)
    const modals = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],[data-spend-confirm-dialog]')].filter(visible)
      .map((el) => (el.hasAttribute('data-spend-confirm-dialog') ? 'spend-confirm' : (el.getAttribute('aria-label')
        || el.querySelector('h1,h2,h3')?.textContent || 'dialog')).trim().slice(0, 40)).sort().join(' | ')
    const viewportEl = document.querySelector('.react-flow__viewport')
    const viewport = viewportEl && visible(viewportEl.closest('.react-flow') ?? viewportEl) ? (viewportEl.style.transform || '') : ''
    // 创作页左栏此刻选中的是哪一行（原稿 / 某份分镜方案）。
    const activeRow = [...document.querySelectorAll('[data-creation-resource-tree] [aria-current="page"]')].find(visible)
    const creationSelection = activeRow
      ? (activeRow.hasAttribute('data-storyboard-id') ? `storyboard:${activeRow.getAttribute('data-storyboard-id')}` : `document:${activeRow.getAttribute('data-document-id') ?? ''}`)
      : 'none'
    return {
      workspaceMode: ws?.getAttribute('data-workspace-mode') ?? '',
      creationSelection,
      storyboardTable: storyboard ? 'open' : 'closed',
      rightPanel: right || 'closed',
      agentPanel: agentOpen ? 'open' : agentCollapsed ? 'collapsed' : 'absent',
      modal: modals || 'none',
      canvasViewport: viewport,
    }
  }
  const sampleSurfaces = () => {
    const now = Date.now()
    const next = readSurfaces()
    const previous = state.current
    state.current = next
    if (!previous) return
    for (const key of Object.keys(next)) {
      if (previous[key] !== next[key]) state.surfaces.push({ key, from: previous[key], to: next[key], at: now })
    }
    if (state.surfaces.length > 4000) state.surfaces.splice(0, 2000)
  }

  const spinnerIds = new WeakMap()
  const idOf = (el, prefix) => {
    let id = spinnerIds.get(el)
    if (!id) { id = `${prefix}${state.nextId++}`; spinnerIds.set(el, id) }
    return id
  }
  const sampleSpinners = () => {
    const now = Date.now()
    // 这份快照是几点采的：机器满载时定时器会被饿住，监视器读到的可能是几秒前的账（F7），要能看出来。
    state.spinnersSampledAt = now
    const seen = new Set()
    const consider = (el, kind) => {
      if (!(el instanceof Element) || !visible(el)) return
      const id = idOf(el, 's')
      seen.add(id)
      const entry = state.spinners[id] ?? (state.spinners[id] = { id, kind, desc: brief(el), firstSeen: now, lastSeen: now, gone: null })
      entry.owner = ownerOf(el)
      entry.context = contextText(el)
      entry.lastSeen = now
      entry.gone = null
    }
    for (const animation of document.getAnimations?.() ?? []) {
      const timing = animation.effect?.getComputedTiming?.()
      if (animation.playState !== 'running' || timing?.iterations !== Infinity) continue
      consider(animation.effect?.target, 'perpetual-animation')
    }
    document.querySelectorAll('[aria-busy="true"]').forEach((el) => consider(el, 'aria-busy'))
    document.querySelectorAll('[data-v4-block="composer"][data-mode="running"]').forEach((el) => consider(el, 'agent-running'))
    for (const entry of Object.values(state.spinners)) if (!seen.has(entry.id) && !entry.gone) entry.gone = now

    // 7c / 9c：每一条 toast 的文字与「×N」都记下（toast 可能在步骤收尾前就自己关了）。
    const toasts = new Set()
    document.querySelectorAll('.mantine-Notification-root').forEach((root) => {
      if (!visible(root)) return
      const id = idOf(root, 't')
      toasts.add(id)
      const text = String(root.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      const occurrences = Number(String(root.querySelector('[data-notification-occurrences]')?.textContent ?? '').replace(/[^0-9]/g, '')) || 1
      const entry = state.toasts[id] ?? (state.toasts[id] = { id, firstSeen: now, maxOccurrences: 1, texts: [] })
      entry.lastSeen = now
      entry.gone = null
      entry.maxOccurrences = Math.max(entry.maxOccurrences, occurrences)
      if (!entry.texts.includes(text)) entry.texts.push(text)
    })
    for (const entry of Object.values(state.toasts)) if (!toasts.has(entry.id) && !entry.gone) entry.gone = now
  }

  for (const type of ['pointerdown', 'keydown', 'wheel', 'drop']) {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted) return
      state.inputs.push({ type, at: Date.now(), key: event.key ?? null, target: brief(event.target) })
      if (state.inputs.length > 4000) state.inputs.splice(0, 2000)
    }, { capture: true, passive: true })
  }
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => { scheduled = false; sampleSurfaces() })
  }
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true })
  setInterval(sampleSurfaces, 250)
  setInterval(sampleSpinners, 400)
  sampleSurfaces()
  sampleSpinners()
  return 'installed'
}

export async function ensurePageProbe(win) {
  return win.evaluate(installProbe)
}

/** 读回页内时间线（原样；归因在监视器里做）。页面没装 / 被导航冲掉时回 null。 */
export async function readPageProbe(win) {
  return win.evaluate(() => {
    const state = window.__nomiFullWalk
    if (!state) return null
    return JSON.parse(JSON.stringify({
      installedAt: state.installedAt, current: state.current, inputs: state.inputs, surfaces: state.surfaces,
      spinners: state.spinners, versionPills: state.versionPills, toasts: state.toasts,
      spinnersSampledAt: state.spinnersSampledAt ?? null, readAt: Date.now(),
    }))
  })
}
