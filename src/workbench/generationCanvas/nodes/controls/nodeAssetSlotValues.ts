import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import {
  resolveParameterReferenceAssignments,
  type ImageUrlSlot,
  type ParameterReferenceAssignment,
} from '../../model/parameterReferenceSlots'
import { firstFrameTaggedSlot, resolveReferencePlacement } from '../../runner/referenceSlots'
import {
  type ArchetypeArraySlot,
  type effectiveArchetypeMode,
  readArchetypeArray,
  referenceSlotStorage,
  type archetypeModeSourceVideoSlot,
} from './archetypeMeta'
import type { archetypeModeSlotReachByKey } from './channelModeReach'
import { getSlotNodeRef, getSlotThumbUrl, readMeta, resultPreviewUrl } from './parameterControlModel'

type ArchMode = NonNullable<ReturnType<typeof effectiveArchetypeMode>>['mode']
type SourceVideoSlot = ReturnType<typeof archetypeModeSourceVideoSlot>
type ResolvedPlacement = ReturnType<typeof resolveReferencePlacement>
type SlotReachByKey = ReturnType<typeof archetypeModeSlotReachByKey>

/**
 * 节点参考槽当前值与已占用位置数的唯一投影（从 NodeParameterControls 拆出以保持壳文件精简）：
 * 档案节点由 `resolveReferencePlacement`（边 + 上传单一真相源）派生；非档案模型沿用参数边与 meta 回退。
 */
export function resolveNodeAssetSlotValues({
  node,
  nodes,
  edges,
  meta,
  archMode,
  slotReachByKey,
  imageUrlSlots,
  arraySlots,
  sourceVideoSlot,
}: {
  node: GenerationCanvasNode
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  meta: Record<string, unknown>
  archMode: ArchMode | null
  slotReachByKey: SlotReachByKey
  imageUrlSlots: readonly ImageUrlSlot[]
  arraySlots: readonly ArchetypeArraySlot[]
  sourceVideoSlot: SourceVideoSlot
}): {
  referencePlacement: ResolvedPlacement
  firstFrameSlotKey: string | undefined
  arrayOccupiedByKey: Map<string, number>
  assetValuesByKey: Record<string, string | string[]>
  parameterAssignments: ParameterReferenceAssignment[]
} {
  const resolvedFillUrlsByMetaKey = new Map<string, string[]>()
  let firstFrameSlotKey: string | undefined
  const arrayOccupiedByKey = new Map<string, number>()

  const referencePlacement: ResolvedPlacement = archMode
    ? resolveReferencePlacement(node, nodes, edges, {
        capOf: (slot) => {
          const storage = referenceSlotStorage(slot)
          const reach = storage ? slotReachByKey[storage.metaKey] : undefined
          return reach === 'none' ? 0 : reach === 'single' ? 1 : undefined
        },
      })
    : { slots: [], unused: [], parked: [] }

  if (archMode) {
    const resolvedSlots = referencePlacement.slots
    const taggedSlot = firstFrameTaggedSlot(resolvedSlots)
    for (const rs of resolvedSlots) {
      const storage = referenceSlotStorage({ kind: rs.slotKind })
      if (storage) {
        resolvedFillUrlsByMetaKey.set(
          storage.metaKey,
          rs.fills.map((f) => f.url).filter((u): u is string => Boolean(u)),
        )
        arrayOccupiedByKey.set(storage.metaKey, rs.fills.length)
        if (rs === taggedSlot) firstFrameSlotKey = storage.metaKey
      }
    }
  }

  const assetValuesByKey: Record<string, string | string[]> = {}
  const parameterAssignments = resolveParameterReferenceAssignments(node, nodes, edges, [...imageUrlSlots])
  for (const s of imageUrlSlots) {
    if (archMode && resolvedFillUrlsByMetaKey.has(s.key)) {
      assetValuesByKey[s.key] = resolvedFillUrlsByMetaKey.get(s.key)![0] || ''
      continue
    }
    const edgeSource = parameterAssignments.find((assignment) => assignment.slot.key === s.key)?.edge?.source
    const nodeRef = edgeSource || getSlotNodeRef(meta, s.key)
    const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
    assetValuesByKey[s.key] = edgeSource
      ? resultPreviewUrl(thumbNode)
      : (thumbNode ? resultPreviewUrl(thumbNode) : null) || getSlotThumbUrl(meta, s.key, nodes) || readMeta(meta, s.key) || ''
  }
  for (const s of arraySlots) {
    assetValuesByKey[s.metaKey] = resolvedFillUrlsByMetaKey.get(s.metaKey) ?? readArchetypeArray(meta, s.metaKey)
  }
  if (sourceVideoSlot) {
    assetValuesByKey[sourceVideoSlot.metaKey] =
      resolvedFillUrlsByMetaKey.get(sourceVideoSlot.metaKey)?.[0] || readMeta(meta, sourceVideoSlot.metaKey) || ''
  }

  return {
    referencePlacement,
    firstFrameSlotKey,
    arrayOccupiedByKey,
    assetValuesByKey,
    parameterAssignments,
  }
}
