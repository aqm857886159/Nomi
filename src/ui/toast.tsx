import React from 'react'
import type { NotificationData } from '@mantine/notifications'
import { notifications, notificationsStore } from '@mantine/notifications'
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
import { ToastMessage } from './ToastMessage'

// 全仓唯一通用 toast。统一走 @mantine/notifications 的单一容器（main.tsx 的 <Notifications/>）。
// 语义变体 showUndoToast（点击撤销）/ showInfoToast（一次性告知）也走同一容器，不再有本地并行 store/host。
export type ToastType = 'info' | 'success' | 'error' | 'warning'

/**
 * 「这条提示的前提还成不成立」。提示挂在屏上期间世界会变（失败的那张卡已经换家生成成功了、撤销的那笔编辑
 * 已经被别的途径撤掉了），一条前提不再成立的提示是一句**过期的话**——所以撤回它的责任在这里，靠**状态变化**触发，
 * 不靠定时器。producer 只说两件事：`subscribe`（前提可能变了就叫我一声，返回退订）、`isValid`（现在还成立吗）。
 * 本模块在 `isValid()` 变 false 时撤掉提示，并在提示消失（关闭 / 被撤 / 被同 id 的新提示替换）时退订。
 */
export type ToastValidity = Readonly<{
  isValid: () => boolean
  subscribe: (recheck: () => void) => () => void
}>

type Toast = {
  id: string
  message: React.ReactNode
  reason?: string
  count?: number
  type?: ToastType
  ttl?: number | false
  actionLabel?: string
  onAction?: () => void
  dismissible?: boolean
  /**
   * 这条提示描述的**那一次事件**的身份（如「某个节点的某一次失败」）。同一个 id 上再推来同一个 occurrence =
   * 同一件事被重新宣布（React effect 重跑、同一节点的两个控件实例各推一遍）：刷新内容，**不算再发生一次**，
   * 计数不涨；关掉过的 occurrence 不会再冒出来。不给 occurrence 的调用方照旧：每次 push 算一次发生。
   * 「×N」因此只在**真的又发生了 N 次**时出现，不再是「界面重画了 N 次」。
   */
  occurrence?: string
  /** 前提不再成立就撤回这条提示（见 ToastValidity）。 */
  validWhile?: ToastValidity
}

/**
 * 一条提示最高多高：窗口高度里让得出来的那一半（上下各留 4rem，limit=2 的两条叠起来也出不了窗口）。
 * 容器（NomiAppProviders 的 notificationMaxHeight）与 ToastMessage 的文字区读同一个数：容器管「整条不出窗」，
 * 文字区管「再长的话在上限里滚动，不被切掉」。
 */

/**
 * 正文至少多宽。再窄就成了一条竖缝（2026-09-30 截图：按钮占掉行宽的 40%，英文一行只剩约 20 个字符、中文约 11 个字）。
 * 动作按钮放不进这一行时，折到正文下面，而不是把正文挤窄——宽度归这一个数管，e2e 读的也是它。
 */
/** 动作按钮那一行（最多三行字 + 与正文的间距）在文字区最大高度里预留的高度：正文滚动，按钮不被挤出去。 */

type ToastInput = Omit<Toast, 'id' | 'message'> & ({ id: string; message: React.ReactNode } | { id?: string; message: string })

function toastColor(type?: ToastType): string {
  if (type === 'error') return 'var(--nomi-danger)'
  if (type === 'success') return 'var(--workbench-success)'
  if (type === 'warning') return 'var(--nomi-warning)'
  return 'var(--nomi-ink-40)'
}

function toastIcon(type?: ToastType): React.ReactNode {
  const props = { size: 17, stroke: 1.8, 'aria-hidden': true } as const
  if (type === 'error') return <IconAlertCircle {...props} />
  if (type === 'success') return <IconCircleCheck {...props} />
  if (type === 'warning') return <IconAlertTriangle {...props} />
  return <IconInfoCircle {...props} />
}

function defaultTtl(type?: ToastType): number {
  if (type === 'success') return 2600
  if (type === 'warning') return 5000
  if (type === 'error') return 6000
  return 3000
}

