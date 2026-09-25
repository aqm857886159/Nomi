// 核心流程冒烟（2026-09-22 用户拍板，docs/plan/2026-09-22-core-flow-smoke-three-defenses.md）：
// **除了纯文档，一律跑**，两种夹具各一遍。它不跟任何路径模式挂钩——09-22 那次回归坏在共享的 CSS 开关上，
// 画布套件因为「没改到 generationCanvas」被分类器跳过，核心流程三件事全坏、CI 全绿。
// 夹具清单的唯一 owner 在这里（CI matrix、合后收据要的 check 名都从它派生，check-quality-gate-workflow 钉死）。
export const CORE_SMOKE_FIXTURES = Object.freeze(['empty', 'used'])
// 阻断门只有 empty（2026-09-22 用户拍板）。used 照跑、照传证据，但**不判**：
// 实测同一份代码连跑 5 次只有 1 次全绿，三种失败都出自还没修的小窗布局问题
// （T-CV-19 批量栏压住缩放条 / T-CV-20 托盘贴边被 clamp / T-QA-21 toast 盖住弹窗钮），
// 证据见 docs/evidence/2026-09-22-core-smoke-negative-control/。把一条 5 次绿 1 次的检查
// 装成必过门 + 合后收据的 success-only，等于把假红制度化，这正是本防线要根除的东西。
// **升阻断的条件**：那三条布局 bug 修完，且 used 连跑 5 次全绿——届时把 'used' 加进下面这行即可，
// CI 的 continue-on-error 与合后收据都从它派生，不必再改别处。
export const CORE_SMOKE_BLOCKING_FIXTURES = Object.freeze(['empty'])
export const CORE_SMOKE_ADVISORY_FIXTURES = Object.freeze(CORE_SMOKE_FIXTURES.filter((f) => !CORE_SMOKE_BLOCKING_FIXTURES.includes(f)))
export const coreSmokeCheckName = (fixture) => `Core Flow Smoke (${fixture})`
export const CORE_SMOKE_CHECK_NAMES = Object.freeze(CORE_SMOKE_FIXTURES.map(coreSmokeCheckName))
export const CORE_SMOKE_BLOCKING_CHECK_NAMES = Object.freeze(CORE_SMOKE_BLOCKING_FIXTURES.map(coreSmokeCheckName))
export const CORE_SMOKE_ADVISORY_CHECK_NAMES = Object.freeze(CORE_SMOKE_ADVISORY_FIXTURES.map(coreSmokeCheckName))

const FULL_POLICY = Object.freeze({
  coreSmoke: true,
  unit: 'full',
  desktop: true,
  journeys: true,
  canvas: 'full',
  performance: true,
  package: true,
})

// Validation infrastructure changes exercise the gate itself. They still run
// the full functional lanes, but performance and packaging are separate risk
// surfaces and must not turn runner variance into an unrelated merge blocker.
const VALIDATION_INFRASTRUCTURE_POLICY = Object.freeze({
  coreSmoke: true,
  unit: 'full',
  desktop: true,
  journeys: true,
  canvas: 'full',
  performance: false,
  package: false,
})

const VALIDATION_INFRASTRUCTURE_PATTERNS = [
  /^\.github\/(?:actions|workflows)\//,
  /^scripts\/(?:validation-policy|select-quality-gate-profile|check-quality-gate-workflow|real-user-test-gates|test-system|test-focused|git-delivery|canvas-performance-verdict|eval-journey|.*walkthrough)(?:\.|$)/,
  /^tests\/system(?:\/|$)/,
  // 核心冒烟的清单 / 夹具 / 跑法：改它等于改每个 PR 都要过的那道闸。
  /^tests\/ux\/core-smoke\//,
  /^tests\/ux\/(?:canvas-real-suite|canvas-performance-(?:benchmark|verdict))(?:\.|$)/,
  // 走查的**共享 harness**（下划线前缀那一族：_launchApp / _assert / _canvasHit / _feel …）。
  // 它们是所有 Electron 走查的启动器、断言库和命中判据——改一行等于改全部走查的地基，
  // 可此前没有任何 pattern 认领它们，会被判成 isolated_change 走 focused（2026-09-12 补，
  // 判据与先红后绿的证据见 scripts/run-gates-tests.node-test.mjs）。下划线前缀是判据的一部分：
  // 具名走查脚本（tests/ux/smoke.e2e.mjs 等）只是单个场景，不该把整台机器拖进全量。
  /^tests\/ux\/_[^/]+\.(?:mjs|cjs|js|ts|mts)$/,
  /^(?:eslint|playwright|vitest)\.config\.(?:ts|mts|cts|js|mjs|cjs)$/,
]

