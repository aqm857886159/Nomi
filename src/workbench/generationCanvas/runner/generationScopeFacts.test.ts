// 生成范围的事实适配器 + 共用主人的依赖分波（原 dependencyWaves / referenceAncestors 两份测试搬过来，判据原样）。
import { describe, expect, it } from 'vitest'
import { waveIndexByNode } from '../../../../electron/shared/agentCapabilities/generationShotScope'
import { collectUngeneratedReferenceAncestors, planCanvasGenerationScope } from './generationScopeFacts'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (id: string, withResult = false): GenerationCanvasNode =>
  ({
    id,
    kind: 'image',
    title: id,
    ...(withResult ? { result: { id: `r-${id}`, url: `https://cdn/${id}.png` } } : {}),
  }) as unknown as GenerationCanvasNode

const edge = (source: string, target: string, mode = 'first_frame'): GenerationCanvasEdge =>
  ({ id: `${source}->${target}`, source, target, mode }) as unknown as GenerationCanvasEdge

/** 原 buildDependencyWaves(selection)：组生成意图下、全部默认勾上的那一份。 */
const waves = (selection: string[], graph: { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] }) =>
  planCanvasGenerationScope('group', selection, graph)

describe('依赖分波', () => {
  it('独立节点全部第 1 波并行;依赖链按序分波(论文 Eq.7 调度语义)', () => {
    const nodes = [node('定妆'), node('场景'), node('镜头1'), node('镜头2'), node('空镜')]
    const edges = [edge('定妆', '镜头1', 'character_ref'), edge('场景', '镜头1'), edge('镜头1', '镜头2')]
    const plan = waves(['定妆', '场景', '镜头1', '镜头2', '空镜'], { nodes, edges })
    expect(plan.waves).toEqual([['定妆', '场景', '空镜'], ['镜头1'], ['镜头2']])
    expect(plan.blocked).toEqual([])
    expect(waveIndexByNode(plan).get('镜头2')).toBe(3)
  })

  it('选择集外上游:有结果=满足;无结果=拦下且下游传染(杜绝静默裸跑)', () => {
    const nodes = [node('外部有果', true), node('外部无果'), node('A'), node('B')]
    const edges = [edge('外部有果', 'A'), edge('外部无果', 'B')]
    const plan = waves(['A', 'B'], { nodes, edges })
    expect(plan.waves).toEqual([['A']])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]).toMatchObject({ nodeId: 'B', reason: 'missing-upstream' })
    expect(plan.blocked[0].detail).toContain('外部无果')
  })

  it('文本→图片/视频 prompt 上下文边不参与参考依赖调度', () => {
    const txt = { ...node('文本'), kind: 'text' as const, contentJson: { type: 'doc' as const, content: [] } }
    const img = node('图片')
    const plan = waves(['图片'], { nodes: [txt, img], edges: [edge('文本', '图片', 'reference')] })
    expect(plan.waves).toEqual([['图片']])
    expect(plan.blocked).toEqual([])
    expect(plan.edgesUsed).toEqual([])
  })

  it('环检测:循环引用的节点全部拦下,不死循环', () => {
    const nodes = [node('X'), node('Y'), node('独立')]
    const edges = [edge('X', 'Y'), edge('Y', 'X')]
    const plan = waves(['X', 'Y', '独立'], { nodes, edges })
    expect(plan.waves).toEqual([['独立']])
    expect(plan.blocked.map((b) => b.reason)).toEqual(['cycle', 'cycle'])
  })

  it('依赖本批被拦节点的,跟着标 blocked 而不是死等', () => {
    const nodes = [node('外部无果'), node('A'), node('A的下游')]
    const edges = [edge('外部无果', 'A'), edge('A', 'A的下游')]
    const plan = waves(['A', 'A的下游'], { nodes, edges })
    expect(plan.waves).toEqual([])
    expect(plan.blocked.map((b) => b.nodeId).sort()).toEqual(['A', 'A的下游'])
  })
})

// W2 冻结门（GUI 批量侧结构强制核）：视觉锚未冻结 → 引用它的镜头拦下（reason:'unfrozen-anchor'）。
const anchorNode = (id: string, kind: string, frozen: boolean, withResult = true): GenerationCanvasNode =>
  ({
    id,
    kind,
    title: id,
    meta: { referenceSheet: true, ...(frozen ? { frozen: { at: 1_700_000_000_000, by: 'user' } } : {}) },
    ...(withResult ? { result: { id: `r-${id}`, url: `https://cdn/${id}.png` } } : {}),
  }) as unknown as GenerationCanvasNode