export function buildToastNotification(input: Toast & { onClose?: () => void }): NotificationData {
  const actionable = Boolean(input.actionLabel && input.onAction)
  const repeatedFailure = (input.count ?? 1) > 1 && (input.type === 'warning' || input.type === 'error')
  return {
    id: input.id,
    message: (
      <ToastMessage
        id={input.id}
        message={input.message}
        actionLabel={input.actionLabel}
        onAction={input.onAction}
        count={input.count}
      />
    ),
    icon: toastIcon(input.type),
    color: toastColor(input.type),
    autoClose: repeatedFailure ? false : input.ttl === undefined ? (actionable ? 8000 : defaultTtl(input.type)) : input.ttl,
    withCloseButton: repeatedFailure || (input.dismissible ?? (actionable || input.type === 'warning' || input.type === 'error')),
    withBorder: true,
    classNames: { root: 'min-w-[min(20rem,calc(100vw-1.5rem))]' },
    ...(input.onClose ? { onClose: input.onClose } : {}),
  }
}

// 提示的生命周期账（模块内、按 id）：谁在监视它的前提、哪一次事件已经被关掉。
// 「关掉过的事件不再冒出来」靠的是 occurrence 而不是 id：同一张卡的下一次失败是另一个 occurrence，照常弹。
const validityWatchers = new Map<string, () => void>()
const closedOccurrences = new Map<string, string>()
const CLOSED_OCCURRENCE_LIMIT = 200

function unwatch(id: string): void {
  const stop = validityWatchers.get(id)
  if (!stop) return
  validityWatchers.delete(id)
  try { stop() } catch { /* 退订失败不该影响提示本身 */ }
}

function watch(id: string, validity: ToastValidity | undefined): void {
  unwatch(id)
  if (!validity) return
  let stop: () => void
  try {
    // 前提变了就问一遍：判定本身抛了 = 证不出前提成立 = 撤回（宁可少一条提示，不留一条过期的话）。
    stop = validity.subscribe(() => {
      let valid = false
      try { valid = validity.isValid() } catch { /* 按不成立处理 */ }
      if (!valid) toastStore.remove(id)
    })
  } catch {
    return
  }
  validityWatchers.set(id, stop)
}

/** 提示消失了（关闭 / 撤回 / 到点）：不再监视，并记住这一次事件已经被关掉。 */
function settle(id: string, occurrence: string | undefined): void {
  unwatch(id)
  if (occurrence === undefined) return
  closedOccurrences.delete(id)
  closedOccurrences.set(id, occurrence)
  if (closedOccurrences.size > CLOSED_OCCURRENCE_LIMIT) {
    const oldest = closedOccurrences.keys().next().value
    if (oldest !== undefined) closedOccurrences.delete(oldest)
  }
}

const toastStore = {
  push(input: ToastInput): string {
    // Stable identity is supplied by contextual callers. Scalar legacy callers (including
    // frozen integrations) coalesce identical text; no random identities or second store.
    const id = input.id || `toast:${input.type ?? 'info'}:${typeof input.message === 'string' ? input.message : 'notice'}`
    // 这一次事件已经被用户（或前提失效）关掉了：同一个 occurrence 不再冒出来。
    if (input.occurrence !== undefined && closedOccurrences.get(id) === input.occurrence) return id
    const reason = input.reason ?? (typeof input.message === 'string' ? input.message : input.type ?? 'info')
    notifications.updateState(notificationsStore, (items) => {
      const previous = items.find((item) => item.id === id)
      const sameReason = previous?.['data-notification-reason'] === reason
      const sameOccurrence = input.occurrence !== undefined && previous?.['data-notification-occurrence'] === input.occurrence
      const previousCount = Number(previous?.['data-notification-count'] ?? 1)
      // 新原因 → 从 1 起算；同原因同事件 → 只是重新宣布，不涨；同原因新事件 → 又发生了一次。
      const count = !sameReason ? 1 : sameOccurrence ? previousCount : previousCount + 1
      const notification = {
        ...buildToastNotification({ ...input, id, count, onClose: () => settle(id, input.occurrence) }),
        'data-notification-reason': reason,
        'data-notification-count': count,
        ...(input.occurrence !== undefined ? { 'data-notification-occurrence': input.occurrence } : {}),
      }
      // Replace, do not merge: a new reason must not inherit an obsolete retry action.
      return previous ? items.map((item) => item.id === id ? notification : item) : [...items, notification]
    })
    watch(id, input.validWhile)
    return id
  },
  remove(id: string): void {
    try {
      notifications.hide(id)
    } catch {
      /* notifications 容器未挂载（如测试环境）→ 静默放行 */
    }
    // 容器没接住 hide（未挂载）时 onClose 不会来：退订不能依赖它。
    unwatch(id)
  },
}

export const useToastStore = Object.assign(
  <T,>(selector: (state: typeof toastStore) => T): T => selector(toastStore),
  { getState: () => toastStore },
)

export function toast(message: string, type?: ToastType, id?: string): void {
  toastStore.push({ message, type, ...(id ? { id } : {}) })
}
