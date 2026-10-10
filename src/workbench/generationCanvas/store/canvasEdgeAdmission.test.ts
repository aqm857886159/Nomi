import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { generationCanvasTools } from '../agent/generationCanvasTools'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const reported = vi.hoisted(() => [] as string[])
vi.mock('../components/canvasFeedback', () => ({
  reportCanvasFeedback: (message: string) => { reported.push(message) },
}))

// 2026-10-10 复审 2：粘贴 / 拖动复制、外部整图写回原样搬运非法边（视频 / 声音 → 文本、剪辑 → 图片）。
// 这里每个入口各造一条非法边，必须被拒；合法边照常；旧项目里已有的非法边不删、撤销能原样放回。

const store = () => useGenerationCanvasStore.getState()
const node = (id: string, kind: GenerationCanvasNode['kind']): GenerationCanvasNode => ({ id, kind, title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta: {} })
const edge = (source: string, target: string, mode: GenerationCanvasEdge['mode'] = 'reference'): GenerationCanvasEdge => ({ id: `e-${source}-${target}`, source, target, mode, order: 0 })

/** 非法边 = 目标这一类不收这种输入（connects.input）：[源种类, 目标种类]。 */
const ILLEGAL: Array<[GenerationCanvasNode['kind'], GenerationCanvasNode['kind']]> = [
  ['video', 'text'],
  ['audio', 'text'],
  ['clip', 'image'],
]

function loadLegacy(sourceKind: GenerationCanvasNode['kind'], targetKind: GenerationCanvasNode['kind']): void {
  store().restoreSnapshot({ nodes: [node('a', sourceKind), node('b', targetKind)], edges: [edge('a', 'b')], groups: [] })
}

beforeEach(() => { reported.length = 0 })

describe('旧项目里已有的非法边：加载不删用户数据', () => {
  it.each(ILLEGAL)('%s -> %s 加载后还在', (s, t) => {
    loadLegacy(s, t)
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
  })
})

describe('粘贴 / 拖动复制：非法边不带过来，节点照常，说一句', () => {
  it.each(ILLEGAL)('%s -> %s：pasteNodes 只粘节点', (s, t) => {
    loadLegacy(s, t)
    store().selectNodes(['a', 'b'])
    store().copySelectedNodes()
    store().pasteNodes()
    expect(store().nodes).toHaveLength(4)
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b']) // 只剩原来那条，副本之间没有新边
    expect(reported).toHaveLength(1)
    expect(reported[0]).toContain('1')
  })

  it.each(ILLEGAL)('%s -> %s：duplicateSelectedNodes / duplicateNodesForDrag 同样不带', (s, t) => {
    loadLegacy(s, t)
    store().selectNodes(['a', 'b'])
    store().duplicateSelectedNodes()
    expect(store().nodes).toHaveLength(4)
    expect(store().edges).toHaveLength(1)
    store().duplicateNodesForDrag(['a', 'b'])
    expect(store().nodes).toHaveLength(6)
    expect(store().edges).toHaveLength(1)
    expect(reported).toHaveLength(2)
  })

  it('合法边（图片 -> 视频）照常复制，不吭声', () => {
    loadLegacy('image', 'video')
    store().selectNodes(['a', 'b'])
    store().duplicateSelectedNodes()
    expect(store().nodes).toHaveLength(4)
    expect(store().edges).toHaveLength(2)
    expect(reported).toEqual([])
  })

  it('复制为变体：入边里的非法旧边不继承', () => {
    loadLegacy('video', 'text')
    const copy = store().duplicateNodeForRegeneration('b')
    expect(copy).toBeTruthy()
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
  })
})

describe('组复制 / 工作流模板实例化：同一道闸', () => {
  it.each(ILLEGAL)('%s -> %s：duplicateGroupForDrag 只复制节点', (s, t) => {
    store().restoreSnapshot({
      nodes: [{ ...node('a', s), groupId: 'g' }, { ...node('b', t), groupId: 'g' }],
      edges: [edge('a', 'b')],
      groups: [{ id: 'g', name: 'g', categoryId: 'shots', nodeIds: ['a', 'b'], createdAt: 1, updatedAt: 1 }],
    })
    expect(store().duplicateGroupForDrag('g')).toBeTruthy()
    expect(store().nodes).toHaveLength(4)
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
    expect(reported).toHaveLength(1)
  })

  it.each(ILLEGAL)('%s -> %s：模板实例化只落节点', (s, t) => {
    loadLegacy(s, t)
    store().selectNodes(['a', 'b'])
    const template = store().saveSelectedAsWorkflowTemplate('t')
    expect(template?.edges.length).toBe(1)
    store().instantiateWorkflowTemplate(template!.id, { x: 500, y: 500 })
    expect(store().nodes).toHaveLength(4)
    expect(store().edges).toHaveLength(1)
    expect(reported).toHaveLength(1)
  })
})

