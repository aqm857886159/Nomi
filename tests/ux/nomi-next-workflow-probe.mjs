export function parseNomiJourneySelection(argv) {
  if (!Array.isArray(argv) || argv.length > 1 || (argv.length === 1 && argv[0] !== '--only=storyboard.switch')) throw new Error('Unsupported Nomi journey arguments; use no arguments or --only=storyboard.switch exactly once')
  return argv.length === 1
}

export function installCompletionProbe({ id, triggerSelector, conditions }) {
  const state = { rawObservationScope: 'Long tasks cover observer installation through stop; unfiltered raw diagnostic log, not an action-window distribution', id, documentId: crypto.randomUUID(), inputAt: null, completedAt: null, frames: [], longTasks: [], lastFrame: null }
  const visible = (el) => el && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && (() => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight })()
  const satisfied = ({ selector, text, textNot = [], attribute, value, valueNot }) => { const el = document.querySelector(selector); return visible(el) && (!text || el.textContent.includes(text)) && textNot.every((stale) => !el.textContent.includes(stale)) && (!attribute || (valueNot !== undefined ? el.getAttribute(attribute) !== valueNot : el.getAttribute(attribute) === value)) }
  if (!conditions.length || conditions.every(satisfied)) throw new Error('invalid diagnostic: completion was already satisfied before input')
  const input = (event) => { if (event.isTrusted && state.inputAt === null && (!triggerSelector || event.target?.closest(triggerSelector))) { state.inputAt = performance.now(); state.lastFrame = state.inputAt } }
  const frame = () => {
    if (state.inputAt !== null && state.completedAt === null) {
      if (conditions.every(satisfied)) state.completedAt = performance.now()
      const observedAt = performance.now()
      state.frames.push({ startTime: state.lastFrame, duration: observedAt - state.lastFrame }); state.lastFrame = observedAt
    }
    state.raf = requestAnimationFrame(frame)
  }
  const observer = new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))))
  observer.observe({ type: 'longtask', buffered: false })
  document.addEventListener('pointerdown', input, true)
  state.stop = () => { state.longTasks.push(...observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration }))); observer.disconnect(); cancelAnimationFrame(state.raf); document.removeEventListener('pointerdown', input, true); return Object.fromEntries(Object.entries(state).filter(([key]) => !['stop', 'raf', 'lastFrame'].includes(key))) }
  window.__nomiCompletion = state
  state.raf = requestAnimationFrame(frame)
  return { id, documentId: state.documentId }
}