// 纯文档判据（docs_only）的唯一 owner。docs/ 与 marketing/ 是整棵子树；根目录另有三族
// 只给人和 Agent 看、不进产物也不被任何运行时读取的文件：README*（含 README.zh-CN.md）、
// 以及根目录的 AGENTS.md / CLAUDE.md。后两个此前不在名单里，于是「只改一份 Agent 说明」
// 的 PR 被判成 isolated_change 而不是 docs_only，两格核心冒烟在纯文档 diff 上照跑
// （2026-09-22 #843 实测）。**只认根目录**：src/**/CLAUDE.md 那二十来份贴着代码住，
// 继续走 fail-safe 的常规判定，不在本条放宽范围内。
// 根目录其余 .md（CHANGELOG / CLA / Design / CODEX-REPORT / MARKET-RESEARCH）性质相同但
// 本次不放宽——漏判只是多跑一遍冒烟（安全方向），加进来才需要逐个论证没有门岗挂着它们。
const DOCS_ONLY_PATTERN = /^(?:docs\/|marketing\/|README[^/]*$|AGENTS\.md$|CLAUDE\.md$)/

const PACKAGE_PATTERNS = [
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.pnpmrc)$/,
  /^electron-builder(?:\.[^/]+)?\.(?:cjs|js|json|ya?ml)$/,
  /^vite\.config\.(?:ts|mts|cts|js|mjs|cjs)$/,
  /^tsconfig[^/]*\.json$/,
  /^electron\/(?:main|preload|runtimePaths|mainProcessLifecycle)\.(?:ts|tsx|js|mjs|cjs)$/,
  /^scripts\/(?:electron-install-identity|release-contract)(?:\.|$)/,
  // The packaged MCP smoke (dist:mac:dir) asserts the packaged server's behaviour and tool
  // surface. The truth sources of that surface — capability-core (catalog/collapse/stdio
  // server/launcher) and the harness tool-surface manifest — must select the package lane on
  // the PR path, or a surface change rides the fast path green and burns the next main push
  // (2026-09-02: surface-16-collapse escaped exactly this way; see docs/fixes/
  // 2026-09-02-packaged-mcp-smoke-stale-catalog-anchor.root-cause.json).
  /^electron\/capabilityCore\//,
  /^electron\/shared\/agentCapabilities\/(?:verbDeclarations\.ts$|verbs\/)/,
  // The smoke instrument itself: editing the packaged smoke must re-run the packaged smoke
  // (same rule as PERFORMANCE_INSTRUMENT_PATTERNS — instrument edits re-run the instrument).
  /^tests\/ux\/packaged-mcp-smoke/,
]

const JOURNEY_PATTERNS = [
  /^(?:tests\/agent-runtime|evals\/model-integration)(?:\/|$)/,
  /^skills\/model-integration(?:\/|$)/,
  // The resident Agent shell is the shared UI entry point for real user journeys;
  // keep this boundary explicit instead of relying on the filename's `Agent` token.
  /^src\/workbench\/ai\/ProjectAgentResidentShell\.(?:ts|tsx)$/i,
  // Two Agent-panel walks registered in REAL_USER_TEST_MANIFEST on 2026-09-24, and the display owners
  // they guard: `resident/` decides which pending call is a timeline plan (a hand-copied tool-name
  // list there rotted for ten days after the 2026-09-14 verb rename), `skillDisplay.ts` owns a
  // skill's on-screen name. Neither path name carries the `agent`/`model` token matched below.
  /^src\/workbench\/ai\/resident\//,
  /^src\/workbench\/skillLibrary\/skillDisplay\.ts$/,
  /^tests\/ux\/agent-(?:real-user-conversation|transcript-merge)\.walk\.mjs$/,
  /^electron\/(?:ai|catalog|comfyui|providerAdapter|vendor)(?:\/|$)/,
  /^electron\/runtime(?:\.|\/)/,
  /^src\/.*(?:agent|bridge|credential|model|provider|catalog|comfyui|network|security|generationCanvas\/runner).*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
  /^electron\/capabilityCore\/mcp.*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i,
  /^tests\/ux\/mcp-(?:l1-handshake|journey).*\.(?:mjs|js|ts)$/i,
  /^tests\/ux\/(?:resident-composer-receipt-fix|storyboard-agent-canonical-patch|production-mcp-journey|golden-path)\.(?:e2e\.)?mjs$/i,
]

const DESKTOP_PATTERNS = [/^src\/desktop\/bridge\.(?:ts|tsx|js|jsx)$/]

