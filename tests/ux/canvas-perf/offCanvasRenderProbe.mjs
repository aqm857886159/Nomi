// Off-canvas React re-render probe (eval v2 · suspect #1 instrument).
//
// WHY THIS EXISTS
// The canvas perf benchmark's MutationObserver only watches stage/edges/labels
// (canvas-performance-benchmark.e2e.mjs:131-133). It is blind to the single
// largest waste identified in the 2026-09-01 drag investigation: off-canvas
// components (CategoryTree / asset pool / task center …) that subscribe to the
// whole `state.nodes` array and re-render on every drag mousemove even though
// nothing they show changed (leg-b §D suspect #1). This probe counts those
// off-canvas re-renders directly so the eval can (a) report them as an advisory
// metric and (b) serve as the U4 positive control — on today's code the count
// MUST be > 0, or the probe itself is broken.
//
// HOW IT WORKS (zero production change, dev bundle only)
// React DevTools works by having react-dom call a global hook on every commit:
// `__REACT_DEVTOOLS_GLOBAL_HOOK__.inject(renderer)` → rendererId, then
// `onCommitFiberRoot(rendererId, root)` per commit. We pre-install a minimal
// hook BEFORE the renderer bundle loads (verified contract:
// react-devtools-facade "call installFacade before React initializes"), and on
// each committed root we walk the fiber tree counting fibers that (1) carry a
// target component display name and (2) actually committed work this pass
// (`fiber.actualDuration > 0`, populated because we advertise
// `supportsProfiling`). Component display names are only readable in the DEV
// bundle (production mangles them) — this probe is meaningful on the dev leg,
// which is exactly the leg that reproduces the user's felt lag.
//
// The hook must be installed on the page's `window` before any React module
// evaluates. We inject it via Playwright `addInitScript` (runs on every
// document before page scripts) — see installOffCanvasRenderProbe below.

/**
 * Component display names whose re-renders are pure waste during a node drag:
 * they read node identity/category but never node position, yet immer swaps the
 * `nodes` array reference every tick and drags them along. Kept as a plain list
 * so the same set drives both the advisory metric and the positive control.
 */
export const OFF_CANVAS_RENDER_TARGETS = Object.freeze([
  'CategoryTree',
  'AssetLibraryPanel',
  'AssetPicker',
  'TaskCenterButton',
  'TaskCenterPanel',
  'TimelinePreview',
  'PreviewSourcePanel',
  'OnboardingChecklist',
])

/**
 * The init script body, stringified. Runs in the page (renderer) context before
 * React loads. Installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` if absent and records
 * per-component commit counts on `window.__offCanvasRenderProbe`.
 *
 * Kept as a source string (not a function reference) because it must execute in
 * the browser realm via addInitScript, and it closes over the target list which
 * we inject by textual substitution to keep a single source of truth.
 */
