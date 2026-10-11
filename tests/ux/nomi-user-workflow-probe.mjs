// One document and one trusted gesture per sample. Reload invalidates it.
export function installProjectOpenProbe({ probeId, cardSelector, projectName, nodeId, loadingLabels = [] }) {
  if (window.__nomiWorkflowPerf) throw new Error('probe already installed')
  const state = { documentId: crypto.randomUUID(), probeId, inputAt: null, feedbackAt: null, contentAt: null, readyAt: null, controlInputAt: null, acknowledgedAt: null, targetReceipt: null, frames: [], longTasks: [], longTaskSupported: false, lastFrame: null }
  const visible = (element, clip) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom)
    if (clip) { const bounds = clip.getBoundingClientRect(); left = Math.max(left, bounds.left); top = Math.max(top, bounds.top); right = Math.min(right, bounds.right); bottom = Math.min(bottom, bounds.bottom) }
    if (rect.width <= 0 || rect.height <= 0 || element.closest('[hidden]')) return false
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
      const bounds = ancestor.getBoundingClientRect()
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
    }
    return right > left && bottom > top
  }
  const content = () => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const project = document.querySelector('[data-shell-project-menu]')
    const node = stage?.querySelector(`[data-node-id="${nodeId}"]`)
    const media = node?.querySelector?.('img')
    const matchingProject = project?.getAttribute('title') === projectName && visible(project)
    const mounted = matchingProject && visible(stage) && visible(node, stage)
    // Existing route/canvas Suspense spinner counts as opening feedback after
    // this trusted card action has replaced its library. Unrelated spinners
    // (Agent, thumbnail, settings) have different labels and do not count.
    const loading = !visible(document.querySelector(cardSelector)) && Array.from(document.querySelectorAll('.nomi-loading-mark[role="status"]')).some((element) => loadingLabels.includes(element.getAttribute('aria-label')) && visible(element))
    return { feedback: matchingProject || loading, feedbackKind: matchingProject ? 'project-title' : loading ? 'opening-spinner' : null, decoded: mounted && media?.complete && media.naturalWidth > 0 && visible(media, stage), ready: Boolean(mounted && stage?.getAttribute('data-ready') === 'true'), project }
  }
  const input = (event) => {
    if (!event.isTrusted) return
    if (state.inputAt === null && event.target?.closest(cardSelector)) {
      state.inputAt = performance.now()
      state.lastFrame = state.inputAt
    } else if (state.readyAt !== null && state.controlInputAt === null && event.target?.closest('[data-shell-project-menu]') && content().ready) {
      state.controlInputAt = performance.now()
    }
  }

  const frame = () => {
    if (state.inputAt !== null) {
      const milestone = content()
      if (milestone.feedback && state.feedbackAt === null) { state.feedbackAt = performance.now(); state.feedbackReceipt = { kind: milestone.feedbackKind, projectName } }
      if (milestone.decoded && state.contentAt === null) state.contentAt = performance.now()
      if (milestone.ready && state.readyAt === null) state.readyAt = performance.now()
      if (state.controlInputAt !== null && state.acknowledgedAt === null && milestone.project?.getAttribute('aria-expanded') === 'true') {
        const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((element) => element.getAttribute('aria-label') === milestone.project.getAttribute('aria-label') && visible(element))
        if (menu) { state.acknowledgedAt = performance.now(); state.targetReceipt = { control: 'project-menu', expanded: true, menuVisible: true } }
      }
      const observedAt = performance.now()
      state.frames.push({ startTime: state.lastFrame, duration: observedAt - state.lastFrame })
      state.lastFrame = observedAt
    }
    state.raf = requestAnimationFrame(frame)
  }
  state.observer = new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))))
  try { state.observer.observe({ type: 'longtask', buffered: false }); state.longTaskSupported = true } catch { /* explicit unsupported flag */ }
  document.addEventListener('pointerdown', input, true)
  state.stop = () => {
    state.longTasks.push(...state.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })))
    state.observer.disconnect(); cancelAnimationFrame(state.raf)
    document.removeEventListener('pointerdown', input, true)
    return Object.fromEntries(Object.entries(state).filter(([key]) => !['stop', 'observer', 'raf', 'lastFrame'].includes(key)))
  }
  state.raf = requestAnimationFrame(frame)
  window.__nomiWorkflowPerf = state
  return { documentId: state.documentId, probeId }
}
