/**
 * 撤销 toast — 用于跨分类拖拽创建独立副本场景（spec §6.6 / 决策 3）。
 *
 * 触发：跨分类拖拽完成、跨分类 Cmd+V 粘贴。
 * 行为：5 秒内可点击 toast 任意位置 = 撤销（删除刚创建的副本节点）；
 *      5 秒后自动消失，副本永久保留。
 *
 */
import { useToastStore } from '../ui/toast'
import i18n from '../i18n'

export type UndoToastOptions = {
  message: string
  onUndo: () => void
  durationMs?: number
  /**
   * 这次撤销现在还成立吗？返回 false = 这笔编辑已经被别的途径撤掉了，
   * 此时点「撤销」会撤到**别人头上**，所以整个动作作废（连 toast 一起收掉）。
   *
   * 不给就是「永远可撤」——只适用于撤销目标不会被外部改动的场景。
   */
  isUndoable?: () => boolean
  /**
   * 订阅「撤销目标可能失效」的变化源，用于在失效时**主动收掉这张 toast**。
   * 返回退订函数。只在配了 `isUndoable` 时有意义。
   *
   * 为什么需要它：只在点击时拦，会留下一个点了没反应的哑巴按钮——
   * 用户看到的是「撤销坏了」。失效就让它消失，才是诚实的界面。
   */
  watchUndoable?: (recheck: () => void) => () => void
}

const DEFAULT_DURATION_MS = 5000

export function showUndoToast({
  message,
  onUndo,
  durationMs = DEFAULT_DURATION_MS,
  isUndoable,
  watchUndoable,
}: UndoToastOptions): void {
  let consumed = false
  let unwatch: (() => void) | undefined
  const stopWatching = () => {
    if (!unwatch) return
    const dispose = unwatch
    unwatch = undefined
    try { dispose() } catch { /* 退订失败不该影响 toast 行为 */ }
  }

  // 判定本身抛了 = 证不出「撤的是自己那笔」= 按不可撤处理。
  // 宁可少撤一次，也不能误撤别人的成果。
  const stillUndoable = (): boolean => {
    if (!isUndoable) return true
    try { return isUndoable() } catch { return false }
  }

  const id = useToastStore.getState().push({
    message,
    type: 'success',
    ttl: durationMs,
    actionLabel: i18n.t('common.undo'),
    onAction: () => {
      if (consumed) return
      // 过期判定放在**点击那一刻**：toast 挂在屏上期间世界会变，
      // 弹出时可撤不代表 8 秒后还可撤。这里失败就静默作废，
      // 绝不退化成「无条件弹一层撤销栈」——那正是会误伤别人成果的写法。
      if (!stillUndoable()) {
        consumed = true
        stopWatching()
        useToastStore.getState().remove(id)
        return
      }
      consumed = true
      stopWatching()
      try { onUndo() } catch { /* swallow undo failures, toast UI 已消失 */ }
    },
  })

  if (isUndoable && watchUndoable) {
    unwatch = watchUndoable(() => {
      if (consumed) return
      if (stillUndoable()) return
      // 失效了：收掉这张 toast，连同它那个已经撤不动的按钮。
      consumed = true
      stopWatching()
      useToastStore.getState().remove(id)
    })
    // toast 自己到点消失后订阅也该停，别把监听留到天荒地老。
    if (typeof durationMs === 'number' && durationMs > 0) {
      setTimeout(stopWatching, durationMs)
    }
  }
}
