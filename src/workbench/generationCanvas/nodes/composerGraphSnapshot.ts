/**
 * 生成框读画布图的唯一入口：**只在「这张卡读得到的那一小片图」变了时，才给一份新快照**。
 *
 * 为什么要有它（2026-10-16 卡顿波可疑点 g / h）：生成框和它的 3 份参数控件原来各自订整张 `nodes` / `edges`，
 * 再各写几个「每次 store 写都整表遍历 + JSON.stringify 防抖」的选择器（必需模式、能不能生成、缺的伴随参考、
 * 未生成上游、3D 预演阻塞、@ 编号、连进来的文字）。画布上别的卡的生成进度一秒写好几次，每一次都让这些全部重算、
 * 参数控件整份重渲——内容多了就卡。
 *
 * 做法（React Flow 性能指南与 Zustand 选择器的同一条原则：选择器只在相关数据变了才返回新引用）：
 * 选择器先算一份**依赖面签名**——这张卡读得到的每一样东西的引用：
 *   ① 自己；② 上游闭包（经入边传递）里的每张卡和指向它们的每条边；③ 自己 meta / references 里按 id 指着的卡；
 *   ④ 自己 meta 里参考 URL 被归成的媒体种类（同一张 `getAssetKindByUrl` 表）；⑤ 画布上的 3D 预演卡。
 * 签名里每一项都和上次同一个引用 → 返回**同一份快照**（Zustand 按 `Object.is` 比，组件不重渲）；
 * 有一项变了 → 返回 `{ nodes: state.nodes, edges: state.edges }` 这份新的全图。
 * 消费方照旧把全图交给现役的派生函数（resolveReferenceSlots / canRunGenerationNode / …），算法一行不改；
 * 快照里依赖面以外的卡可能是旧的，但按定义它们不影响这张卡的任何派生值（composerGraphSnapshot.test 用随机图钉住）。
 *
 * 依赖面漏了一项的后果是「该更新时没更新」——所以新增一个读图的派生值，先在这里补依赖面，再在测试的派生值清单里加一行。
 *
 * 不读图的事（点「×」断边、从画布挑一张图……）在事件里直接读 `useGenerationCanvasStore.getState()`，不走快照。
 */
import React from 'react'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationCanvasState } from '../store/canvasStoreTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById } from '../store/canvasNodeGenerationIndex'
import { getAssetKindByUrl } from '../runner/generationReferenceResolver'
import { DIRECTOR_NODE_KIND } from './director/model/directorNodeMeta'

/** 生成框和它的子件读图用的那一份（全图引用；只在依赖面变了时换新）。 */
export type ComposerGraph = Readonly<{ nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }>

type GraphState = Pick<GenerationCanvasState, 'nodes' | 'edges'>

// ── 按源数组引用只算一次的索引（与 store/canvasNodeGenerationIndex 同一手法：immer 换数组 = 换版本）──

const incomingByEdges = new WeakMap<GenerationCanvasEdge[], Map<string, GenerationCanvasEdge[]>>()
function incomingEdgesIndex(edges: GenerationCanvasEdge[]): Map<string, GenerationCanvasEdge[]> {
  let index = incomingByEdges.get(edges)
  if (!index) {
    index = new Map()
    for (const edge of edges) {
      const bucket = index.get(edge.target)
      if (bucket) bucket.push(edge)
      else index.set(edge.target, [edge])
    }
    incomingByEdges.set(edges, index)
  }
  return index
}

type UpstreamClosure = Readonly<{ nodeIds: readonly string[]; edges: readonly GenerationCanvasEdge[] }>
const closureByEdges = new WeakMap<GenerationCanvasEdge[], Map<string, UpstreamClosure>>()
/** 经入边传递的上游闭包（含自己）+ 指向闭包内各卡的全部边。只依赖边表：边表不换，闭包不重算。 */
function upstreamClosure(nodeId: string, edges: GenerationCanvasEdge[]): UpstreamClosure {
  let byNode = closureByEdges.get(edges)
  if (!byNode) { byNode = new Map(); closureByEdges.set(edges, byNode) }
  const cached = byNode.get(nodeId)
  if (cached) return cached
  const incoming = incomingEdgesIndex(edges)
  const seen = new Set<string>([nodeId])
  const stack = [nodeId]
  const closureEdges: GenerationCanvasEdge[] = []
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const edge of incoming.get(current) ?? []) {
      closureEdges.push(edge)
      if (seen.has(edge.source)) continue
      seen.add(edge.source)
      stack.push(edge.source)
    }
  }
  const closure: UpstreamClosure = { nodeIds: [...seen], edges: closureEdges }
  byNode.set(nodeId, closure)
  return closure
}

const directorsByNodes = new WeakMap<GenerationCanvasNode[], readonly GenerationCanvasNode[]>()
/** 3D 预演卡（directorPreviewSpendBlock 按「预演指向哪张卡」全表找它们）：全都算进依赖面，数量很少。 */
function directorNodes(nodes: GenerationCanvasNode[]): readonly GenerationCanvasNode[] {
  let list = directorsByNodes.get(nodes)
  if (!list) {
    list = nodes.filter((node) => node.kind === DIRECTOR_NODE_KIND)
    directorsByNodes.set(nodes, list)
  }
  return list
}

