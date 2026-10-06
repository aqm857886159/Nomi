// 打开项目的主进程分阶段打点（Node perf_hooks 的 User Timing，与渲染层 src/workbench/project/projectOpenTimeline.ts 同名同前缀）。
// 开关：环境变量 NOMI_PERF_MARKS=1（真实规模性能跑器起 App 时给）；关着时每个调用只是一次布尔判断，产品默认零开销。
// 跑器经 app.evaluate 读 performance.getEntriesByType('measure')，按前缀取。
import { performance } from "node:perf_hooks";

const enabled = process.env.NOMI_PERF_MARKS === "1";

export const PROJECT_OPEN_MAIN_PREFIX = "nomi:open:main:";

export type ProjectOpenMainStage = "read-project" | "lane-identity" | "lane-legacy-migration" | "lane-workspace-open";

export async function measureProjectOpenMainStage<T>(stage: ProjectOpenMainStage, run: () => Promise<T> | T): Promise<T> {
  if (!enabled) return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    performance.measure(`${PROJECT_OPEN_MAIN_PREFIX}${stage}`, { start, end: performance.now() });
  }
}

export function measureProjectOpenMainStageSync<T>(stage: ProjectOpenMainStage, run: () => T): T {
  if (!enabled) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    performance.measure(`${PROJECT_OPEN_MAIN_PREFIX}${stage}`, { start, end: performance.now() });
  }
}
