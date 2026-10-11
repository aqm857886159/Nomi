// One document and one trusted gesture per sample. Reload invalidates it.
export function installProjectOpenProbe({ probeId, cardSelector, projectName, nodeId }) {
  if (window.__nomiWorkflowPerf) throw new Error('probe already installed')
  const state = { documentId: crypto.randomUUID(), probeId, inputAt: null, visibleAt: null, readyAt: null, acknowledgedAt: null, frames: [], longTasks: [], longTaskSupported: false, lastFrame: null }
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
    // This action's known first node is an image. A mounted card or its loading
    // placeholder is not the fixture's content; require decoded visible media.
    const media = node?.querySelector?.('img')
    const matching = project?.textContent?.includes(projectName) && visible(project) && visible(stage) && visible(node, stage) && media?.complete && media.naturalWidth > 0 && visible(media, stage)
    return { matching, ready: Boolean(matching && stage?.getAttribute('data-ready') === 'true') }
  }
  const input = (event) => {
    if (event.isTrusted && state.inputAt === null && event.target?.closest(cardSelector)) {
      state.inputAt = performance.now()
      state.lastFrame = state.inputAt
    }
  }
  const acknowledge = (event) => { if (event.isTrusted && event.key === 'Shift' && state.readyAt !== null && content().ready) state.acknowledgedAt = performance.now() }
  const frame = (timestamp) => {
    if (state.inputAt !== null) {
      if (state.lastFrame !== null) state.frames.push({ startTime: state.lastFrame, duration: timestamp - state.lastFrame })
      state.lastFrame = timestamp
      const milestone = content()
      if (milestone.matching && state.visibleAt === null) state.visibleAt = performance.now()
      if (milestone.ready && state.readyAt === null) state.readyAt = performance.now()
    }
    state.raf = requestAnimationFrame(frame)
  }
  state.observer = new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))))
  try { state.observer.observe({ type: 'longtask', buffered: false }); state.longTaskSupported = true } catch { /* explicit unsupported flag */ }
  document.addEventListener('pointerdown', input, true)
  document.addEventListener('keydown', acknowledge, true)
  state.stop = () => {
    state.longTasks.push(...state.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })))
    state.observer.disconnect(); cancelAnimationFrame(state.raf)
    document.removeEventListener('pointerdown', input, true); document.removeEventListener('keydown', acknowledge, true)
    return Object.fromEntries(Object.entries(state).filter(([key]) => !['stop', 'observer', 'raf', 'lastFrame'].includes(key)))
  }
  state.raf = requestAnimationFrame(frame)
  window.__nomiWorkflowPerf = state
  return { documentId: state.documentId, probeId }
}
