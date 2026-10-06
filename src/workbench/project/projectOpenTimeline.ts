/**
 * 打开项目的分阶段打点（W3C User Timing：performance.mark / measure，不自造计时器）。
 *
 * 用途：真实规模性能跑器（tests/ux/project-open-stages.e2e.mjs）把「点项目 → 画布出现 → 第一张图出来」
 * 拆成阶段：读项目 → 迁移 → 写进画布 store → 提交画布读面 → 打开右侧 Agent → 画布可见 → React Flow 挂上节点
 * → 第一张图解码完成。主进程那一侧的同名阶段在 electron/projects/projectOpenTimeline.ts。
 *
 * 开关：localStorage `nomi:perf-marks` = '1' 时才记（跑器起 App 前预埋）。关着时每个调用只是一次布尔判断，
 * 不建条目、不占内存——产品默认零开销。
 */
const PERF_MARKS_KEY = 'nomi:perf-marks'

function readEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(PERF_MARKS_KEY) === '1'
  } catch {
    return false
  }
}

const enabled = readEnabled()

/** 打点开关（模块加载时读一次）：给只在打开时才挂载的探针组件用。 */
export const projectOpenTimelineEnabled = enabled

/** 阶段名统一加前缀，跑器按前缀取，别的 User Timing 条目混不进来。 */
export const PROJECT_OPEN_PREFIX = 'nomi:open:'

export type ProjectOpenStage =
  | 'read-project'
  | 'migrate'
  | 'save-migrated'
  | 'restore-store'
  | 'replay-events'
  | 'canvas-read-commit'
  | 'agent-lane-open'
  | 'receipt-recovery'

export type ProjectOpenMoment = 'start' | 'studio-visible' | 'flow-nodes-mounted' | 'first-media-decoded'

let moments = new Set<ProjectOpenMoment>()

/** 一次打开的起点：清掉上一次的「只记第一次」状态。 */
export function markProjectOpenStart(): void {
  if (!enabled) return
  moments = new Set(['start'])
  // 只清自己的条目：别的 User Timing 用户（将来的 React Profiler、DevTools）不受影响。
  for (const entry of performance.getEntries()) {
    if (!entry.name.startsWith(PROJECT_OPEN_PREFIX)) continue
    if (entry.entryType === 'mark') performance.clearMarks(entry.name)
    else if (entry.entryType === 'measure') performance.clearMeasures(entry.name)
  }
  performance.mark(`${PROJECT_OPEN_PREFIX}start`)
}

/** 本次打开里某个时刻只记第一次（例如第一张图解码完成），之后的同名调用直接忽略。 */
export function markProjectOpenMoment(moment: Exclude<ProjectOpenMoment, 'start'>): void {
  if (!enabled || !moments.has('start') || moments.has(moment)) return
  moments.add(moment)
  performance.mark(`${PROJECT_OPEN_PREFIX}${moment}`)
  performance.measure(`${PROJECT_OPEN_PREFIX}to:${moment}`, `${PROJECT_OPEN_PREFIX}start`, `${PROJECT_OPEN_PREFIX}${moment}`)
}

/** 包住一个阶段，记它从开始到结束（含等主进程的时间）。失败照样记，阶段名带 `:failed`。 */
export async function measureProjectOpenStage<T>(stage: ProjectOpenStage, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run()
  const start = performance.now()
  let failed = false
  try {
    return await run()
  } catch (error) {
    failed = true
    throw error
  } finally {
    performance.measure(`${PROJECT_OPEN_PREFIX}${stage}${failed ? ':failed' : ''}`, { start, end: performance.now() })
  }
}

/** 同步阶段（例如把项目写进画布 store）。 */
export function measureProjectOpenStageSync<T>(stage: ProjectOpenStage, run: () => T): T {
  if (!enabled) return run()
  const start = performance.now()
  try {
    return run()
  } finally {
    performance.measure(`${PROJECT_OPEN_PREFIX}${stage}`, { start, end: performance.now() })
  }
}
