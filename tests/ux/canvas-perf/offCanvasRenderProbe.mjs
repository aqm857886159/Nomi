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
// target component display name and (2) ACTUALLY RE-RENDERED THEIR OWN BODY
// this commit. Component display names are only readable in the DEV bundle
// (production mangles them) — this probe is meaningful on the dev leg, which is
// exactly the leg that reproduces the user's felt lag.
//
// COUNTING SIGNAL: own render, not subtree, not stale (2026-09-02 correction)
// `fiber.actualDuration` is subtree-INCLUSIVE and, on the committed tree,
// persists across bailouts (React only zeroes it in createWorkInProgress when a
// fiber is actually worked on). So a naive `actualDuration > 0` walk counts (a)
// every ancestor of anything that rendered and (b) any component that rendered
// once and then bailed forever after — massively over-counting. A self-time
// refinement (actualDuration minus children) fails for the SAME reason: the
// stale committed value is read on bailout commits. S3 ground-truthed this with
// a component-level render counter plus an opposite-direction positive control
// (flipping one target to a raw `s.nodes` subscription): OnboardingChecklist
// re-rendered its own body 0 times during a drag while both duration-based
// walks reported ~69/261 (see the 2026-09-02 root-cause contract).
//
// A within-commit fiber-vs-alternate comparison ALSO fails, because the probe
// re-walks root.current every commit and a bailed subtree's fibers (plus their
// frozen alternate relationship) persist unchanged across many commits. We
// therefore keep a cross-commit memory: the probe remembers each target
// instance's last-seen (memoizedProps, memoizedState) and counts a render only
// when that pair changes between commits. A bailed fiber keeps the pair frozen
// (not counted); a real render swaps at least one (counted). This matches the
// ground-truth component-level counter exactly, in both directions (a positive
// control that flips a target to a raw s.nodes subscription makes both the
// counter and this probe spike together), restoring off-canvas quiet-render as
// a trustworthy advisory + U4 positive control rather than a broken gauge.
//
// KNOWN BLIND SPOT (F4 · advisory-only, accepted). The counting signal is a
// change in (memoizedProps, memoizedState). A component that re-renders purely
// because a React Context value it consumes changed — with NO change to its own
// props and NO useState/useReducer/store-hook state — would keep both memoized
// slots frozen and be UNDER-counted (its context-driven render is invisible to
// this diff). We accept this because: (1) the metric this probe backs is the
// drag-tick off-canvas re-render count, and the leak it guards (immer swapping
// `state.nodes`) reaches consumers through Zustand store hooks, which DO write
// fiber memoizedState — so the drag path we care about is fully observed; a
// pure context-only consumer is not a plausible carrier of per-mousemove churn
// here (no high-frequency context sits above these targets). (2) The probe is an
// advisory + positive-control gauge, not a hard budget — a missed context-only
// render would understate, never fabricate, waste. If a future target starts
// taking live drag data via context rather than a store hook, this probe would
// silently read low for it; re-derive the signal (e.g. an explicit render
// counter in that component) before trusting the number for it.
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
 * Cross-commit render tracker — the probe's ONE counting rule, extracted as a
 * real function so it is both (a) unit-testable against synthetic fiber trees
 * and (b) the single source injected verbatim into the browser init script
 * (via `.toString()` below). See the file header for why a cross-commit diff is
 * the only correct signal (subtree-inclusive / stale-on-bailout durations and
 * within-commit alternate comparisons all over-count).
 *
 * Returns `{ detect(fiber) -> boolean }`: true iff this fiber's own body
 * re-rendered since the previous commit (its memoizedProps or memoizedState
 * changed). A bailed fiber keeps both frozen → false. React double-buffers a
 * fiber with its `alternate`, so the memory is keyed on whichever buffer we saw
 * last and both are looked up / written each commit.
 *
 * Must be self-contained (no closure over module scope) so its `.toString()`
 * runs correctly in the page realm.
 */
export function createOffCanvasRenderTracker() {
  const lastSeen = new WeakMap() // fiber (or its alternate) -> { props, state }
  return {
    detect(fiber) {
      const alt = fiber.alternate
      const prior = lastSeen.get(fiber) || (alt ? lastSeen.get(alt) : undefined)
      const props = fiber.memoizedProps
      const st = fiber.memoizedState
      const entry = { props, state: st }
      lastSeen.set(fiber, entry)
      if (alt) lastSeen.set(alt, entry)
      if (prior === undefined) return true // first time we see this instance
      return prior.props !== props || prior.state !== st
    },
  }
}

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
  // Inject the tracker factory verbatim so the browser realm uses the exact
  // same counting rule the unit test pins (single source of truth).
  const trackerSource = createOffCanvasRenderTracker.toString()
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

  // Cross-commit render tracker (the ONE counting rule, injected verbatim from
  // the module so a unit test pins it — see createOffCanvasRenderTracker). A
  // within-commit fiber-vs-alternate comparison does NOT work: the probe
  // re-walks root.current every commit, and a bailed subtree's fibers plus their
  // frozen alternate relationship persist unchanged across many commits, so
  // every duration- or alternate-based within-commit signal reports a stale
  // positive (S3 ground-truthed: OnboardingChecklist body ran 0x during a drag
  // yet those signals reported ~65-266).
  const __tracker = (${trackerSource})()
  const recordAndDetectRender = (fiber) => __tracker.detect(fiber)

  const walkRoot = (root) => {
    // A commit's finishedWork tree hangs off root.current after commit.
    const start = (root && root.current) || root
    if (!start) return
    const stack = [start]
    const seen = new Set()
    while (stack.length) {
      const fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      // Count a REAL own-body re-render via the cross-commit diff (see above +
      // file header). A naive actualDuration>0 walk over-counts by ~17-40x
      // because that value is subtree-inclusive and persists across bailouts.
      const name = fiberName(fiber)
      if (name && TARGETS.has(name)) {
        const rendered = recordAndDetectRender(fiber)
        if (rendered) {
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