const CANVAS_PATTERNS = [
  /^src\/workbench\/generationCanvas(?:\/|$)/,
  /^src\/workbench\/settings\/CanvasGestureSection\.tsx$/,
  /^src\/utils\/canvasGesturePreference(?:\.test)?\.ts$/,
  /^tests\/ux\/.*(?:canvas|react-flow|group-(?:ports|baseline|reference)|selection-toolbar).*(?:\.mjs|\.js|\.ts)$/,
]

const FULL_CANVAS_PATTERNS = [
  /^src\/workbench\/generationCanvas\/reactFlow(?:\/|$)/,
  /^tests\/ux\/(?:canvas-real-suite|react-flow|canvas-drag-pan|group-ports|canvas-shortcuts|canvas-node-context|canvas-context-menu|canvas-batch|canvas-magnetic-handle|selection-toolbar|group-baseline|group-reference).*/,
]

const PERFORMANCE_PATTERNS = [
  /^src\/workbench\/generationCanvas\/reactFlow(?:\/|$)/,
  /^src\/workbench\/generationCanvas\/nodes\/(?:DeferredNodeMedia|deferredNodeMediaQueue|renderRegistry|BaseGenerationNode|ClipNode(?:Preview)?|NodeVideoPlaybackGuard|useNodeVideoHoverPreview|nodeSizing|nodeResultStackPlacement)(?:\.|\/)/,
  /^tests\/ux\/(?:canvas-performance|fixtures\/canvas-performance).*/,
  // 真实素材登记表与它的执行层（R13「四件真实」第④件，2026-09-14）。改登记表 = 改这条 lane 的输入：
  // 素材换一份、覆盖面动一类，画布与性能两条腿量到的东西就变了，必须当场重量一次，不能等下一个 PR。
  /^tests\/ux\/real-media-fixtures(?:\.|$)/,
  /^tests\/ux\/fixtures\/realMedia\.mjs$/,
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

// 每条 lane 只许往上抬、不许被后面的文件压回去：分档是「整个 diff 里风险最高的那个文件」决定的，
// 与文件在 diff 里的先后无关。canvas 是唯一的多档 lane（none < critical < full），
// 2026-09-22 之前它是直接赋值——reactFlow/ 文件先抬到 full，排在后面的普通画布文件又把它写回 critical，
// PR #833（改了 reactFlow 把手层级）因此跳过了 Canvas Acceptance，回归在 main 上才被下一个 PR 撞出来。
const CANVAS_LEVELS = Object.freeze(['none', 'critical', 'full'])

function raiseCanvas(policy, level) {
  if (CANVAS_LEVELS.indexOf(level) > CANVAS_LEVELS.indexOf(policy.canvas)) policy.canvas = level
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
  // Prove the whole diff is documentation before exempting deletion uncertainty.
  // Image extensions alone cannot distinguish docs from shipped/test assets;
  // renames retain fail-closed because an entry may omit the source path.
  const docsOnly = files.every(({ path, status }) =>
    /^(?:A|M|D)$/.test(status) && DOCS_ONLY_PATTERN.test(path),
  )
  const validationInfrastructure = files.filter((entry) =>
    matchesAny(entry.path, VALIDATION_INFRASTRUCTURE_PATTERNS),
  )
  const ambiguousStructuralChange = files.find(
    (entry) =>
      (entry.status.startsWith('D') || entry.status.startsWith('R')) &&
      !docsOnly &&
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
        coreSmoke: !docsOnly,
        unit: 'focused',
        desktop: false,
        journeys: false,
        canvas: 'none',
        performance: false,
        package: false,
        release: false,
        failClosed: false,
        reason: docsOnly ? 'docs_only' : 'isolated_change',
        reasons: [],
        files,
      }

  for (const { path } of files) {
    if (matchesAny(path, PERFORMANCE_INSTRUMENT_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      raiseCanvas(policy, 'full')
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
    if (matchesAny(path, CANVAS_PATTERNS)) {
      policy.unit = 'full'
      raiseCanvas(policy, matchesAny(path, FULL_CANVAS_PATTERNS) ? 'full' : 'critical')
      policy.reasons.push(`canvas:${path}`)
    }
    if (matchesAny(path, PERFORMANCE_PATTERNS)) {
      policy.unit = 'full'
      policy.desktop = true
      raiseCanvas(policy, 'full')
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
  'coreSmoke',
  'unit',
  'desktop',
  'journeys',
  'canvas',
  'performance',
  'package',
  'release',
  'failClosed',
])