/** meta 里按 id 指着别的卡的键（resolver 的 resolveReferenceUrl、参数槽的 getSlotNodeRef 读的就是这些）。 */
const NODE_REF_META_KEYS = ['firstFrameRef', 'lastFrameRef', 'firstFrameReference', 'lastFrameReference', 'referenceImageRef'] as const

function referencedNodeIds(node: GenerationCanvasNode): string[] {
  const ids: string[] = []
  const take = (value: unknown) => { if (typeof value === 'string' && value) ids.push(value.split(':')[0]) }
  for (const reference of node.references ?? []) take(reference)
  const meta = node.meta
  if (meta) {
    for (const key of NODE_REF_META_KEYS) take(meta[key])
    for (const key of Object.keys(meta)) if (key.endsWith('_nodeRef')) take(meta[key])
  }
  return ids
}

/**
 * 会被按「URL 是哪张卡的结果」归类媒体种类的 URL（generationReferenceResolver 里 getAssetKindByUrl 的调用面）：
 * 本卡 meta / references 里直接写的 URL，加上依赖面里每张卡的结果 URL（边和按 id 的引用会把它们解析进参考列表）。
 * 归类规则是全表「先到先得」，所以一张不在依赖面里的卡如果持有同一个 URL，也能改变归类——签名里放的是归类结果本身。
 */
function classifiedUrls(self: GenerationCanvasNode, dependencyNodes: readonly (GenerationCanvasNode | undefined)[]): string[] {
  const urls: string[] = []
  const take = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) if (typeof item === 'string' && item) urls.push(item) }
    else if (typeof value === 'string' && value) urls.push(value)
  }
  take(self.references)
  take(self.meta?.referenceImages)
  take(self.meta?.upstreamResultUrls)
  for (const node of dependencyNodes) {
    if (!node) continue
    take(node.result?.url)
    take(node.result?.providerUrl)
    take(node.result?.thumbnailUrl)
    for (const entry of node.history ?? []) { take(entry.url); take(entry.providerUrl); take(entry.thumbnailUrl) }
  }
  return urls
}

/** 这张卡读得到的每一样东西的引用。两次签名逐项 `Object.is` 相同 ⇒ 这张卡的所有派生值相同。 */
export function composerDependencyKeys(state: GraphState, nodeId: string): unknown[] {
  const self = selectCanvasNodeById(state, nodeId)
  const keys: unknown[] = [self]
  if (!self) return keys
  const closure = upstreamClosure(nodeId, state.edges)
  keys.push(closure.nodeIds.length)
  for (const id of closure.nodeIds) keys.push(selectCanvasNodeById(state, id))
  keys.push(closure.edges.length)
  for (const edge of closure.edges) keys.push(edge)
  const refs = referencedNodeIds(self)
  keys.push(refs.length)
  const dependencyNodes: (GenerationCanvasNode | undefined)[] = closure.nodeIds.map((id) => selectCanvasNodeById(state, id))
  for (const id of refs) {
    const referenced = selectCanvasNodeById(state, id)
    keys.push(referenced)
    dependencyNodes.push(referenced)
  }
  const urls = classifiedUrls(self, dependencyNodes)
  if (urls.length > 0) {
    const kinds = getAssetKindByUrl(state.nodes)
    for (const url of urls) keys.push(kinds.get(url))
  }
  const directors = directorNodes(state.nodes)
  keys.push(directors.length)
  for (const director of directors) keys.push(director)
  return keys
}

function sameKeys(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (!Object.is(left[index], right[index])) return false
  return true
}

/** 一张卡一个选择器：依赖面没变就返回上一份快照（同一个引用）。 */
export function createComposerGraphSelector(nodeId: string): (state: GraphState) => ComposerGraph {
  let lastKeys: unknown[] | null = null
  let lastGraph: ComposerGraph | null = null
  return (state) => {
    if (lastGraph && lastGraph.nodes === state.nodes && lastGraph.edges === state.edges) return lastGraph
    const keys = composerDependencyKeys(state, nodeId)
    if (lastGraph && lastKeys && sameKeys(lastKeys, keys)) return lastGraph
    lastKeys = keys
    lastGraph = { nodes: state.nodes, edges: state.edges }
    return lastGraph
  }
}

/** 订这张卡读得到的那一小片图。别的卡的生成进度、拖动不会让订它的组件重渲。 */
export function useComposerGraph(nodeId: string): ComposerGraph {
  const selector = React.useMemo(() => createComposerGraphSelector(nodeId), [nodeId])
  return useGenerationCanvasStore(selector)
}

/**
 * 内容没变就沿用上一份引用（编辑器按引用判断要不要重排 chip 编号；每敲一个字都换新数组会让它白跑一遍）。
 * 比较是调用方给的逐字段比较，不是 JSON.stringify。
 */
export function useContentStable<T>(value: T, same: (previous: T, next: T) => boolean): T {
  const ref = React.useRef(value)
  if (ref.current !== value && !same(ref.current, value)) ref.current = value
  return ref.current
}

/** 两个平铺记录数组逐项逐字段相等（@ 编号、连进来的文字这类小数组用）。 */
export function sameFlatRecords<T extends object>(previous: readonly T[], next: readonly T[]): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index] as Record<string, unknown>
    const right = next[index] as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    for (const key of keys) if (!Object.is(left[key], right[key])) return false
  }
  return true
}

/** 两个字符串数组逐项相等。 */
export function sameStrings(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index])
}
