// 参考的「名字」与「来源」：提示词里的小块、参考缩略图的悬停提示共用这一份（B3：提示词写「小图 + 名字」，不写图1、图2）。
//
// 引用在持久化里只有 url（`@[asset:url]`），名字是**每次从当前图里现算的投影**，不落盘：
//   · 来自连线 / 画布上的图 → 节点标题（没有标题回落媒体类型名）；
//   · 素材库 / 上传 → 素材名（上传进来的文件名）；
//   · 都认不出 → url 的文件名。
// 小块上的名字最多 8 个字，重名加「·2」「·3」。
import React from 'react'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { canvasNodeToAssetRefs, type AssetKind, type AssetRef } from './assetTypes'

export type ReferenceSource = 'canvas' | 'library' | 'upload'

export type ReferenceInfo = {
  url: string
  kind: AssetKind
  /** 完整名字（悬停提示用）。 */
  name: string
  /** 小块上显示的名字：≤8 字、重名带「·N」。 */
  chipName: string
  source: ReferenceSource
  /** 这张图是不是靠一条连线接进来的（× 的意思是「断开连线」）。 */
  fromEdge: boolean
}

/** url → 小块上显示的名字。没有登记的 url（别的宿主、旧引用）回落到「参考图 N」。 */
export const ReferenceNamesContext = React.createContext<Readonly<Record<string, string>> | null>(null)

const REFERENCE_CHIP_NAME_MAX = 8

export function clipReferenceName(name: string, max = REFERENCE_CHIP_NAME_MAX): string {
  const chars = [...name.trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

/** 文件名当名字：取 url 最后一段，解码、去扩展名。 */
export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url, 'http://x').pathname.split('/').filter(Boolean).pop() ?? '')
    return last.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  } catch {
    return ''
  }
}

/** 给一组按顺序排好的名字去重：第二个同名的加「·2」，第三个「·3」。 */
export function dedupeChipNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name}·${count}`
  })
}

export function resolveReferenceInfos(args: {
  nodeId: string
  references: readonly { url: string; kind: AssetKind }[]
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  library: readonly AssetRef[] | null
  /** 认不出名字时的兜底（「参考图」等，调用方翻译）。 */
  fallbackName: (kind: AssetKind) => string
}): Map<string, ReferenceInfo> {
  const { nodeId, references, nodes, edges, library, fallbackName } = args
  const sources = edges.filter((edge) => edge.target === nodeId).flatMap((edge) => {
    const source = nodes.find((node) => node.id === edge.source)
    return source ? [source] : []
  })
  const rows = references.map((reference) => {
    const viaEdge = sources.find((node) => canvasNodeToAssetRefs(node).some((asset) => asset.renderUrl === reference.url))
    const libraryHit = viaEdge ? undefined : library?.find((asset) => asset.renderUrl === reference.url)
    const canvasHit = viaEdge ?? (libraryHit ? undefined : nodes.find((node) => canvasNodeToAssetRefs(node).some((asset) => asset.renderUrl === reference.url)))
    const name = (canvasHit ? String(canvasHit.title || '').trim() : libraryHit?.name?.trim()) || nameFromUrl(reference.url) || fallbackName(reference.kind)
    const source: ReferenceSource = canvasHit ? 'canvas' : libraryHit ? 'library' : 'upload'
    return { reference, name, source, fromEdge: Boolean(viaEdge) }
  })
  const clipped = dedupeChipNames(rows.map((row) => clipReferenceName(row.name)))
  return new Map(rows.map((row, index) => [row.reference.url, {
    url: row.reference.url,
    kind: row.reference.kind,
    name: row.name,
    chipName: clipped[index]!,
    source: row.source,
    fromEdge: row.fromEdge,
  }]))
}
