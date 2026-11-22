import os from 'node:os'
import { MIN_NODE_BAND_COVERAGE } from '../tests/ux/canvas-perf/gestureGeometry.mjs'

export const ADVISORY_ONLY_SCENARIOS = new Set([
  'multi-node-drag',
  'drag-at-low-zoom',
  'drag-over-dense-edges',
  'drag-nodes-all',
  'drag-group-frame-60',
  'zoom-slider-drag',
])

export const NON_DARWIN_TIMING_CALIBRATION = 1.6

export function timingBudget(baseMax, platform = os.platform()) {
  return platform === 'darwin' ? baseMax : Math.round(baseMax * NON_DARWIN_TIMING_CALIBRATION)
}

export const SCALE_STUDY_BUDGETS = {
  'drag-nodes-all': {
    60: { frameGapP95Ms: 20, maxFrameGapMs: 40, longTasks: 1 },
    150: { frameGapP95Ms: 24, maxFrameGapMs: 50, longTasks: 3 },
    300: { frameGapP95Ms: 30, maxFrameGapMs: 60, longTasks: 5 },
  },
  'drag-group-frame-60': {
    60: { frameGapP95Ms: 20, maxFrameGapMs: 40, longTasks: 1 },
    150: { frameGapP95Ms: 22, maxFrameGapMs: 45, longTasks: 3 },
    300: { frameGapP95Ms: 26, maxFrameGapMs: 55, longTasks: 5 },
  },
  'zoom-slider-drag': {
    60: { maxFrameGapMs: 80, longTasks: 1 },
    150: { maxFrameGapMs: 120, longTasks: 3 },
    300: { maxFrameGapMs: 150, longTasks: 4 },
  },
}

export function scaleNodeTier(nodeCount) {
  if (nodeCount <= 60) return 60
  if (nodeCount <= 150) return 150
  return 300
}

export function longTaskCountBudget(scenario, nodeCount) {
  const tier = SCALE_STUDY_BUDGETS[scenario]?.[scaleNodeTier(nodeCount)]
  return tier && Number.isFinite(tier.longTasks) ? tier.longTasks : null
}

export function sampleHardFailures(
  sample,
  {
    platform = os.platform(),
    longTaskCap = null,
    advisoryOnly = ADVISORY_ONLY_SCENARIOS.has(sample?.scenario),
  } = {},
) {
  const failures = []
  if (sample.scenario === 'waiting-effects' && sample.probe) {
    if (sample.probe.longTasks !== 0) failures.push(`waiting effects: ${sample.probe.longTasks} long tasks`)
    if (sample.probe.fps < 1000 / timingBudget(33, platform))
      failures.push(`waiting effects: ${sample.probe.fps} FPS below frame budget`)
  }
  if (sample.error) failures.push(`scenario error: ${sample.error}`)
  // 规模档场景的长任务次数（§6）属于性能预算；advisoryOnly 期间只记录在 budgetChecks(advisory:true) 里，
  // 退出 advisory 当天即作为硬门岗生效，绝不混同场景报错或阻止其余 advisory 场景在 CI 正常跑过。
  if (
    !advisoryOnly &&
    longTaskCap !== null &&
    sample.probe &&
    Number.isFinite(sample.probe.longTasks) &&
    sample.probe.longTasks > longTaskCap
  ) {
    failures.push(
      `${sample.scenario} @ ${sample.scale}: ${sample.probe.longTasks} 次长任务 > ${longTaskCap}（§6 规模档硬门岗）`,
    )
  }
  for (const error of sample.pageErrors || []) failures.push(`page error: ${error}`)
  for (const error of sample.consoleErrors || []) failures.push(`console error: ${error}`)
  if (sample.actionDetails?.anchorErrorPx > 1.5)
    failures.push(`zoom anchor drift ${sample.actionDetails.anchorErrorPx}px > 1.5px`)
  if (sample.actionDetails?.stepErrorPx > 1.5)
    failures.push(`pan/zoom continuation error ${sample.actionDetails.stepErrorPx}px > 1.5px`)
  if (sample.actionDetails?.selectedAfterClear !== undefined && sample.actionDetails.selectedAfterClear !== 0)
    failures.push(`blank click left ${sample.actionDetails.selectedAfterClear} selected nodes`)
  if (sample.scenario === 'marquee-select' && !sample.error && Number.isFinite(sample.actionDetails?.selected)) {
    const { selected, expectedSelection, nodeBandCoverage: bandCoverage } = sample.actionDetails
    if (Number.isFinite(expectedSelection?.definite) && Number.isFinite(expectedSelection?.possible)) {
      if (selected < expectedSelection.definite || selected > expectedSelection.possible)
        failures.push(
          `marquee selected ${selected} nodes, expected ${expectedSelection.definite}–${expectedSelection.possible} ` +
            'overlapping the swept rect (selectionMode=Partial)',
        )
    } else {
      failures.push('marquee sample did not record a derived selection expectation')
    }
    if (Number.isFinite(bandCoverage) && bandCoverage < MIN_NODE_BAND_COVERAGE)
      failures.push(
        `marquee covered only ${Math.round(bandCoverage * 100)}% of the reachable node band ` +
          `(needs ≥ ${Math.round(MIN_NODE_BAND_COVERAGE * 100)}%)`,
      )
  }
  if (
    sample.scenario === 'multi-node-drag' &&
    !sample.error &&
    Number.isFinite(sample.actionDetails?.selected) &&
    sample.actionDetails.selected < 2
  )
    failures.push(`multi-node-drag selected only ${sample.actionDetails.selected} nodes (needs ≥2)`)
  if (
    sample.scenario === 'drag-over-dense-edges' &&
    !sample.error &&
    Number.isFinite(sample.actionDetails?.connectedEdges) &&
    sample.actionDetails.connectedEdges < 1
  )
    failures.push('drag-over-dense-edges dragged a node with 0 connected edges')
  if (sample.nodeIdentity?.commonIdentityPreserved === false) {
    const remounted = sample.nodeIdentity.remountedInPlace || []
    failures.push(
      remounted.length
        ? `node layer rebuilt in place: ${remounted.join(', ')}`
        : `continuously mounted node DOM identity changed (${sample.nodeIdentity.preserved}/${sample.nodeIdentity.tracked} preserved)`,
    )
  }
  if (sample.nodeIdentity?.targetIdentityPreserved === false)
    failures.push(`target node DOM identity changed: ${sample.nodeIdentity.targetNodeId}`)
  if (sample.probe?.maxLoadingImages > 4) failures.push(`image activation peak ${sample.probe.maxLoadingImages} > 4`)
  if (sample.probe?.maxLoadingVideos > 1) failures.push(`video activation peak ${sample.probe.maxLoadingVideos} > 1`)
  if (sample.probe?.maxActiveVideos > 1)
    failures.push(`simultaneously playing videos ${sample.probe.maxActiveVideos} > 1`)
  if (sample.scenario === 'media-error') {
    if (sample.actionDetails?.initialFailure !== true) failures.push('media failure did not surface initially')
    if (sample.actionDetails?.retryFailure !== true) failures.push('media failure did not surface after retry')
    if (sample.actionDetails?.recoverySuccess !== true) failures.push('media failure did not recover successfully')
  }
  if (sample.scenario === 'low-zoom-preview' && !sample.error) {
    const zoom = sample.actionDetails?.zoom
    const lightweightNodeCount = sample.actionDetails?.settled?.lightweightCanvasNodes
    const lightweightPreviewCount = sample.actionDetails?.settled?.lightweightPreviewNodes
    if (!Number.isFinite(zoom) || zoom >= 0.4) {
      failures.push(`low-zoom scenario did not settle at the low-zoom target: ${zoom ?? 'unknown'}`)
    } else if (!Number.isFinite(lightweightNodeCount) || lightweightNodeCount < 1) {
      failures.push('low-zoom scenario did not mount any lightweight nodes')
    } else if (!Number.isFinite(lightweightPreviewCount) || lightweightPreviewCount < 1) {
      failures.push('low-zoom lightweight nodes rendered without any media preview')
    }
  }
  const settledSnapshots = [sample.cold?.settled, sample.actionDetails?.settled]
    .filter(Boolean)
    .concat(sample.scenario === 'reload-heavy' ? sample.actionDetails?.snapshots || [] : [])
  for (const snapshot of settledSnapshots) {
    if (snapshot.visibleMediaPending > 0) {
      failures.push(`${snapshot.visibleMediaPending} visible media nodes never reached a visible terminal state`)
      break
    }
  }
  return failures
}

