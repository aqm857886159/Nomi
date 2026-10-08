// 生成页列表的数据入口：读画布 + 分镜方案 → 列表投影；切行；在画布里定位一个节点。
// 只读、不写（写只在检查器的生成框里，经画布 store）。
import React from 'react'
import { useModelOptionsState } from '../../../config/useModelOptions'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { FOCUS_GENERATION_NODE_EVENT } from '../../generationCanvas/nodes/nodeSizing'
import { focusCanvasNodeWhenReady } from '../../deepLinkFocus'
import { deriveGenerationList, type GenerationListCard, type GenerationListModel, type GenerationListSection } from './generationListModel'
import { useGenerationViewStore } from './generationViewStore'

export type ListRow =
  | { kind: 'header'; key: string; section: GenerationListSection }
  | { kind: 'cards'; key: string; section: GenerationListSection; cards: GenerationListCard[] }
  | { kind: 'assets'; key: string; nodeIds: string[] }

/** 列数跟着列表可用宽度走（样张：宽屏 4 列、常规 3 列、开着检查器 2 列）。 */
export function columnsFor(width: number): number {
  if (width >= 1440) return 4
  if (width >= 900) return 3
  if (width >= 520) return 2
  return 1
}

export function buildListRows(model: GenerationListModel, columns: number, collapsed: ReadonlySet<string>): ListRow[] {
  const rows: ListRow[] = []
  for (const section of model.sections) {
    rows.push({ kind: 'header', key: `h:${section.key}`, section })
    if (collapsed.has(section.key)) continue
    for (let index = 0; index < section.cards.length; index += columns) {
      rows.push({ kind: 'cards', key: `c:${section.key}:${index}`, section, cards: section.cards.slice(index, index + columns) })
    }
    if (section.unreferencedAssetIds.length) rows.push({ kind: 'assets', key: `a:${section.key}`, nodeIds: section.unreferencedAssetIds })
  }
  return rows
}

/** 读画布 + 分镜方案 → 列表投影。只在引用变化时重算。 */
export function useGenerationListModel(): GenerationListModel {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const groups = useGenerationCanvasStore((state) => state.groups)
  const designsByDocumentId = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  const filter = useGenerationViewStore((state) => state.listFilter)
  const imageModelOptions = useModelOptionsState('image').options
  const videoModelOptions = useModelOptionsState('video').options
  return React.useMemo(
    () => deriveGenerationList({ nodes, edges, groups, designsByDocumentId, filter, imageModelOptions, videoModelOptions }),
    [nodes, edges, groups, designsByDocumentId, filter, imageModelOptions, videoModelOptions],
  )
}

/** 切回画布并定位这个节点（现役 FOCUS_GENERATION_NODE_EVENT：切分类、选中、居中）。 */
export function viewNodeInCanvas(nodeId: string): void {
  useGenerationViewStore.getState().setView('canvas')
  void focusCanvasNodeWhenReady({
    nodeId,
    hasNode: () => useGenerationCanvasStore.getState().nodes.some((node) => node.id === nodeId),
    dispatch: (id) => window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: id } })),
    waitFrame: () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
  })
}

/**
 * 列表第一行的左内边距：视图切换钮浮在画布区左上（与画布态同一个屏幕位置，不占一行），
 * 面板第一行从它右边开始，不被它盖住。面板左缘 16px + 这里 48px = 64px，切换钮右缘约 56px。
 */
export const LEAD_INSET = 'pl-12'
