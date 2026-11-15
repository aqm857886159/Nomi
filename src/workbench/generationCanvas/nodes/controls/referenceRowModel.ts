/**
 * 参考行的派生数据：哪些图「不会发」（淡显）、每张图叫什么、参考数组里放了几张。
 * 全是读：输入是节点、图与槽的当前取值，输出只给参考行渲染（名字是投影，不落盘）。
 */
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../../model/generationCanvasTypes'
import { referenceAssetKindForNode } from '../../agent/referenceEdgeCapability'
import { peekAllProjectAssets } from '../../../assets/useAllProjectAssets'
import { resolveReferenceInfos } from '../../../assets/referenceNames'
import type { AssetKind } from '../../../assets/assetTypes'
import type { AssetSlot } from '../../../assets/AssetReference'
import type { ArchetypeArraySlot } from './archetypeMeta'
import { resultPreviewUrl } from './parameterControlModel'

export function computeReferenceRowModel(args: {
  node: GenerationCanvasNode
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  meta: Record<string, unknown>
  assetSlots: AssetSlot[]
  assetValuesByKey: Record<string, string | string[] | undefined>
  arraySlots: ArchetypeArraySlot[]
  /** 节点参考列表里这次发不出去的图（resolveReferencePlacement 的 unused，和请求组装同一个推导）。 */
  unusedUploads: readonly string[]
  /** unusedUploads 里「先放一边」的旧工程残留（resolveReferencePlacement 的 parked）：点一下放回在用。 */
  parkedUploads?: readonly string[]
  showReferences: boolean
  fallbackName: (kind: AssetKind) => string
}) {
  const { node, nodes, edges, assetSlots, assetValuesByKey, arraySlots } = args
  const inboundImageUrls = edges
    .filter((edge) => edge.target === node.id)
    .flatMap((edge) => {
      const source = nodes.find((candidate) => candidate.id === edge.source)
      const url = source && referenceAssetKindForNode(source) === 'image' ? resultPreviewUrl(source) : ''
      return url ? [url] : []
    })
  const shownUrls = new Set(Object.values(assetValuesByKey).flat().filter((value): value is string => Boolean(value)))
  // 这次发不出去的图（模型自己放不下、或模型不收图）：只变淡，行尾一句话报数。方式已经按输入挑了收得最多的那种，
  // 落不进格子的就是真发不出去的——上传的由 resolveReferencePlacement 推导（和请求组装同一个函数），连线的是没落进格子的那几条。
  const unusedUrls = Array.from(new Set([...inboundImageUrls, ...args.unusedUploads])).filter((url) => !shownUrls.has(url))
  const parked = new Set(args.parkedUploads ?? [])
  const parkedUrls = new Set(unusedUrls.filter((url) => parked.has(url)))
  const referenceInfos = args.showReferences
    ? resolveReferenceInfos({
      nodeId: node.id,
      references: [
        ...assetSlots.flatMap((slot) => {
          const raw = assetValuesByKey[slot.key]
          return (Array.isArray(raw) ? raw : [raw]).filter((url): url is string => Boolean(url)).map((url) => ({ url, kind: slot.accept }))
        }),
        ...unusedUrls.map((url) => ({ url, kind: 'image' as AssetKind })),
      ],
      nodes, edges, library: peekAllProjectAssets(), fallbackName: args.fallbackName,
    })
    : undefined
  // 行尾按类型报数（图 30 · 视频 10 · 音频 10）：视频、音频不再算进「参考图」。每种都到上限 = 都放满了。
  const filled = arraySlots.map((slot) => ({ slot, count: ((assetValuesByKey[slot.metaKey] as string[] | undefined) ?? []).filter(Boolean).length }))
  const arrayCounts = { image: 0, video: 0, audio: 0 }
  for (const { slot, count } of filled) arrayCounts[slot.accept] += count
  const arrayCount = arrayCounts.image + arrayCounts.video + arrayCounts.audio
  const arrayFull = filled.length > 0 && filled.every(({ slot, count }) => slot.max !== undefined && count >= slot.max)
  return { unusedUrls, parkedUrls, referenceInfos, arrayCount, arrayCounts, arrayFull }
}
