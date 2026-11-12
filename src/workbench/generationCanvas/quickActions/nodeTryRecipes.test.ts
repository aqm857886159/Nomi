// 空节点「试试」：每个配方**只搭结构**——建好该连的上游空图片节点、把光标放进提示词框；不生成、不派发、不花钱，
// 整个配方一步撤销（2026-10-08 用户拍板 ③）。只列点了真的会发生一件还成立的事的配方（2026-11-12 验收 C2）：
// 放进来之后 modeForInputs 收得下全部、算出的方式就是按钮上写的那种。
// 花钱入口的结构钉子在 deriveFromNode.noMoneyDoor.test.ts（扫整个 quickActions 目录，配方文件也在里面）。
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { useNodePromptFocusStore } from '../nodes/nodePromptFocus'
import { nodeTryRecipes, runNodeTryRecipe, type NodeTryRecipeId } from './nodeTryRecipes'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes'
import { modeDisplayKind } from '../nodes/controls/modeMenuModel'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { effectiveArchetypeMode } from '../nodes/controls/archetypeMeta'

const state = () => useGenerationCanvasStore.getState()
function node(id: string, kind: GenerationNodeKind, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 600, y: 200 }, size: { width: 420, height: 240 }, categoryId: 'shots', status: 'idle', meta }
}
const seed = (...nodes: GenerationCanvasNode[]) => state().restoreSnapshot({ nodes, edges: [], groups: [] })
const ids = (target: GenerationCanvasNode, edges: GenerationCanvasEdge[] = []) => nodeTryRecipes(target, { nodes: [target, ...state().nodes], edges }).map((recipe) => recipe.id)
// 这次真发的方式：方式按输入现算（2026-11-12），配方只摆输入（连上游、放首尾帧），不写方式。
const modeOf = (id: string) => {
  const target = state().nodes.find((candidate) => candidate.id === id)!
  return effectiveArchetypeMode(archetypeForNode(target)!, target, { nodes: state().nodes, edges: state().edges }).mode.id
}
const nothingSpent = () => state().nodes.every((candidate) => (candidate.status ?? 'idle') === 'idle' && !candidate.runs?.length && !candidate.result)

beforeEach(() => {
  __resetGenerationCanvasHistoryForTests()
  seed()
  useNodePromptFocusStore.setState({ request: null })
})

describe('which tasks an empty card offers', () => {
  it('image / video list their real tasks; a text card has none here (its 试试 is the processing row)', () => {
    expect(ids(node('i', 'image'))).toEqual(['image.reference'])
    expect(ids(node('v', 'video'))).toEqual(['video.firstFrame', 'video.firstLast'])
    expect(ids(node('t', 'text'))).toEqual([])
  })

  it('no dead button: 文字生图 / 文生视频 are gone (putting nothing in already is text-to-x)', () => {
    for (const kind of ['image', 'video'] as const) expect(ids(node('x', kind)).some((id) => id.endsWith('.text'))).toBe(false)
  })

  it('drops a task the chosen model cannot do (no first + last frame workflow)', () => {
    expect(ids(node('v', 'video', { archetype: { id: 'kling-3.0-turbo', modeId: 't2v' } }))).toEqual(['video.firstFrame'])
  })

  it('a card that already has inputs only lists what still holds after adding (acceptance shot add-ref-zh-04: 2 images → 全能参考)', () => {
    const twoImages = node('v', 'video', { archetype: { id: 'seedance-2' }, referenceImageUrls: ['nomi-local://a', 'nomi-local://b'] })
    expect(ids(twoImages)).toEqual([])
    // 画布连进来一条首帧边：再接一张首帧放不下（首帧格只有一个），首尾帧（再接首帧 + 尾帧）也不再是首尾帧
    const upstream = node('u', 'image')
    seed(upstream)
    const withEdge = node('v', 'video', { archetype: { id: 'seedance-2' } })
    expect(ids(withEdge, [{ id: 'e', source: 'u', target: 'v', mode: 'first_frame' } as GenerationCanvasEdge])).toEqual([])
  })

  it('no model yet (no archetype to ask): only offered while nothing is in', () => {
    const upstream = node('u', 'image')
    seed(upstream)
    expect(ids(node('v', 'video'), [{ id: 'e', source: 'u', target: 'v' } as GenerationCanvasEdge])).toEqual([])
  })

  it('kinds without recipes offer none', () => {
    expect(ids(node('a', 'asset'))).toEqual([])
    expect(ids(node('c', 'clip'))).toEqual([])
  })
})