export function evaluateScenarioVerdict({
  scenario,
  samples = [],
  hardFailures,
  budgetChecks = [],
  advisoryOnly = ADVISORY_ONLY_SCENARIOS.has(scenario),
  budgetsAreCalibratedForLeg = true,
  platform = os.platform(),
  longTaskCap = null,
} = {}) {
  const resolvedHardFailures =
    hardFailures ??
    samples.flatMap((sample) =>
      sampleHardFailures(sample, { platform, longTaskCap, advisoryOnly }).map((reason) => ({
        runIndex: sample.runIndex,
        reason,
      })),
    )
  const longTaskCounts = samples
    .map((sample) => sample?.probe?.longTasks)
    .filter((value) => Number.isFinite(value))
  const resolvedBudgetChecks =
    longTaskCap !== null && longTaskCounts.length > 0 && !budgetChecks.some((check) => check.metric === 'longTasks')
      ? [
          ...budgetChecks,
          (() => {
            const actualMax = Math.max(...longTaskCounts)
            return {
              metric: 'longTasks',
              actualMax,
              max: longTaskCap,
              pass: actualMax <= longTaskCap,
              advisory: advisoryOnly,
            }
          })(),
        ]
      : budgetChecks
  const gateBudgets = !advisoryOnly && budgetsAreCalibratedForLeg
  const pass =
    resolvedHardFailures.length === 0 &&
    (!gateBudgets || resolvedBudgetChecks.every((check) => check.advisory || check.pass))
  return {
    pass,
    advisoryOnly,
    budgetsAdvisory: !advisoryOnly && !budgetsAreCalibratedForLeg,
    hardFailures: resolvedHardFailures,
    budgetChecks: resolvedBudgetChecks,
  }
}

export function evaluateWarmupFailure(
  sample,
  {
    scale = sample?.scale,
    scenario = sample?.scenario,
    runIndex = sample?.runIndex,
    platform = os.platform(),
    longTaskCap = null,
    advisoryOnly = ADVISORY_ONLY_SCENARIOS.has(scenario),
  } = {},
) {
  const failures = sampleHardFailures(sample, { platform, longTaskCap, advisoryOnly })
  if (!failures.length) return null
  return {
    scale,
    scenario,
    runIndex,
    failures,
    advisoryOnly,
  }
}

export function evaluateBenchmarkPass({ summary = {}, warmupFailures = [] } = {}) {
  return warmupFailures.length === 0 && Object.values(summary).every((entry) => entry?.verdict?.pass === true)
}

export function applyPerformanceVerdict(results, processState = process) {
  const passed = results?.pass === true
  if (!passed) processState.exitCode = 1
  return passed
}
