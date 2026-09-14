// 画布性能门岗跑哪些场景，以及它的墙钟上限从哪来。
//
// 为什么这份清单要单独住一个模块：2026-09-15 #763 把门岗从 16 条场景加到 22 条，
// CI 的 `Canvas Performance (Linux)` 于是红在 `[canvas] medium-canvas-performance
// exceeded 1200000ms and was terminated`——不是任何一条预算断言越线（那一轮 20 条
// 场景各自的 verdict 都出来了），而是**整个 benchmark 进程被一条写死的 20 分钟砍掉**。
// 类根因是「上限是常数、工作量是变量」：加场景的人改的是 benchmark 里的数组，
// 砍进程的常数住在 canvas-real-suite 里，两处互不知情，所以每次加场景都会再踩一次。
//
// 修法（不是把 20 改成 40）：清单是唯一真相源，上限**由它的长度派生**。
// benchmark 和 suite 都从这里读 —— 加一条场景，上限自动多一格。
export const CANVAS_PERF_GATE_SCENARIOS = Object.freeze([
  'waiting-effects',
  'cold-open',
  'blank-pan',
  'node-drag-image',
  'node-drag-video',
  // eval v2 (U1): variable-speed + multi-select + LOD + dense-edge drag coverage.
  'multi-node-drag',
  'drag-nodes-all',
  'drag-group-frame-60',
  'zoom-slider-drag',
  'drag-at-low-zoom',
  'drag-over-dense-edges',
  'marquee-select',
  'click-select',
  'wheel-zoom',
  'pan-zoom-mix',
  'resize',
  'media-reveal',
  'low-zoom-preview',
  'media-error',
  'video-hover',
  'reload-heavy',
])

/**
 * 每条场景（warmup + sample）分到的墙钟。
 *
 * 数字来自实测而不是拍脑袋：run 34899530314（Linux/xvfb，`--scale M --runs 1`）在 20 分钟
 * 硬顶前跑完 20 条、死在第 21 条 `video-hover` 的采样里 —— 均值约 60 s/场景。CI 是软渲染，
 * 比 macOS 慢 1.3–2×（`docs/lessons/canvas-perf-budget-calibrated-on-macos-fails-on-linux.md`），
 * 而 `cold-open` / `reload-heavy` 这种带整轮重启的明显高于均值，所以取 90 s = 实测均值 ×1.5。
 *
 * 这不是性能预算 —— 预算是 `canvas-performance-verdict.mjs` 里那些帧间隔/长任务断言。
 * 这里只保证「进程别在还没跑完的时候被砍掉」：被砍掉的那一轮什么都证不了，
 * 既不是绿也不是红，只是没跑完。
 */
export const CANVAS_PERF_PER_SCENARIO_BUDGET_MS = 90_000
/** 起 Electron、建夹具、写报告：与场景条数无关的固定开销（实测 ~80 s，留到 2 分钟）。 */
export const CANVAS_PERF_FIXED_OVERHEAD_MS = 2 * 60_000

/** 门岗那条 scenario 的墙钟上限 = 固定开销 + 每条场景的预算 × 条数。 */
export function canvasPerfGateTimeoutMs(scenarios = CANVAS_PERF_GATE_SCENARIOS) {
  return CANVAS_PERF_FIXED_OVERHEAD_MS + CANVAS_PERF_PER_SCENARIO_BUDGET_MS * scenarios.length
}