describe('外部整图写回（MCP / headless 算好的整张图）', () => {
  it.each(ILLEGAL)('%s -> %s：外部新加的边写不进来，节点照常', (s, t) => {
    store().restoreSnapshot({ nodes: [node('a', s), node('b', t)], edges: [], groups: [] })
    const base = store().readDocumentSnapshot()
    store().applyExternalGraph({ base, next: { ...base, nodes: [...base.nodes, node('c', 'image')], edges: [edge('a', 'b'), edge('a', 'c')] } })
    expect(store().nodes.map((candidate) => candidate.id)).toContain('c')
    expect(store().edges.map((candidate) => candidate.id)).not.toContain('e-a-b')
    expect(reported).toHaveLength(1)
  })

  it('合法边（图片 -> 视频）照常写进来', () => {
    store().restoreSnapshot({ nodes: [node('a', 'image'), node('b', 'video')], edges: [], groups: [] })
    const base = store().readDocumentSnapshot()
    store().applyExternalGraph({ base, next: { ...base, edges: [edge('a', 'b')] } })
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
    expect(reported).toEqual([])
  })

  it('画布上本来就有的旧非法边：外部写回不动它', () => {
    loadLegacy('video', 'text')
    const base = store().readDocumentSnapshot()
    store().applyExternalGraph({ base, next: { ...base, nodes: [...base.nodes, node('c', 'image')] } })
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
  })
})

describe('撤销 / 重做 / 放回：恢复的是原来就有的边，不该被拒', () => {
  it('删掉带旧非法边的节点再撤销：边原样回来；重做再删', () => {
    loadLegacy('video', 'text')
    store().deleteNode('b')
    expect(store().edges).toEqual([])
    store().undo()
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
    store().redo()
    expect(store().edges).toEqual([])
  })

  it('合法连线：删节点 -> 撤销 -> 重做，边照常回来', () => {
    store().restoreSnapshot({ nodes: [node('a', 'image'), node('b', 'video')], edges: [edge('a', 'b')], groups: [] })
    store().deleteNode('b')
    expect(store().edges).toHaveLength(0)
    store().undo()
    expect(store().edges).toHaveLength(1)
    store().redo()
    expect(store().edges).toHaveLength(0)
  })

  it('restoreGraph 放回被删的节点与它的边（含旧非法边）', () => {
    loadLegacy('video', 'text')
    const before = store().readDocumentSnapshot()
    store().deleteNode('b')
    store().restoreGraph(before.nodes.filter((candidate) => candidate.id === 'b'), before.edges)
    expect(store().edges.map((candidate) => candidate.id)).toEqual(['e-a-b'])
  })
})

describe('单条连线入口（对照）：同一道闸', () => {
  it.each(ILLEGAL)('%s -> %s：connectNodes 拒', (s, t) => {
    store().restoreSnapshot({ nodes: [node('a', s), node('b', t)], edges: [], groups: [] })
    store().connectNodes('a', 'b', 'reference')
    expect(store().edges).toEqual([])
  })

  it.each(ILLEGAL)('%s -> %s：Agent 工具 connect_nodes 进 skipped（带原因），边不写', (s, t) => {
    store().restoreSnapshot({ nodes: [node('a', s), node('b', t)], edges: [], groups: [] })
    const result = generationCanvasTools.connect_nodes([{ source: 'a', target: 'b', mode: 'reference' }])
    expect(result.connected).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).not.toBe('dangling')
    expect(store().edges).toEqual([])
  })

  it.each(ILLEGAL)('%s -> %s：手动连线 startConnection + connectToNode 拒', (s, t) => {
    store().restoreSnapshot({ nodes: [node('a', s), node('b', t)], edges: [], groups: [] })
    store().startConnection('a', 'right')
    const outcome = store().connectToNode('b')
    expect(outcome.ok).toBe(false)
    expect(store().edges).toEqual([])
  })
})

describe('执行侧：旧非法边留在画布上，但不变成参考素材', () => {
  it('视频 / 声音 -> 文本、剪辑 -> 图片：resolveGenerationReferences 忽略；合法的图片 -> 视频照常', () => {
    const withResult = (id: string, kind: GenerationCanvasNode['kind'], type: 'video' | 'audio' | 'image', url: string): GenerationCanvasNode =>
      ({ ...node(id, kind), result: { id: `r-${id}`, type, url, createdAt: 1 } })
    const nodes = [
      withResult('v', 'video', 'video', 'https://x/v.mp4'), withResult('a', 'audio', 'audio', 'https://x/a.mp3'),
      node('c', 'clip'), node('t', 'text'), node('i', 'image'), withResult('p', 'image', 'image', 'https://x/p.png'), node('w', 'video'),
    ]
    const edges = [edge('v', 't'), edge('a', 't'), edge('c', 'i'), edge('p', 'w')]
    expect(resolveGenerationReferences(nodes[3], { nodes, edges })).toMatchObject({ referenceVideos: [], referenceAudios: [], referenceImages: [] })
    expect(resolveGenerationReferences(nodes[4], { nodes, edges })).toMatchObject({ referenceImages: [] })
    expect(resolveGenerationReferences(nodes[6], { nodes, edges }).referenceImages.length + resolveGenerationReferences(nodes[6], { nodes, edges }).characterReferenceImages.length).toBeGreaterThan(0)
  })
})