describe('every listed task does what its label says, for every video / image model (class test)', () => {
  const BECOMES: Partial<Record<NodeTryRecipeId, string>> = { 'video.firstFrame': 'image', 'video.firstLast': 'firstLast' }
  const archetypes = MODEL_ARCHETYPES.filter((archetype) => archetype.kind === 'video' || archetype.kind === 'image')
  it('covers both kinds', () => {
    expect(archetypes.some((archetype) => archetype.kind === 'video')).toBe(true)
    expect(archetypes.some((archetype) => archetype.kind === 'image')).toBe(true)
  })
  for (const archetype of archetypes) {
    it(`${archetype.id}: run each listed task → the card sends in the named way and takes every input`, () => {
      const kind = archetype.kind as 'video' | 'image'
      const start = node('n', kind, { modelKey: archetype.id, archetype: { id: archetype.id } })
      seed(start)
      for (const id of nodeTryRecipes(start, { nodes: state().nodes, edges: state().edges }).map((recipe) => recipe.id)) {
        seed(start)
        runNodeTryRecipe('n', id)
        const target = state().nodes.find((candidate) => candidate.id === 'n')!
        const resolved = effectiveArchetypeMode(archetypeForNode(target)!, target, { nodes: state().nodes, edges: state().edges })
        expect(state().edges.length, `${id} 连上了东西`).toBeGreaterThan(0)
        expect(resolved.status, id).toBe('ok')
        expect(resolved.taken, id).toBe(state().edges.length)
        if (BECOMES[id]) expect(modeDisplayKind(archetypeForNode(target)!, resolved.mode), id).toBe(BECOMES[id])
      }
    })
  }
})

describe('running a task builds structure only, in one undo step', () => {
  it('图生视频: one upstream image wired as first frame, the card now sends image-to-video, prompt focused', () => {
    seed(node('v', 'video', { archetype: { id: 'seedance-2', modeId: 't2v' } }))
    const before = state().readDocumentSnapshot()
    runNodeTryRecipe('v', 'video.firstFrame')
    const added = state().nodes.filter((candidate) => candidate.id !== 'v')
    expect(added.map((candidate) => candidate.kind)).toEqual(['image'])
    expect(state().edges).toEqual([expect.objectContaining({ source: added[0].id, target: 'v', mode: 'first_frame' })])
    expect(modeOf('v')).toBe('first')
    expect(added[0].position.x).toBeLessThan(600)
    expect(useNodePromptFocusStore.getState().request?.nodeId).toBe('v')
    expect(nothingSpent()).toBe(true)
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('首尾帧: two upstream images, first + last frame, sends first & last frame', () => {
    seed(node('v', 'video', { archetype: { id: 'seedance-2', modeId: 't2v' } }))
    const before = state().readDocumentSnapshot()
    runNodeTryRecipe('v', 'video.firstLast')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['first_frame', 'last_frame'])
    expect(modeOf('v')).toBe('firstlast')
    expect(nothingSpent()).toBe(true)
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('首尾帧 on a card with no model yet still wires first + last frame', () => {
    seed(node('v', 'video'))
    runNodeTryRecipe('v', 'video.firstLast')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['first_frame', 'last_frame'])
  })

  it('参考图生图: one upstream image as a reference, the card now sends with a reference image', () => {
    seed(node('i', 'image', { archetype: { id: 'gpt-image-2', modeId: 't2i' } }))
    const before = state().readDocumentSnapshot()
    runNodeTryRecipe('i', 'image.reference')
    const added = state().nodes.filter((candidate) => candidate.id !== 'i')
    expect(added.map((candidate) => candidate.kind)).toEqual(['image'])
    expect(state().edges).toEqual([expect.objectContaining({ source: added[0].id, target: 'i' })])
    expect(modeOf('i')).toBe('i2i')
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })
})

describe('a task that no longer holds does nothing when run (stale click)', () => {
  it('2 images already in → 图生视频 adds nothing', () => {
    seed(node('v', 'video', { archetype: { id: 'seedance-2' }, referenceImageUrls: ['nomi-local://a', 'nomi-local://b'] }))
    runNodeTryRecipe('v', 'video.firstFrame')
    expect(state().nodes).toHaveLength(1)
    expect(state().edges).toEqual([])
  })
})
