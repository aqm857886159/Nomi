// Advisory drag metrics (eval v2 · U2). PURE functions, no Playwright/CDP.
//
// These derive per-move amortized cost and same-machine drag/pan ratios from
// the raw numbers the benchmark already collects (CDP LayoutCount /
// ScriptDurationMs deltas + the pointer→first-visual-feedback timings). Every
// value here is ADVISORY: it is recorded into the result JSON and shown in the
// report, but it MUST NOT enter any PASS/FAIL verdict this round (#264 lesson:
// absolute thresholds are platform-fragile; ship them as observation first,
// harden only after we have cross-platform data). The benchmark's existing
// PERFORMANCE_BUDGETS and hard-failure clauses are left byte-for-byte unchanged.
//
// The single most sensitive fingerprint from the investigation is
// LayoutCount/move: dragging showed 144–214 forced layouts across ~60 moves
// (≈2.4–3.6 per move) versus 3 total for a pure pan. That ratio, not any
// absolute ms budget, is what a fix has to move.

/** p95 helper matching the benchmark's quantile semantics (ceil index). */
export function quantile(values, q) {
  const sorted = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Per-move amortization for one drag sample.
 * @param {{ scriptDurationMs?: number, layoutCount?: number, recalcStyleCount?: number, moves: number }} input
 * @returns {{ scriptPerMoveMs: number|null, layoutPerMove: number|null, recalcPerMove: number|null }}
 */
export function amortizePerMove({ scriptDurationMs, layoutCount, recalcStyleCount, moves }) {
  const n = Number.isFinite(moves) && moves > 0 ? moves : null
  if (!n) return { scriptPerMoveMs: null, layoutPerMove: null, recalcPerMove: null }
  return {
    scriptPerMoveMs: Number.isFinite(scriptDurationMs) ? round(scriptDurationMs / n) : null,
    layoutPerMove: Number.isFinite(layoutCount) ? round(layoutCount / n) : null,
    recalcPerMove: Number.isFinite(recalcStyleCount) ? round(recalcStyleCount / n) : null,
  }
}

/**
 * Same-machine drag-vs-pan ratios. Pan is the control (viewport transform only,
 * no store write); the ratio exposes how much heavier the drag path is than the
 * cheapest possible gesture on the identical machine — stable across platforms
 * where absolute budgets are not.
 * @param {{ scriptDurationMs?: number, layoutCount?: number }} drag
 * @param {{ scriptDurationMs?: number, layoutCount?: number }} pan
 */
export function dragOverPanRatios(drag, pan) {
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? round(a / b) : null)
  return {
    scriptRatio: ratio(drag?.scriptDurationMs, pan?.scriptDurationMs),
    layoutRatio: ratio(drag?.layoutCount, pan?.layoutCount),
  }
}

/**
 * action_latency: the interval from pointerdown to the first visual feedback
 * (first stage/edge mutation the probe observed). The benchmark already records
 * `probe.firstMutationMs` relative to probe start; when the probe is started
 * immediately before pointerdown that value IS the action latency. We surface
 * both the per-sample values and their p95. Promised in the 2026-08-09 plan,
 * never implemented until now.
 * @param {number[]} firstFeedbackMsSamples
 */
export function actionLatency(firstFeedbackMsSamples) {
  const values = (firstFeedbackMsSamples || []).filter((v) => Number.isFinite(v) && v >= 0)
  return {
    samples: values,
    p95Ms: round(quantile(values, 0.95)),
    medianMs: round(quantile(values, 0.5)),
  }
}

/**
 * Off-canvas re-render advisory summary across a scenario's samples.
 * total>0 on current code is the positive control (U4). We report the max and
 * median total plus per-component maxima so a regression (or a fix landing) is
 * visible per component.
 * @param {Array<{ perComponent?: Record<string, number>, total?: number } | null>} windows
 * @param {readonly string[]} components
 */
export function offCanvasRenderSummary(windows, components) {
  const present = (windows || []).filter(Boolean)
  const totals = present.map((w) => w.total).filter((v) => Number.isFinite(v))
  const perComponentMax = {}
  for (const name of components) {
    const values = present.map((w) => (w.perComponent ? w.perComponent[name] : null)).filter((v) => Number.isFinite(v))
    perComponentMax[name] = values.length ? Math.max(...values) : null
  }
  return {
    installed: present.length > 0,
    windows: present.length,
    totalMax: totals.length ? Math.max(...totals) : null,
    totalMedian: round(quantile(totals, 0.5)),
    perComponentMax,
  }
}

/**
 * Compose the full advisory block for one scenario from its samples + the pan
 * control. Everything returned is advisory metadata attached under
 * `summary.advisory`; nothing here is read by the verdict.
 *
 * @param {object} args
 * @param {Array<object>} args.samples  scenario samples (each with cdpDelta, actionDetails, offCanvasRender)
 * @param {object|null} args.panControl an aggregate { scriptDurationMs, layoutCount } for blank-pan on the same run
 * @param {readonly string[]} args.offCanvasComponents
 */
export function buildScenarioAdvisory({ samples, panControl, offCanvasComponents }) {
  const list = samples || []
  const perMove = list
    .map((s) => {
      const moves = s?.actionDetails?.moves
      if (!Number.isFinite(moves)) return null
      return amortizePerMove({
        scriptDurationMs: s?.cdpDelta?.ScriptDurationMs,
        layoutCount: s?.cdpDelta?.LayoutCount,
        recalcStyleCount: s?.cdpDelta?.RecalcStyleCount,
        moves,
      })
    })
    .filter(Boolean)

  const scriptPerMove = perMove.map((m) => m.scriptPerMoveMs).filter(Number.isFinite)
  const layoutPerMove = perMove.map((m) => m.layoutPerMove).filter(Number.isFinite)

  const ratios = list
    .map((s) =>
      panControl
        ? dragOverPanRatios(
            { scriptDurationMs: s?.cdpDelta?.ScriptDurationMs, layoutCount: s?.cdpDelta?.LayoutCount },
            panControl,
          )
        : null,
    )
    .filter(Boolean)

  const firstFeedback = list.map((s) => s?.actionDetails?.firstFeedbackMs).filter((v) => Number.isFinite(v))

  return {
    perMove: {
      scriptPerMoveMs: { median: round(quantile(scriptPerMove, 0.5)), p95: round(quantile(scriptPerMove, 0.95)), samples: scriptPerMove },
      layoutPerMove: { median: round(quantile(layoutPerMove, 0.5)), p95: round(quantile(layoutPerMove, 0.95)), samples: layoutPerMove },
    },
    dragOverPan: {
      scriptRatio: { median: round(quantile(ratios.map((r) => r.scriptRatio), 0.5)), samples: ratios.map((r) => r.scriptRatio) },
      layoutRatio: { median: round(quantile(ratios.map((r) => r.layoutRatio), 0.5)), samples: ratios.map((r) => r.layoutRatio) },
    },
    actionLatency: actionLatency(firstFeedback),
    offCanvasRender: offCanvasRenderSummary(list.map((s) => s?.offCanvasRender), offCanvasComponents),
  }
}