describe('依赖分波 · W2 冻结门', () => {
  it('锚已生成图但未冻结 → 引用它的镜头进 blocked(unfrozen-anchor)，而非静默放行', () => {
    const nodes = [anchorNode('林夏卡', 'character', false, true), node('镜头1')]
    const edges = [edge('林夏卡', '镜头1', 'character_ref')]
    const plan = waves(['镜头1'], { nodes, edges })
    expect(plan.waves).toEqual([])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]).toMatchObject({ nodeId: '镜头1', reason: 'unfrozen-anchor' })
    expect(plan.blocked[0].detail).toContain('林夏卡')
  })

  it('锚已冻结 → 镜头正常入波（放行）', () => {
    const nodes = [anchorNode('林夏卡', 'character', true, true), node('镜头1')]
    const edges = [edge('林夏卡', '镜头1', 'character_ref')]
    const plan = waves(['镜头1'], { nodes, edges })
    expect(plan.waves).toEqual([['镜头1']])
    expect(plan.blocked).toEqual([])
  })

  it('锚在本批内但未冻结 → 锚可跑(单镜生成)、但引用它的镜头仍拦下(冻结门优先于波次先后)', () => {
    const nodes = [anchorNode('林夏卡', 'character', false, false), node('镜头1')]
    const edges = [edge('林夏卡', '镜头1', 'character_ref')]
    const plan = waves(['林夏卡', '镜头1'], { nodes, edges })
    expect(plan.waves).toEqual([['林夏卡']])
    expect(plan.blocked).toEqual([{ nodeId: '镜头1', reason: 'unfrozen-anchor', detail: expect.stringContaining('林夏卡') }])
  })

  it('场景/道具卡同规则：未冻结即拦下引用它的镜头', () => {
    const nodes = [anchorNode('场景卡', 'scene', false), anchorNode('道具卡', 'prop', false), node('镜头1'), node('镜头2')]
    const edges = [edge('场景卡', '镜头1', 'style_ref'), edge('道具卡', '镜头2', 'reference')]
    const plan = waves(['镜头1', '镜头2'], { nodes, edges })
    expect(plan.blocked.map((b) => [b.nodeId, b.reason]).sort()).toEqual([
      ['镜头1', 'unfrozen-anchor'],
      ['镜头2', 'unfrozen-anchor'],
    ])
  })

  it('非视觉锚上游（普通镜头有结果）不受冻结判据影响，照旧放行', () => {
    const nodes = [node('前置镜', true), node('后置镜')]
    const edges = [edge('前置镜', '后置镜', 'first_frame')]
    const plan = waves(['后置镜'], { nodes, edges })
    expect(plan.waves).toEqual([['后置镜']])
    expect(plan.blocked).toEqual([])
  })
})

describe('单发自动备齐参考（collectUngeneratedReferenceAncestors / single 意图）', () => {
  const plain = (id: string, url?: string): GenerationCanvasNode =>
    ({ id, kind: 'image', title: id, position: { x: 0, y: 0 }, ...(url ? { result: { id: `${id}-r`, type: 'image', url, createdAt: 0 } } : {}) }) as GenerationCanvasNode
  const ref = (source: string, target: string): GenerationCanvasEdge => ({ id: `${source}-${target}`, source, target }) as GenerationCanvasEdge

  it('上游角色未出图 → 纳入；single 规划里它在前一波、点的那一个在后', () => {
    const graph = { nodes: [plain('char'), plain('shot')], edges: [ref('char', 'shot')] }
    expect(collectUngeneratedReferenceAncestors('shot', graph)).toEqual(['char'])
    const plan = planCanvasGenerationScope('single', ['shot'], graph)
    expect(plan.waves).toEqual([['char'], ['shot']])
  })

  it('上游角色已出图 → 视为已满足，不纳入（不重复生成）', () => {
    const graph = { nodes: [plain('char', 'nomi-local://c.png'), plain('shot')], edges: [ref('char', 'shot')] }
    expect(collectUngeneratedReferenceAncestors('shot', graph)).toEqual([])
    expect(planCanvasGenerationScope('single', ['shot'], graph).members).toEqual(['shot'])
  })

  it('传递闭包：char→keyframe→shot，两层都没图 → 都纳入', () => {
    const graph = { nodes: [plain('char'), plain('keyframe'), plain('shot')], edges: [ref('char', 'keyframe'), ref('keyframe', 'shot')] }
    expect(collectUngeneratedReferenceAncestors('shot', graph).sort()).toEqual(['char', 'keyframe'])
  })

  it('中间层已出图 → 截断（不再往它的上游递归）', () => {
    const graph = { nodes: [plain('char'), plain('keyframe', 'nomi-local://k.png'), plain('shot')], edges: [ref('char', 'keyframe'), ref('keyframe', 'shot')] }
    expect(collectUngeneratedReferenceAncestors('shot', graph)).toEqual([])
  })

  it('无参考边 → 空', () => {
    expect(collectUngeneratedReferenceAncestors('shot', { nodes: [plain('shot')], edges: [] })).toEqual([])
  })

  it('文本→图片/视频 prompt 上下文边不作为待生成参考祖先', () => {
    const txt = { ...plain('txt'), kind: 'text' as const, contentJson: { type: 'doc' as const, content: [] } }
    const edges = [{ ...ref('txt', 'img'), mode: 'reference' as const }]
    expect(collectUngeneratedReferenceAncestors('img', { nodes: [txt, plain('img')], edges })).toEqual([])
  })

  it('环不死循环', () => {
    const graph = { nodes: [plain('a'), plain('b')], edges: [ref('a', 'b'), ref('b', 'a')] }
    expect(() => collectUngeneratedReferenceAncestors('a', graph)).not.toThrow()
  })
})
