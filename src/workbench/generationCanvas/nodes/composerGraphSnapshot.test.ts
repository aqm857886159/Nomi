/**
 * 依赖面签名的合同：**签名不变 ⇒ 生成框读到的每一个派生值都不变**。
 *
 * 生成框只在签名变了时才拿到新快照（composerGraphSnapshot.ts）。签名漏了一项，后果是「该更新时没更新」
 * ——比如上游出了图，生成框还显示「缺参考」。这条用随机图 + 随机改动去撞：每一次改动之后，
 * 要么签名变了，要么下面清单里的每个派生值都和改动前一模一样。
 *
 * 新增一个读图的派生值：先在 composerGraphSnapshot 补依赖面，再在下面 FACTS 里加一行。
 */
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { composerDependencyKeys, createComposerGraphSelector } from './composerGraphSnapshot'
import { requiredModeForGenerationNode } from '../adapters/modelOptionsAdapter'
import { canRunGenerationNode, unmetReferenceDependencyForNode } from '../runner/generationRunController'
import { directorPreviewSpendBlock } from './director/model/directorPreviewState'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { currentReferenceMedia, currentReferenceUrls } from './mentionCandidates'
import { projectConnectedTextInputs } from '../runner/connectedTextPrompt'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import { resolveParameterReferenceAssignments } from '../model/parameterReferenceSlots'
import { getSlotThumbUrl } from './controls/parameterControlModel'

type Graph = { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }

/** 生成框和它的子件从图上读的全部派生值（NodeGenerationComposer / NodeParameterControls / useNodeMentionSource / ConnectedTextChips / NodeInputReferenceEntry）。 */
const FACTS: Record<string, (target: GenerationCanvasNode, graph: Graph) => unknown> = {
  requiredMode: (target, graph) => requiredModeForGenerationNode(target, graph),
  canRun: (target, graph) => canRunGenerationNode(target, graph),
  unmetDependency: (target, graph) => unmetReferenceDependencyForNode(target, graph),
  directorBlock: (target, graph) => directorPreviewSpendBlock(target.id, graph.nodes),
  pendingAncestors: (target, graph) => collectUngeneratedReferenceAncestors(target.id, graph),
  referenceUrls: (target, graph) => currentReferenceUrls(target, graph.nodes, graph.edges),
  referenceMedia: (target, graph) => currentReferenceMedia(target, graph.nodes, graph.edges),
  connectedText: (target, graph) => projectConnectedTextInputs(target, graph),
  referenceSlots: (target, graph) => resolveReferenceSlots(target, graph.nodes, graph.edges),
  parameterAssignments: (target, graph) => resolveParameterReferenceAssignments(target, graph.nodes, graph.edges, [
    { key: 'firstFrameUrl', label: 'first', group: 'first_frame' },
    { key: 'lastFrameUrl', label: 'last', group: 'last_frame' },
    { key: 'referenceImageUrl', label: 'ref', group: 'reference' },
  ]),
  slotThumbs: (target, graph) => ['firstFrameUrl', 'lastFrameUrl', 'referenceImageUrl']
    .map((key) => getSlotThumbUrl((target.meta || {}) as Record<string, unknown>, key, graph.nodes)),
  inputEntries: (target, graph) => graph.edges.filter((edge) => edge.target === target.id)
    .map((edge) => [edge.id, graph.nodes.find((node) => node.id === edge.source)?.result?.url ?? null]),
}

