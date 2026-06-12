/**
 * 工作台三步引导的「已看过」标记 + 启动请求信号。
 *
 * 标记走 localStorage（跨会话持久，不进 workbenchStore——那边的持久化绑定项目存档）。
 * 启动请求用「模块级 pending + window 事件」双轨：tryExample 在 WorkbenchTour 挂载前
 * 就会发请求（建项目 → 切视图 → shell 才挂载），pending 让挂载后还能消费到。
 */

const TOUR_FLAG_KEY = 'nomi:tour:v1'

export const WORKBENCH_TOUR_REQUEST_EVENT = 'nomi-workbench-tour-request'

export type WorkbenchTourFlag = 'done' | 'skipped'

export function readWorkbenchTourFlag(): WorkbenchTourFlag | null {
  try {
    const value = window.localStorage.getItem(TOUR_FLAG_KEY)
    return value === 'done' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

export function writeWorkbenchTourFlag(flag: WorkbenchTourFlag): void {
  try {
    window.localStorage.setItem(TOUR_FLAG_KEY, flag)
  } catch {
    /* localStorage 不可用时引导退化为每次可见，不致命 */
  }
}

let pendingRequest = false

/** 请求开启引导（30 秒体验建完示例项目后调用）。已看过的用户由 WorkbenchTour 端过滤。 */
export function requestWorkbenchTour(): void {
  pendingRequest = true
  window.dispatchEvent(new CustomEvent(WORKBENCH_TOUR_REQUEST_EVENT))
}

export function consumeWorkbenchTourRequest(): boolean {
  const had = pendingRequest
  pendingRequest = false
  return had
}
