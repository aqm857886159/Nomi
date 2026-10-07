// 画布上此刻铺开的版本宫格占着哪些地方（画布坐标）——给「被压住的邻居先藏标题」用（09-28 样张第 7 条）。
//
// 只是渲染层的派生量：每个铺开的宫格在布局后登记自己的格子，收起 / 卸载时撤销登记。不进画布 store、不存盘
// （放置方向是渲染时按可见画布算的，见 versionGridLayout.chooseVersionGridPlacement）。
// 读的一方（每个节点）只关心一个布尔：「我的标题条被别人的宫格压住没有」，所以订阅按布尔去重，
// 宫格变了也只有真的被压住 / 不再被压住的那几个节点重渲。
import React from 'react'
import { isNodeLabelCoveredByGrid } from './versionGridLayout'

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>
type Coverage = Readonly<{ origin: Readonly<{ x: number; y: number }>; cells: readonly Rect[] }>

const coverageByNode = new Map<string, Coverage>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function publishVersionGridCoverage(nodeId: string, coverage: Coverage | null): void {
  if (coverage) coverageByNode.set(nodeId, coverage)
  else if (!coverageByNode.delete(nodeId)) return
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isLabelCoveredByOtherGrids(nodeId: string, rect: Rect): boolean {
  for (const [ownerId, coverage] of coverageByNode) {
    if (ownerId === nodeId) continue
    if (isNodeLabelCoveredByGrid(rect, coverage.origin, coverage.cells)) return true
  }
  return false
}

/** 这个节点的标题条此刻是不是被别的节点铺开的宫格压住了。`enabled = false`（选中 / 自己铺开）时恒为 false。 */
export function useLabelCoveredByVersionGrid(nodeId: string, rect: Rect, enabled: boolean): boolean {
  const { x, y, width, height } = rect
  const getSnapshot = React.useCallback(
    () => (enabled && coverageByNode.size > 0 ? isLabelCoveredByOtherGrids(nodeId, { x, y, width, height }) : false),
    [enabled, nodeId, x, y, width, height],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function __resetVersionGridCoverageForTests(): void {
  coverageByNode.clear()
  openOrder.length = 0
}

const openOrder: string[] = []

/**
 * 登记「这一组铺开了」（只跟铺开 / 收起走，格子重排、节点挪动不动顺序）。返回撤销登记。
 * 按 Esc 收最后铺开的那一组：一次 Esc 收一组，和点一次角标一样。
 */
export function registerOpenVersionGrid(nodeId: string): () => void {
  const existing = openOrder.indexOf(nodeId)
  if (existing >= 0) openOrder.splice(existing, 1)
  openOrder.push(nodeId)
  return () => {
    const index = openOrder.indexOf(nodeId)
    if (index >= 0) openOrder.splice(index, 1)
  }
}

export function lastOpenedVersionGrid(): string | null {
  return openOrder.length ? openOrder[openOrder.length - 1] : null
}

/**
 * 这一下 Esc 归不归版本宫格：正在输入框 / 提示词框（可编辑区）里打字时归输入框；弹层（预览、对话框）里按的归弹层；
 * 已经被别人处理掉（defaultPrevented）的不管。焦点在画布空白处、角标、宫格里都算。
 */
export function escapeBelongsToVersionGrid(event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing' | 'target'>): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return false
  const target = event.target
  if (!target || typeof (target as Element).closest !== 'function') return true
  const element = target as Element
  if (element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false
  return !element.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
}
