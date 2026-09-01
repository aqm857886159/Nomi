// Unit contracts for the eval v2 advisory metrics + the LOD-constant sync guard.
// These are pure-logic tests (no browser); they pin the arithmetic that the
// baseline report leans on and the invariant that keeps drag-at-low-zoom honest.
import { describe, expect, it } from 'vitest'
import {
  amortizePerMove,
  dragOverPanRatios,
  actionLatency,
  offCanvasRenderSummary,
  buildScenarioAdvisory,
  quantile,
} from './advisoryMetrics.mjs'
import { LIGHTWEIGHT_ZOOM_CEILING, rankNodesByDegree } from './dragScenarios.mjs'
import { LIGHTWEIGHT_NODE_ZOOM_THRESHOLD } from '../../../src/workbench/generationCanvas/components/canvasNodeLevelOfDetail.ts'
import { OFF_CANVAS_RENDER_TARGETS } from './offCanvasRenderProbe.mjs'

describe('amortizePerMove', () => {
  it('divides cumulative CDP counters by move count', () => {
    const out = amortizePerMove({ scriptDurationMs: 473, layoutCount: 144, recalcStyleCount: 460, moves: 60 })
    // 473/60 ≈ 7.88ms/tick, 144/60 = 2.4 layouts/move — matches the leg-b fingerprint.
    expect(out.scriptPerMoveMs).toBeCloseTo(7.88, 1)
    expect(out.layoutPerMove).toBeCloseTo(2.4, 2)
    expect(out.recalcPerMove).toBeCloseTo(7.67, 1)
  })
  it('returns nulls when moves is missing or zero (never divides by zero)', () => {
    expect(amortizePerMove({ scriptDurationMs: 100, moves: 0 })).toEqual({ scriptPerMoveMs: null, layoutPerMove: null, recalcPerMove: null })
    expect(amortizePerMove({ scriptDurationMs: 100, moves: undefined }).scriptPerMoveMs).toBeNull()
  })
})

describe('dragOverPanRatios', () => {
  it('computes same-machine drag/pan ratios (the platform-stable fingerprint)', () => {
    const out = dragOverPanRatios({ scriptDurationMs: 473, layoutCount: 144 }, { scriptDurationMs: 88, layoutCount: 3 })
    expect(out.scriptRatio).toBeCloseTo(5.38, 1) // ≈5.4× from the investigation
    expect(out.layoutRatio).toBeCloseTo(48, 0) // 144/3 = 48×
  })
  it('guards against a zero pan denominator', () => {
    expect(dragOverPanRatios({ scriptDurationMs: 10, layoutCount: 10 }, { scriptDurationMs: 0, layoutCount: 0 })).toEqual({ scriptRatio: null, layoutRatio: null })
  })
})

describe('actionLatency', () => {
  it('reports p95/median of pointer→first-feedback and drops negatives', () => {
    const out = actionLatency([10, 12, 40, -1, 15, 9])
    expect(out.samples).toEqual([10, 12, 40, 15, 9])
    expect(out.p95Ms).toBe(40)
    expect(out.medianMs).toBe(12)
  })
  it('is empty-safe', () => {
    expect(actionLatency([])).toEqual({ samples: [], p95Ms: null, medianMs: null })
  })
})

describe('offCanvasRenderSummary', () => {
  const components = ['CategoryTree', 'TaskCenterButton']
  it('aggregates totals and per-component maxima across windows', () => {
    const out = offCanvasRenderSummary(
      [
        { total: 55, perComponent: { CategoryTree: 30, TaskCenterButton: 25 } },
        { total: 61, perComponent: { CategoryTree: 33, TaskCenterButton: 28 } },
      ],
      components,
    )
    expect(out.installed).toBe(true)
    expect(out.totalMax).toBe(61)
    expect(out.perComponentMax).toEqual({ CategoryTree: 33, TaskCenterButton: 28 })
  })
  it('marks not-installed when every window is null (probe lost the race / prod bundle)', () => {
    const out = offCanvasRenderSummary([null, null], components)
    expect(out.installed).toBe(false)
    expect(out.totalMax).toBeNull()
  })
})

describe('buildScenarioAdvisory', () => {
  it('threads sample fields into per-move, ratio, latency and off-canvas blocks', () => {
    const samples = [
      {
        cdpDelta: { ScriptDurationMs: 473, LayoutCount: 144, RecalcStyleCount: 460 },
        actionDetails: { moves: 60, firstFeedbackMs: 12 },
        offCanvasRender: { total: 55, perComponent: { CategoryTree: 30 } },
      },
    ]
    const advisory = buildScenarioAdvisory({ samples, panControl: { scriptDurationMs: 88, layoutCount: 3 }, offCanvasComponents: ['CategoryTree'] })
    expect(advisory.perMove.layoutPerMove.median).toBeCloseTo(2.4, 2)
    expect(advisory.dragOverPan.layoutRatio.median).toBeCloseTo(48, 0)
    expect(advisory.actionLatency.p95Ms).toBe(12)
    expect(advisory.offCanvasRender.totalMax).toBe(55)
  })
  it('degrades to nulls when there is no pan control and no probe', () => {
    const samples = [{ cdpDelta: { ScriptDurationMs: 100, LayoutCount: 10 }, actionDetails: { moves: 20 }, offCanvasRender: null }]
    const advisory = buildScenarioAdvisory({ samples, panControl: null, offCanvasComponents: ['CategoryTree'] })
    expect(advisory.dragOverPan.scriptRatio.median).toBeNull()
    expect(advisory.offCanvasRender.installed).toBe(false)
    expect(advisory.perMove.scriptPerMoveMs.median).toBe(5) // 100/20
  })
})

describe('quantile', () => {
  it('matches the benchmark ceil-index convention', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2)
    expect(quantile([], 0.95)).toBeNull()
  })
})

describe('LOD ceiling stays in sync with the source of truth', () => {
  it('dragScenarios mirrors canvasNodeLevelOfDetail zoom threshold', () => {
    // If the product changes the lightweight zoom trigger, this fails loudly so
    // drag-at-low-zoom does not silently measure full-content drag instead.
    expect(LIGHTWEIGHT_ZOOM_CEILING).toBe(LIGHTWEIGHT_NODE_ZOOM_THRESHOLD)
  })
})

describe('rankNodesByDegree (dense-edge target selection)', () => {
  it('ranks node ids by fixture edge degree, highest first', () => {
    // Mirrors the S-scale fixture head: video-0 touches 3 edges, image-0 touches 2.
    const edges = [
      { source: 'image-0', target: 'video-0' },
      { source: 'video-0', target: 'video-1' },
      { source: 'image-0', target: 'video-2' },
      { source: 'x', target: 'video-0' },
    ]
    const ranked = rankNodesByDegree(edges)
    expect(ranked[0]).toEqual(['video-0', 3])
    expect(ranked.find(([id]) => id === 'image-0')[1]).toBe(2)
  })
  it('is empty-safe', () => {
    expect(rankNodesByDegree([])).toEqual([])
    expect(rankNodesByDegree(undefined)).toEqual([])
  })
})

describe('off-canvas targets are the investigated suspect set', () => {
  it('includes the components leg-b flagged as position-blind subscribers', () => {
    for (const name of ['CategoryTree', 'TaskCenterButton', 'TaskCenterPanel', 'TimelinePreview', 'PreviewSourcePanel', 'OnboardingChecklist']) {
      expect(OFF_CANVAS_RENDER_TARGETS).toContain(name)
    }
  })
})
