import { describe, expect, it } from 'vitest'

import {
  ADVISORY_ONLY_SCENARIOS,
  applyPerformanceVerdict,
  evaluateBenchmarkPass,
  evaluateScenarioVerdict,
  evaluateWarmupFailure,
  sampleHardFailures,
} from '../../scripts/canvas-performance-verdict.mjs'

describe('canvas performance process verdict', () => {
  it('allows success only for an explicit persisted pass', () => {
    const processState = {}
    expect(applyPerformanceVerdict({ pass: true }, processState)).toBe(true)
    expect(processState.exitCode).toBeUndefined()
  })

  it.each([{ pass: false }, {}, null])('sets a nonzero exit code for a failed or missing verdict', (results) => {
    const processState = {}
    expect(applyPerformanceVerdict(results, processState)).toBe(false)
    expect(processState.exitCode).toBe(1)
  })
})

describe('advisory-only scenario verdict contract', () => {
  it('fails both scenario verdict and whole run when an advisory-only scenario throws sample.error', () => {
    const sample = {
      scale: 'M',
      scenario: 'zoom-slider-drag',
      runIndex: 1,
      error: 'Error: zoom-slider-drag: 找不到缩放滑杆',
      pageErrors: [],
      consoleErrors: [],
    }
    const verdict = evaluateScenarioVerdict({
      scenario: 'zoom-slider-drag',
      samples: [sample],
      budgetChecks: [],
    })

    expect(ADVISORY_ONLY_SCENARIOS.has('zoom-slider-drag')).toBe(true)
    expect(verdict.advisoryOnly).toBe(true)
    expect(verdict.hardFailures).toHaveLength(1)
    expect(verdict.hardFailures[0].reason).toContain('zoom-slider-drag: 找不到缩放滑杆')
    expect(verdict.pass).toBe(false)

    const pass = evaluateBenchmarkPass({
      summary: { 'M/zoom-slider-drag': { verdict } },
      warmupFailures: [],
    })
    expect(pass).toBe(false)

    const processState = {}
    expect(applyPerformanceVerdict({ pass }, processState)).toBe(false)
    expect(processState.exitCode).toBe(1)
  })

  it('fails the whole run when an advisory-only scenario errors during warmup', () => {
    const warmupSample = {
      scale: 'M',
      scenario: 'zoom-slider-drag',
      runIndex: 0,
      error: 'Error: zoom-slider-drag: 找不到缩放滑杆',
      pageErrors: [],
      consoleErrors: [],
    }
    const warmupFailure = evaluateWarmupFailure(warmupSample)
    expect(warmupFailure).not.toBeNull()
    expect(warmupFailure.advisoryOnly).toBe(true)
    expect(warmupFailure.failures[0]).toContain('zoom-slider-drag: 找不到缩放滑杆')

    const pass = evaluateBenchmarkPass({
      summary: {
        'M/blank-pan': {
          verdict: evaluateScenarioVerdict({
            scenario: 'blank-pan',
            samples: [{ scale: 'M', scenario: 'blank-pan', runIndex: 1, pageErrors: [], consoleErrors: [] }],
            budgetChecks: [],
          }),
        },
      },
      warmupFailures: [warmupFailure],
    })
    expect(pass).toBe(false)

    const processState = {}
    expect(applyPerformanceVerdict({ pass }, processState)).toBe(false)
    expect(processState.exitCode).toBe(1)
  })

  it('fails advisory-only scenarios on execution integrity or runtime error hard failures', () => {
    const tooFewSelected = evaluateScenarioVerdict({
      scenario: 'multi-node-drag',
      samples: [
        {
          scale: 'M',
          scenario: 'multi-node-drag',
          runIndex: 1,
          actionDetails: { selected: 1 },
          pageErrors: [],
          consoleErrors: [],
        },
      ],
    })
    expect(tooFewSelected.pass).toBe(false)
    expect(tooFewSelected.hardFailures[0].reason).toContain('selected only 1 nodes')

    const zeroEdgeDrag = evaluateScenarioVerdict({
      scenario: 'drag-over-dense-edges',
      samples: [
        {
          scale: 'M',
          scenario: 'drag-over-dense-edges',
          runIndex: 1,
          actionDetails: { connectedEdges: 0 },
          pageErrors: [],
          consoleErrors: [],
        },
      ],
    })
    expect(zeroEdgeDrag.pass).toBe(false)
    expect(zeroEdgeDrag.hardFailures[0].reason).toContain('0 connected edges')

    const pageErrorSample = evaluateScenarioVerdict({
      scenario: 'drag-at-low-zoom',
      samples: [
        {
          scale: 'M',
          scenario: 'drag-at-low-zoom',
          runIndex: 1,
          pageErrors: ['TypeError: cannot read properties of undefined'],
          consoleErrors: [],
        },
      ],
    })
    expect(pageErrorSample.pass).toBe(false)
    expect(pageErrorSample.hardFailures[0].reason).toContain('page error:')
  })

  it('keeps advisory-only scenarios green when error-free and only exceeding budgetChecks or scale longTask budget', () => {
    const sample = {
      scale: 'M',
      scenario: 'drag-nodes-all',
      runIndex: 1,
      probe: { longTasks: 12, maxLoadingImages: 0, maxLoadingVideos: 0, maxActiveVideos: 0 },
      actionDetails: { selected: 96, moves: 250 },
      nodeIdentity: { commonIdentityPreserved: true, targetIdentityPreserved: null },
      pageErrors: [],
      consoleErrors: [],
    }
    const budgetChecks = [
      { metric: 'frameGapP95Ms', actualP95: 41, max: 38, pass: false, advisory: false },
      { metric: 'maxFrameGapMs', actualP95: 134.6, max: 80, pass: false, advisory: true },
      { metric: 'longTaskP95Ms', actualP95: 130, max: 128, pass: false, advisory: false },
    ]
    const verdict = evaluateScenarioVerdict({
      scenario: 'drag-nodes-all',
      samples: [sample],
      budgetChecks,
      longTaskCap: 3,
    })

    expect(verdict.advisoryOnly).toBe(true)
    expect(verdict.hardFailures).toEqual([])
    expect(verdict.budgetChecks.some((check) => check.metric === 'longTasks' && check.pass === false && check.advisory === true)).toBe(true)
    expect(verdict.pass).toBe(true)

    const warmupFailure = evaluateWarmupFailure(
      {
        scale: 'M',
        scenario: 'drag-nodes-all',
        runIndex: 0,
        probe: { longTasks: 16, maxLoadingImages: 0, maxLoadingVideos: 0, maxActiveVideos: 0 },
        pageErrors: [],
        consoleErrors: [],
      },
      { longTaskCap: 3 },
    )
    expect(warmupFailure).toBeNull()

    const pass = evaluateBenchmarkPass({
      summary: { 'M/drag-nodes-all': { verdict } },
      warmupFailures: [],
    })
    expect(pass).toBe(true)

    const processState = {}
    expect(applyPerformanceVerdict({ pass }, processState)).toBe(true)
    expect(processState.exitCode).toBeUndefined()
  })

  it('keeps gating scenarios failing on budget failures and enforces longTaskCap once graduated from advisory', () => {
    const gatingBudgetFail = evaluateScenarioVerdict({
      scenario: 'node-drag-image',
      samples: [{ scale: 'M', scenario: 'node-drag-image', runIndex: 1, pageErrors: [], consoleErrors: [] }],
      budgetChecks: [{ metric: 'frameGapP95Ms', actualP95: 60, max: 53, pass: false, advisory: false }],
      budgetsAreCalibratedForLeg: true,
    })
    expect(gatingBudgetFail.advisoryOnly).toBe(false)
    expect(gatingBudgetFail.pass).toBe(false)

    const uncalibratedBudgetOnly = evaluateScenarioVerdict({
      scenario: 'node-drag-image',
      samples: [{ scale: 'M', scenario: 'node-drag-image', runIndex: 1, pageErrors: [], consoleErrors: [] }],
      budgetChecks: [{ metric: 'frameGapP95Ms', actualP95: 60, max: 53, pass: false, advisory: false }],
      budgetsAreCalibratedForLeg: false,
    })
    expect(uncalibratedBudgetOnly.pass).toBe(true)

    const graduatedLongTaskFail = evaluateScenarioVerdict({
      scenario: 'drag-nodes-all',
      advisoryOnly: false,
      samples: [
        {
          scale: 'M',
          scenario: 'drag-nodes-all',
          runIndex: 1,
          probe: { longTasks: 5 },
          pageErrors: [],
          consoleErrors: [],
        },
      ],
      longTaskCap: 3,
    })
    expect(graduatedLongTaskFail.pass).toBe(false)
    expect(graduatedLongTaskFail.hardFailures).toHaveLength(1)
    expect(graduatedLongTaskFail.hardFailures[0].reason).toContain('5 次长任务 > 3')

    expect(
      sampleHardFailures(
        {
          scale: 'M',
          scenario: 'drag-nodes-all',
          runIndex: 1,
          probe: { longTasks: 5 },
          pageErrors: [],
          consoleErrors: [],
        },
        { longTaskCap: 3, advisoryOnly: true },
      ),
    ).toEqual([])
  })
})
