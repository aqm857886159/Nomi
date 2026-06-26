import { notifications } from '@mantine/notifications'

// 全仓唯一通用 toast。统一走 @mantine/notifications 的单一容器（main.tsx 的 <Notifications/>）。
// 语义变体 showUndoToast（点击撤销）/ showInfoToast（一次性告知）也走同一容器，不再有本地并行 store/host。
type ToastType = 'info' | 'success' | 'error' | 'warning'
type Toast = {
  id: string
  message: string
  type?: ToastType
  ttl?: number
  actionLabel?: string
  onAction?: () => void
}

type ToastInput = Omit<Toast, 'id'> & { id?: string }

function toastColor(type?: ToastType): string {
  return type === 'error' ? 'red' : type === 'success' ? 'teal' : type === 'warning' ? 'yellow' : 'gray'
}

const toastStore = {
  items: [] as Toast[],
  push(input: ToastInput): string {
    const id = input.id || `toast:${Date.now()}:${Math.random().toString(36).slice(2)}`
    try {
      notifications.show({
        id,
        message: input.actionLabel ? `${input.message} · ${input.actionLabel}` : input.message,
        color: toastColor(input.type),
        autoClose: input.ttl,
        onClick: input.onAction,
      })
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

export function toast(message: string, type?: ToastType): void {
  try {
    notifications.show({ message, color: toastColor(type) })
  } catch {
    /* notifications 容器未挂载（如测试环境）→ 静默放行 */
  }
}

export function ToastHost(): JSX.Element | null {
  return null
}
