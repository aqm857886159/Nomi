/**
 * 开屏动画 + 上手清单的持久标记（跨会话）。
 *
 * 走 localStorage（不进 workbenchStore——那边的持久化绑定项目存档）。
 * try/catch 守护：localStorage 不可用时 splash 退化为「已看过」
 *（避免每次都拦首启），清单退化为全 false。
 */

const SPLASH_KEY = 'nomi:splash:v1'
const CHECKLIST_KEY = 'nomi:checklist:v1'
const CHECKLIST_COLLAPSED_KEY = 'nomi:checklist-collapsed:v1'
const CHECKLIST_FIRST_SHOWN_KEY = 'nomi:checklist-first-shown:v1'
const CHECKLIST_DISMISSED_KEY = 'nomi:checklist-dismissed:v1'
const CANVAS_GESTURE_HINT_KEY = 'nomi:canvas-gesture-hint:v1'
const JOURNEY_TOUR_KEY = 'nomi:journey-tour:v1'

/** 上手清单生命周期上限：首次显示满 2 天仍未完成 → 自动永久关闭，不再回来。 */
export const CHECKLIST_TTL_MS = 2 * 24 * 60 * 60 * 1000

export function hasSeenCanvasGestureHint(): boolean {
  try {
    return window.localStorage.getItem(CANVAS_GESTURE_HINT_KEY) === 'seen'
  } catch {
    // localStorage 不可用：退化为「已看过」，不反复弹手势卡
    return true
  }
}

export function markCanvasGestureHintSeen(): void {
  try {
    window.localStorage.setItem(CANVAS_GESTURE_HINT_KEY, 'seen')
  } catch {
    /* ignore */
  }
}

export type ChecklistStep = 'model' | 'storyboard' | 'generated' | 'exported'
export type ChecklistState = Record<ChecklistStep, boolean>

const EMPTY: ChecklistState = { model: false, storyboard: false, generated: false, exported: false }

export function hasSeenSplash(): boolean {
  try {
    return window.localStorage.getItem(SPLASH_KEY) === 'seen'
  } catch {
    // localStorage 不可用：退化为「已看过」，不拦首启
    return true
  }
}

export function markSplashSeen(): void {
  try {
    window.localStorage.setItem(SPLASH_KEY, 'seen')
  } catch {
    /* ignore */
  }
}

export function readChecklist(): ChecklistState {
  try {
    const raw = window.localStorage.getItem(CHECKLIST_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<ChecklistState>
    return { ...EMPTY, ...parsed }
  } catch {
    return { ...EMPTY }
  }
}

export function markChecklistStep(step: ChecklistStep): void {
  try {
    const state = readChecklist()
    state[step] = true
    window.localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/**
 * 引导旅途（首页主动点的「60 秒看 Nomi 怎么出片」预置回放）是否看过。
 * 用于首页 CTA 文案在「看一遍 / 重看一遍」之间切换；不阻断、永远可重看。
 */
export function hasSeenJourneyTour(): boolean {
  try {
    return window.localStorage.getItem(JOURNEY_TOUR_KEY) === 'seen'
  } catch {
    return false
  }
}

export function markJourneyTourSeen(): void {
  try {
    window.localStorage.setItem(JOURNEY_TOUR_KEY, 'seen')
  } catch {
    /* ignore */
  }
}

/** 上手清单是否已永久关闭（用户点「不再提示」或满 2 天自动过期）。关了不再回来。 */
export function isChecklistDismissed(): boolean {
  try {
    return window.localStorage.getItem(CHECKLIST_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function markChecklistDismissed(): void {
  try {
    window.localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** 首次显示时间戳：仅第一次写入（已存在不覆盖），返回最终值。注入 now 便于测试。 */
export function ensureChecklistFirstShownAt(now: number): number {
  try {
    const raw = window.localStorage.getItem(CHECKLIST_FIRST_SHOWN_KEY)
    const existing = raw == null ? NaN : Number(raw)
    if (Number.isFinite(existing)) return existing
    window.localStorage.setItem(CHECKLIST_FIRST_SHOWN_KEY, String(now))
    return now
  } catch {
    return now
  }
}

/** 首次显示满 TTL（默认 2 天）即过期。从未记录首显 → 顺手记为 now，本次不算过期。 */
export function isChecklistExpired(now: number): boolean {
  const firstShown = ensureChecklistFirstShownAt(now)
  return now - firstShown >= CHECKLIST_TTL_MS
}

/** 清单折叠态（跨会话记住用户上次是否收起；默认展开）。 */
export function readChecklistCollapsed(): boolean {
  try {
    return window.localStorage.getItem(CHECKLIST_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeChecklistCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(CHECKLIST_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}
