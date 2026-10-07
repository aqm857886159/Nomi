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
}
