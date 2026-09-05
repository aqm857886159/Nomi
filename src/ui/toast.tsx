import React from 'react'
import type { NotificationData } from '@mantine/notifications'
import { notifications } from '@mantine/notifications'
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'

// 全仓唯一通用 toast。统一走 @mantine/notifications 的单一容器（main.tsx 的 <Notifications/>）。
// 语义变体 showUndoToast（点击撤销）/ showInfoToast（一次性告知）也走同一容器，不再有本地并行 store/host。
type ToastType = 'info' | 'success' | 'error' | 'warning'
type Toast = {
  id: string
  message: React.ReactNode
  type?: ToastType
  ttl?: number | false
  actionLabel?: string
  onAction?: () => void
  dismissible?: boolean
}

type ToastInput = Omit<Toast, 'id'> & { id?: string }

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

function ToastMessage({
  id,
  message,
  actionLabel,
  onAction,
}: Pick<Toast, 'id' | 'message' | 'actionLabel' | 'onAction'>): JSX.Element {
  const handleAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    notifications.hide(id)
    onAction?.()
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 text-body-sm text-nomi-ink-80">{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={handleAction}
          className="shrink-0 rounded-nomi-sm bg-nomi-accent-soft px-2 py-1 text-caption font-semibold text-nomi-accent hover:bg-nomi-ink-10"
        >
          {actionLabel}
        </button>
      ) : null}
    </span>
  )
}

export function buildToastNotification(input: Toast): NotificationData {
  const actionable = Boolean(input.actionLabel && input.onAction)
  return {
    id: input.id,
    message: (
      <ToastMessage
        id={input.id}
        message={input.message}
        actionLabel={input.actionLabel}
        onAction={input.onAction}
      />
    ),
    icon: toastIcon(input.type),
    color: toastColor(input.type),
    autoClose: input.ttl === undefined ? (actionable ? 8000 : defaultTtl(input.type)) : input.ttl,
    withCloseButton: input.dismissible ?? (actionable || input.type === 'warning' || input.type === 'error'),
    withBorder: true,
  }
}

const toastStore = {
  items: [] as Toast[],
  push(input: ToastInput): string {
    const id = input.id || `toast:${Date.now()}:${Math.random().toString(36).slice(2)}`
    try {
      const notification = buildToastNotification({ ...input, id })
      if (input.id) {
        // Mantine update() 即使没有匹配项也会返回传入的 id，不能用返回值判断是否存在。
        // show() 对重复 id 幂等：先更新可见/排队项，再补齐首次出现的稳定 id。
        notifications.update(notification)
      }
      notifications.show(notification)
    } catch {
      /* notifications 容器未挂载（如测试环境）→ 静默放行 */
    }
    return id
  },
  remove(id: string): void {
    try {
      notifications.hide(id)
    } catch {
      /* notifications 容器未挂载（如测试环境）→ 静默放行 */
    }
  },
}

export const useToastStore = Object.assign(
  <T,>(selector: (state: typeof toastStore) => T): T => selector(toastStore),
  { getState: () => toastStore },
)

export function toast(message: string, type?: ToastType, id?: string): void {
  toastStore.push({ message, type, ...(id ? { id } : {}) })
}
