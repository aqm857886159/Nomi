const FULL_POLICY = Object.freeze({
  unit: 'full',
  desktop: true,
  walkthroughs: true,
  journeys: true,
  canvas: 'full',
  performance: true,
  package: true,
})

// Validation infrastructure changes exercise the gate itself. They still run
// the full functional lanes, but performance and packaging are separate risk
// surfaces and must not turn runner variance into an unrelated merge blocker.
const VALIDATION_INFRASTRUCTURE_POLICY = Object.freeze({
  unit: 'full',
  desktop: true,
  walkthroughs: true,
  journeys: true,
  canvas: 'full',
  performance: false,
  package: false,
})

const VALIDATION_INFRASTRUCTURE_PATTERNS = [
  /^\.github\/(?:actions|workflows)\//,
  /^scripts\/(?:validation-policy|select-quality-gate-profile|check-quality-gate-workflow|test-system|test-focused|git-delivery|canvas-performance-verdict|eval-journey|.*walkthrough)(?:\.|$)/,
  /^tests\/system(?:\/|$)/,
  /^tests\/ux\/(?:canvas-real-suite|canvas-performance-(?:benchmark|verdict))(?:\.|$)/,
  /^(?:eslint|playwright|vitest)\.config\.(?:ts|mts|cts|js|mjs|cjs)$/,
]

const PACKAGE_PATTERNS = [
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.pnpmrc)$/,
  /^electron-builder(?:\.[^/]+)?\.(?:cjs|js|json|ya?ml)$/,
  /^vite\.config\.(?:ts|mts|cts|js|mjs|cjs)$/,
  /^tsconfig[^/]*\.json$/,
  /^electron\/(?:main|preload|runtimePaths|mainProcessLifecycle)\.(?:ts|tsx|js|mjs|cjs)$/,
  /^scripts\/(?:electron-install-identity|release-contract)(?:\.|$)/,
]

const JOURNEY_PATTERNS = [
  /^(?:tests\/agent-runtime|evals\/model-integration)(?:\/|$)/,
  /^skills\/model-integration(?:\/|$)/,
  /^electron\/(?:ai|catalog|comfyui|providerAdapter|vendor)(?:\/|$)/,
  /^electron\/runtime(?:\.|\/)/,
  /^src\/.*(?:agent|bridge|credential|model|provider|catalog|comfyui|network|security|generationCanvas\/runner).*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
  /^electron\/capabilityCore\/mcp.*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
  /^tests\/ux\/mcp-(?:l1-handshake|journey).*\.(?:mjs|js|ts)$/i,
]

const DESKTOP_PATTERNS = [/^src\/desktop\/bridge\.(?:ts|tsx|js|jsx)$/]

// CI 走查清单（tests/ux/ci-roster.mjs）那批走查真正依赖的面。独立成一档而不是挂 desktop：
// desktop 只认 electron/ 与 src/desktop/bridge.ts，**改 src/i18n 压根不会让它为 true** ——
// 而 roster 收的正是 i18n/locale/多用户那一簇，挂 desktop 等于它在最该跑的时候不跑
// （2026-09-02 加这档时实测发现的，此前 roster 步骤形同不存在）。
const WALKTHROUGH_PATTERNS = [
  /^src\/i18n(?:\/|$)/,                                    // 文案与首启 locale 探测
  /^src\/workbench\/(?:library|settings)(?:\/|$)/,          // 项目库起始页 + 设置对话框（语言归位后的入口）
  /^src\/workbench\/NomiAppBar/,                            // 工作台顶栏：多用户走查的语言态证据来源
  /^tests\/ux\/ci-roster\.mjs$/,                            // 清单本身变了就得重跑一遍
  /^tests\/ux\/(?:first-launch-system-locale|library-language-switcher|i18n-sweep|multi-user-isolation|workbench-en-overview)\.walk\.mjs$/,
]

const CANVAS_PATTERNS = [
  /^src\/workbench\/generationCanvas(?:\/|$)/,
  /^src\/workbench\/settings\/CanvasGestureSection\.tsx$/,
  /^src\/utils\/canvasGesturePreference(?:\.test)?\.ts$/,
  /^tests\/ux\/.*(?:canvas|react-flow|group-(?:ports|baseline|reference)|selection-toolbar).*(?:\.mjs|\.js|\.ts)$/,
]

const FULL_CANVAS_PATTERNS = [
  /^src\/workbench\/generationCanvas\/reactFlow(?:\/|$)/,
  /^tests\/ux\/(?:canvas-real-suite|react-flow|canvas-drag-pan|group-ports|canvas-shortcuts|canvas-node-context|canvas-context-menu|canvas-batch|selection-toolbar|group-baseline|group-reference).*/,
]

const PERFORMANCE_PATTERNS = [
  /^src\/workbench\/generationCanvas\/reactFlow(?:\/|$)/,
  /^src\/workbench\/generationCanvas\/nodes\/(?:DeferredNodeMedia|deferredNodeMediaQueue|renderRegistry|BaseGenerationNode|ClipNode(?:Preview)?|NodeVideoPlaybackGuard|useNodeVideoHoverPreview|nodeSizing|nodeResultStackPlacement)(?:\.|\/)/,
  /^tests\/ux\/(?:canvas-performance|fixtures\/canvas-performance).*/,
]

