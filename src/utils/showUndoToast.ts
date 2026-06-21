/**
 * 撤销 toast — 用于跨分类拖拽创建独立副本场景（spec §6.6 / 决策 3）。
 *
 * 触发：跨分类拖拽完成、跨分类 Cmd+V 粘贴。
 * 行为：5 秒内可点击 toast 任意位置 = 撤销（删除刚创建的副本节点）；
 *      5 秒后自动消失，副本永久保留。
 *
 */
import { useToastStore } from '../ui/toast'

export type UndoToastOptions = {
  message: string
  onUndo: () => void
  durationMs?: number
}

const DEFAULT_DURATION_MS = 5000

export function showUndoToast({ message, onUndo, durationMs = DEFAULT_DURATION_MS }: UndoToastOptions): void {
  let consumed = false

  useToastStore.getState().push({
    message,
    type: 'success',
    ttl: durationMs,
    actionLabel: '撤销',
    onAction: () => {
      if (consumed) return
      consumed = true
      try { onUndo() } catch { /* swallow undo failures, toast UI 已消失 */ }
    },
  })
}