/** 小而确定的伪随机（不引依赖；种子固定，红了能复现）。 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const KINDS = ['image', 'video', 'text', 'audio', 'director'] as const
const MODES = [undefined, 'reference', 'first_frame', 'last_frame', 'style_ref', 'character_ref'] as const
const MODELS = [
  { modelKey: 'gpt-image-2', modelVendor: 'apimart' },
  { modelKey: 'bytedance/seedance-2', modelVendor: 'apimart' },
  {},
]

function url(random: () => number): string {
  return `nomi-local://asset/p/${Math.floor(random() * 6)}.${random() < 0.5 ? 'png' : 'mp4'}`
}

function randomNode(id: string, ids: readonly string[], random: () => number): GenerationCanvasNode {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]
  const kind = pick(KINDS)
  const meta: Record<string, unknown> = { ...pick(MODELS) }
  if (random() < 0.3) meta.firstFrameRef = pick(ids)
  if (random() < 0.2) meta.referenceImageRef = `${pick(ids)}:r1`
  if (random() < 0.3) meta.referenceImages = [url(random)]
  if (random() < 0.2) meta.upstreamResultUrls = url(random)
  if (random() < 0.2) meta.firstFrameUrl_nodeRef = pick(ids)
  if (kind === 'director' && random() < 0.7) {
    meta.directorPreview = { status: pick(['rendering', 'ready', 'failed'] as const), targetNodeId: pick(ids), revision: 'r', updatedAt: Math.floor(random() * 5) }
  }
  if (kind === 'text') meta.text = random() < 0.5 ? 'some words' : ''
  const node: GenerationCanvasNode = { id, kind: kind as GenerationCanvasNode['kind'], title: id, position: { x: 0, y: 0 }, prompt: random() < 0.5 ? 'p' : '', meta }
  if (random() < 0.5) node.result = { id: 'r1', type: random() < 0.5 ? 'image' : 'video', url: url(random), createdAt: 1 }
  if (random() < 0.2) node.history = [{ id: 'h1', type: 'image', url: url(random), createdAt: 1 }]
  if (random() < 0.1) node.references = [pick(ids)]
  return node
}

function randomGraph(random: () => number, size: number): Graph {
  const ids = Array.from({ length: size }, (_, index) => `n${index}`)
  const nodes = ids.map((id) => randomNode(id, ids, random))
  const edges: GenerationCanvasEdge[] = []
  for (let index = 0; index < size * 1.5; index += 1) {
    const source = ids[Math.floor(random() * size)]
    const target = ids[Math.floor(random() * size)]
    if (source === target) continue
    const mode = MODES[Math.floor(random() * MODES.length)]
    edges.push({ id: `e${index}`, source, target, ...(mode ? { mode } : {}) } as GenerationCanvasEdge)
  }
  return { nodes, edges }
}

/** 一次随机改动：换掉一张卡（新引用、内容随机）、改一条边、加 / 删一条边。返回新的不可变图。 */
function mutate(graph: Graph, random: () => number): Graph {
  const ids = graph.nodes.map((node) => node.id)
  const roll = random()
  if (roll < 0.6) {
    const index = Math.floor(random() * graph.nodes.length)
    const nodes = graph.nodes.slice()
    nodes[index] = randomNode(nodes[index].id, ids, random)
    return { nodes, edges: graph.edges }
  }
  if (roll < 0.75) {
    const edges = graph.edges.slice()
    if (edges.length) edges.splice(Math.floor(random() * edges.length), 1)
    return { nodes: graph.nodes, edges }
  }
  if (roll < 0.9) {
    const source = ids[Math.floor(random() * ids.length)]
    const target = ids[Math.floor(random() * ids.length)]
    if (source === target) return graph
    return { nodes: graph.nodes, edges: [...graph.edges, { id: `x${Math.floor(random() * 1e9)}`, source, target, mode: 'reference' } as GenerationCanvasEdge] }
  }
  // 只改一个与图无关的字段（生成进度）——最常见的那种写入。
  const index = Math.floor(random() * graph.nodes.length)
  const nodes = graph.nodes.slice()
  nodes[index] = { ...nodes[index], progress: { percent: Math.floor(random() * 100), updatedAt: Math.floor(random() * 1e6) } }
  return { nodes, edges: graph.edges }
}

function facts(graph: Graph, targetId: string): Record<string, unknown> {
  const target = graph.nodes.find((node) => node.id === targetId)
  if (!target) return { missing: true }
  return Object.fromEntries(Object.entries(FACTS).map(([name, read]) => [name, read(target, graph)]))
}

describe('生成框依赖面签名', () => {
  it('签名不变 ⇒ 生成框读到的所有派生值不变（随机图 × 随机改动）', () => {
    let unchangedSignatures = 0
    let changedSignatures = 0
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = rng(seed)
      let graph = randomGraph(random, 6 + Math.floor(random() * 10))
      const targetId = graph.nodes[Math.floor(random() * graph.nodes.length)].id
      for (let step = 0; step < 25; step += 1) {
        const next = mutate(graph, random)
        const before = composerDependencyKeys(graph, targetId)
        const after = composerDependencyKeys(next, targetId)
        const same = before.length === after.length && before.every((key, index) => Object.is(key, after[index]))
        if (same) {
          unchangedSignatures += 1
          expect(facts(next, targetId), `seed ${seed} step ${step}`).toEqual(facts(graph, targetId))
        } else {
          changedSignatures += 1
        }
        graph = next
      }
    }
    // 两条路都真的走到过：既有「无关写入不换快照」，也有「相关写入换快照」。
    expect(unchangedSignatures).toBeGreaterThan(200)
    expect(changedSignatures).toBeGreaterThan(200)
  })

  it('选择器：无关写入返回同一份快照（同一个引用），相关写入换新', () => {
    const upstream: GenerationCanvasNode = { id: 'ref', kind: 'image', title: 'ref', position: { x: 0, y: 0 } }
    const target: GenerationCanvasNode = { id: 'shot', kind: 'image', title: 'shot', position: { x: 0, y: 0 } }
    const other: GenerationCanvasNode = { id: 'other', kind: 'video', title: 'other', position: { x: 0, y: 0 } }
    const edges: GenerationCanvasEdge[] = [{ id: 'e', source: 'ref', target: 'shot', mode: 'reference' } as GenerationCanvasEdge]
    const select = createComposerGraphSelector('shot')
    const first = select({ nodes: [upstream, target, other], edges })
    const progressed = select({ nodes: [upstream, target, { ...other, progress: { percent: 40, updatedAt: 2 } }], edges })
    expect(progressed).toBe(first)
    const moved = select({ nodes: [upstream, target, { ...other, position: { x: 99, y: 0 } }], edges })
    expect(moved).toBe(first)
    const upstreamDone = select({ nodes: [{ ...upstream, result: { id: 'r', type: 'image', url: 'nomi-local://asset/p/r.png', createdAt: 1 } }, target, other], edges })
    expect(upstreamDone).not.toBe(first)
  })
})