// Files that define the performance gate's own instrument: the benchmark that
// holds PERFORMANCE_BUDGETS and the platform calibration, the verdict applier,
// and this policy (which decides whether the perf lane runs at all). Editing the
// instrument must re-run the instrument on main code so a budget/calibration
// change is validated against a known baseline before it can merge — otherwise a
// mis-tuned ceiling ships unverified. These override the general validation-
// infrastructure carve-out (which normally suppresses the perf lane to keep
// runner variance from blocking unrelated infra changes).
const PERFORMANCE_INSTRUMENT_PATTERNS = [
  /^tests\/ux\/canvas-performance-benchmark(?:\.|$)/,
  /^scripts\/(?:canvas-performance-verdict|validation-policy)(?:\.|$)/,
]

function normalizePath(file) {
  return String(file || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
}

function normalizeEntries(changedFiles) {
  return changedFiles.map((entry) =>
    typeof entry === 'string'
      ? { status: 'M', path: normalizePath(entry) }
      : { status: String(entry.status || 'M'), path: normalizePath(entry.path) },
  )
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path))
}

function failClosed(files, reason, { release = false } = {}) {
  return {
    ...FULL_POLICY,
    release,
    failClosed: true,
    reason,
    reasons: [reason],
    files,
  }
}

export function classifyValidationPolicy(changedFiles, options = {}) {
  const files = normalizeEntries(changedFiles)
  const eventName = options.eventName || 'pull_request'
  const requestedMode = options.requestedMode || ''

  if (requestedMode === 'full') return failClosed(files, 'explicit_full_validation', { release: true })
  if (eventName === 'workflow_dispatch') {
    return failClosed(files, 'workflow_dispatch_release_boundary', { release: true })
  }
  if (files.length === 0) return failClosed(files, 'empty_diff_fail_closed')
  const validationInfrastructure = files.filter((entry) =>
    matchesAny(entry.path, VALIDATION_INFRASTRUCTURE_PATTERNS),
  )
  const ambiguousStructuralChange = files.find(
    (entry) =>
      (entry.status.startsWith('D') || entry.status.startsWith('R')) &&
      !matchesAny(entry.path, VALIDATION_INFRASTRUCTURE_PATTERNS),
  )
  if (ambiguousStructuralChange) {
    return failClosed(files, 'deletion_or_rename_fail_closed')
  }
  const policy = validationInfrastructure.length > 0
    ? {
        ...VALIDATION_INFRASTRUCTURE_POLICY,
        release: false,
        failClosed: true,
        reason: `validation_infrastructure:${validationInfrastructure[0].path}`,
        reasons: [`validation_infrastructure:${validationInfrastructure[0].path}`],
        files,
      }
    : {
        unit: 'focused',
        desktop: false,
        walkthroughs: false,
        journeys: false,
        canvas: 'none',
        performance: false,
        package: false,
        release: false,
        failClosed: false,
        reason: 'isolated_change',
        reasons: [],
        files,
      }

  for (const { path } of files) {
    if (matchesAny(path, PERFORMANCE_INSTRUMENT_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      policy.canvas = 'full'
      policy.performance = true
      policy.reasons.push(`performance-instrument:${path}`)
    }
    if (matchesAny(path, VALIDATION_INFRASTRUCTURE_PATTERNS)) continue
    if (path.startsWith('electron/')) {
      policy.unit = 'full'
      policy.desktop = true
      policy.reasons.push(`electron:${path}`)
    }
    if (matchesAny(path, JOURNEY_PATTERNS)) {
      policy.unit = 'full'
      policy.journeys = true
      policy.reasons.push(`journey:${path}`)
    }
    if (matchesAny(path, DESKTOP_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      policy.reasons.push(`desktop:${path}`)
    }
    if (matchesAny(path, WALKTHROUGH_PATTERNS)) {
      policy.walkthroughs = true
      policy.reasons.push(`walkthroughs:${path}`)
    }
    if (matchesAny(path, CANVAS_PATTERNS)) {
      policy.unit = 'full'
      policy.canvas = matchesAny(path, FULL_CANVAS_PATTERNS) ? 'full' : 'critical'
      policy.reasons.push(`canvas:${path}`)
    }
    if (matchesAny(path, PERFORMANCE_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      policy.canvas = 'full'
      policy.performance = true
      policy.reasons.push(`performance:${path}`)
    }
    if (matchesAny(path, PACKAGE_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      policy.package = true
      policy.reasons.push(`package:${path}`)
    }
  }

  policy.reasons = [...new Set(policy.reasons)]
  if (policy.reasons.length > 0) policy.reason = policy.reasons[0]
  return policy
}

export const VALIDATION_POLICY_OUTPUTS = Object.freeze([
  'unit',
  'desktop',
  'walkthroughs',
  'journeys',
  'canvas',
  'performance',
  'package',
  'release',
  'failClosed',
])
