import React from 'react'

/**
 * 「贴着节点弹出的面板」与该节点生成面板（composer）的互斥规矩——**唯一出处**。
 *
 * 选中的生成类节点下沿本来就挂着自己的生成面板；再有一块面板也贴着同一条下沿弹出（剪辑面板……），两块叠在一起，
 * 后者的左右两侧会露出前者一截。规矩：同一个节点上有「附着面板」打开时，它的生成面板**收起（不挂）**，面板关掉就恢复——
 * 不是用 z-index 盖住（盖住 ≠ 不在：编辑器、参考区订阅都还在跑，也还会从边上漏出来）。
 *
 * 用法：附着面板在自己的组件里调一次 `useNodeAttachedPanel(nodeId)`（挂载期间算打开，卸载即关——取消选中、
 * 切走、关面板都是卸载）；节点读 `useHasNodeAttachedPanel(nodeId)`。纯会话态，不进项目、不落盘。
 */
const open = new Map<string, number>()
const listeners = new Set<() => void>()
const emit = (): void => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useNodeAttachedPanel(nodeId: string): void {
  React.useEffect(() => {
    open.set(nodeId, (open.get(nodeId) ?? 0) + 1)
    emit()
    return () => {
      const next = (open.get(nodeId) ?? 1) - 1
      if (next <= 0) open.delete(nodeId)
      else open.set(nodeId, next)
      emit()
    }
  }, [nodeId])
}

export function useHasNodeAttachedPanel(nodeId: string): boolean {
  return React.useSyncExternalStore(subscribe, () => open.has(nodeId), () => false)
}