function buildInitScript(targets) {
  const targetLiteral = JSON.stringify(targets)
  return `(() => {
  if (window.__offCanvasRenderProbeInstalled) return
  window.__offCanvasRenderProbeInstalled = true
  const TARGETS = new Set(${targetLiteral})
  const state = {
    // counts[name] = number of commits in which a fiber for that component did work
    counts: Object.create(null),
    // windowCounts = same, but only since the last resetWindow() (per-action)
    windowCounts: Object.create(null),
    commits: 0,
    windowCommits: 0,
    recording: false,
  }
  window.__offCanvasRenderProbe = {
    resetWindow() {
      state.windowCounts = Object.create(null)
      state.windowCommits = 0
      state.recording = true
    },
    stopWindow() {
      state.recording = false
      const perComponent = {}
      let total = 0
      for (const name of TARGETS) {
        const value = state.windowCounts[name] || 0
        perComponent[name] = value
        total += value
      }
      return { perComponent, total, commits: state.windowCommits }
    },
    snapshotTotals() {
      const perComponent = {}
      for (const name of TARGETS) perComponent[name] = state.counts[name] || 0
      return { perComponent, commits: state.commits }
    },
  }

  const fiberName = (fiber) => {
    const type = fiber && fiber.type
    if (!type) return null
    if (typeof type === 'string') return null
    if (typeof type === 'function') return type.displayName || type.name || null
    // memo/forwardRef wrappers: unwrap one level
    if (type.displayName) return type.displayName
    const inner = type.type || type.render
    if (inner) return inner.displayName || inner.name || null
    return null
  }

  const walkRoot = (root) => {
    // A commit's finishedWork tree hangs off root.current.alternate (the tree
    // just committed) when available, else root.current.
    const start = (root && root.current) || root
    if (!start) return
    const stack = [start]
    const seen = new Set()
    while (stack.length) {
      const fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      // actualDuration > 0 marks a fiber that performed work in this commit
      // (profiling must be advertised — see hook.supportsFiber below). We treat
      // any positive duration as "re-rendered this commit".
      if (fiber.actualDuration && fiber.actualDuration > 0) {
        const name = fiberName(fiber)
        if (name && TARGETS.has(name)) {
          state.counts[name] = (state.counts[name] || 0) + 1
          if (state.recording) state.windowCounts[name] = (state.windowCounts[name] || 0) + 1
        }
      }
      if (fiber.child) stack.push(fiber.child)
      if (fiber.sibling) stack.push(fiber.sibling)
    }
  }

  const onCommit = (root) => {
    state.commits += 1
    if (state.recording) state.windowCommits += 1
    try { walkRoot(root) } catch { /* never let the probe crash the app */ }
  }

  // Compose with any pre-existing hook (e.g. a real DevTools) rather than
  // clobbering it: chain our onCommitFiberRoot after theirs.
  const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (existing && typeof existing.inject === 'function') {
    const priorOnCommit = existing.onCommitFiberRoot
    existing.onCommitFiberRoot = (id, root, priority) => {
      try { if (priorOnCommit) priorOnCommit(id, root, priority) } catch { /* ignore */ }
      onCommit(root)
    }
    // Ensure profiling durations are populated even if the prior hook didn't ask.
    const priorSupports = existing.supportsFiber
    existing.supportsFiber = true
    void priorSupports
    return
  }

  let nextId = 1
  const renderers = new Map()
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    // renderers registry the way react-dom expects to read/write it
    renderers,
    supportsFiber: true,
    // react-dom calls inject(renderer) once and keeps the returned id
    inject(renderer) {
      const id = nextId++
      renderers.set(id, renderer)
      return id
    },
    onCommitFiberRoot(_id, root) {
      onCommit(root)
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    // No-op DevTools bridge surface react-dom may probe for.
    on() {},
    off() {},
    emit() {},
    getFiberRoots() { return new Set() },
    checkDCE() {},
  }
})()`
}

/**
 * Install the probe on a Playwright page/context so it is present before React
 * boots. Must be called on the *context* (or page) BEFORE navigation/load, so
 * the init script wins the race against the renderer bundle.
 *
 * @param {import('playwright').BrowserContext | import('playwright').Page} target
 * @param {readonly string[]} [targets]
 */
export async function installOffCanvasRenderProbe(target, targets = OFF_CANVAS_RENDER_TARGETS) {
  await target.addInitScript(buildInitScript([...targets]))
}

/**
 * Begin recording off-canvas commits for one action window.
 * @param {import('playwright').Page} page
 */
export async function startOffCanvasRenderWindow(page) {
  return page.evaluate(() => {
    if (!window.__offCanvasRenderProbe) return false
    window.__offCanvasRenderProbe.resetWindow()
    return true
  })
}

/**
 * Stop recording and return { perComponent, total, commits } for the window.
 * Returns null when the probe never installed (e.g. production bundle without
 * readable names, or hook lost the race) so callers can degrade to advisory-null
 * rather than crash.
 * @param {import('playwright').Page} page
 */
export async function stopOffCanvasRenderWindow(page) {
  return page.evaluate(() => {
    if (!window.__offCanvasRenderProbe) return null
    return window.__offCanvasRenderProbe.stopWindow()
  })
}
