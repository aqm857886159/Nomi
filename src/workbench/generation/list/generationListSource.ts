// 生成页列表的数据入口：读画布 + 分镜方案 → 列表投影；切行；在画布里定位一个节点。
// 只读、不写（写只在大详情的生成框里，经画布 store）。
import React from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { MEDIA_MEASUREMENT_META_KEYS } from '../../generationCanvas/nodes/nodeSizing'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
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

export const CARD_WIDTH = 256
export const CARD_MEDIA_HEIGHT = 144
export const CARD_GAP = 24
export const SIDE_PADDING = 32

/** 列数：卡片定宽 256、列间 24，按可用宽度能放几张放几张；放不下也给 1 列（留白优先，不拉伸卡片）。 */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width - SIDE_PADDING * 2 + CARD_GAP) / (CARD_WIDTH + CARD_GAP)))
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

const sameShallow = (left: Record<string, unknown>, right: Record<string, unknown>, ignore?: ReadonlySet<string>): boolean => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (ignore?.has(key)) continue
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}

/**
 * 列表关心的节点输入有没有变：画布上图片一张张解码完会往节点 meta 里写尺寸（运行时测量，不是内容），
 * 一个 200 节点的项目开着就是 200 次写入——每次都重排整张列表 + 重绘所有卡，第一次切到列表就卡 4~6 秒。
 * 位置 / 尺寸 / 测量字段不影响列表，忽略；其余任何字段变了都重算。
 */
export function sameListNodes(previous: readonly GenerationCanvasNode[], next: readonly GenerationCanvasNode[]): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false
  const skipNodeKeys = new Set(['position', 'size', 'meta'])
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]!
    const right = next[index]!
    if (left === right) continue
    if (!sameShallow(left as unknown as Record<string, unknown>, right as unknown as Record<string, unknown>, skipNodeKeys)) return false
    if (!sameShallow((left.meta ?? {}) as Record<string, unknown>, (right.meta ?? {}) as Record<string, unknown>, MEDIA_MEASUREMENT_META_KEYS)) return false
  }
  return true
}

/** 读画布 + 分镜方案 → 列表投影。只在列表真正关心的输入变化时重算。 */
export function useGenerationListModel(): GenerationListModel {
  const nodes = useStoreWithEqualityFn(useGenerationCanvasStore, (state) => state.nodes, sameListNodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const groups = useGenerationCanvasStore((state) => state.groups)
  const designsByDocumentId = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  const imageModelOptions = useModelOptionsState('image').options
  const videoModelOptions = useModelOptionsState('video').options
  return React.useMemo(
    () => deriveGenerationList({ nodes, edges, groups, designsByDocumentId, imageModelOptions, videoModelOptions }),
    [nodes, edges, groups, designsByDocumentId, imageModelOptions, videoModelOptions],
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

/** 这个分区「生成全部」要派发的节点：画布分组 = 组框的全部成员（与组工具条同一份）；分镜 / 未分组 = 分区里的卡。 */
export function sectionGenerateNodeIds(section: GenerationListSection): string[] {
  if (section.kind === 'group') {
    const group = useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === section.groupId)
    return group ? [...group.nodeIds] : []
  }
  return section.cards.map((card) => card.nodeId)
}
