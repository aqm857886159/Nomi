// 空节点「试试」：每个配方**只搭结构**——建好该连的上游 / 下游空节点、切到对应生成方式、把光标放进提示词框；
// 不生成、不派发、不花钱，整个配方一步撤销（2026-10-08 用户拍板 ③）。
// 花钱入口的结构钉子在 deriveFromNode.noMoneyDoor.test.ts（扫整个 quickActions 目录，配方文件也在里面）。
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { useNodePromptFocusStore } from '../nodes/nodePromptFocus'
import { nodeTryRecipes, runNodeTryRecipe } from './nodeTryRecipes'

const state = () => useGenerationCanvasStore.getState()
function node(id: string, kind: GenerationNodeKind, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 600, y: 200 }, size: { width: 420, height: 240 }, categoryId: 'shots', status: 'idle', meta }
}
const seed = (...nodes: GenerationCanvasNode[]) => state().restoreSnapshot({ nodes, edges: [], groups: [] })
const ids = (target: GenerationCanvasNode) => nodeTryRecipes(target).map((recipe) => recipe.id)
const modeOf = (id: string) => (state().nodes.find((candidate) => candidate.id === id)?.meta?.archetype as { modeId?: string } | undefined)?.modeId
const nothingSpent = () => state().nodes.every((candidate) => (candidate.status ?? 'idle') === 'idle' && !candidate.runs?.length && !candidate.result)

beforeEach(() => {
  __resetGenerationCanvasHistoryForTests()
  seed()
  useNodePromptFocusStore.setState({ request: null })
})

describe('which tasks an empty card offers', () => {
  it('image / video / text each list their real tasks', () => {
    expect(ids(node('i', 'image'))).toEqual(['image.text', 'image.reference'])
    expect(ids(node('v', 'video'))).toEqual(['video.firstFrame', 'video.firstLast', 'video.text'])
    expect(ids(node('t', 'text'))).toEqual(['text.toImage', 'text.toVideo'])
  })

  it('drops a task the chosen model cannot do (no first + last frame workflow)', () => {
    expect(ids(node('v', 'video', { archetype: { id: 'kling-3.0-turbo', modeId: 't2v' } }))).toEqual(['video.firstFrame', 'video.text'])
  })

  it('kinds without recipes offer none', () => {
    expect(ids(node('a', 'asset'))).toEqual([])
    expect(ids(node('c', 'clip'))).toEqual([])
  })
})

describe('running a task builds structure only, in one undo step', () => {
  it('首帧生视频: one upstream image wired as first frame, video switched to the first-frame workflow, prompt focused', () => {
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

  it('首尾帧生视频: two upstream images, first + last frame, firstlast workflow', () => {
    seed(node('v', 'video', { archetype: { id: 'seedance-2', modeId: 't2v' } }))
    const before = state().readDocumentSnapshot()
    runNodeTryRecipe('v', 'video.firstLast')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['first_frame', 'last_frame'])
    expect(modeOf('v')).toBe('firstlast')
    expect(nothingSpent()).toBe(true)
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('首尾帧生视频 on a card with no model yet still wires first + last frame', () => {
    seed(node('v', 'video'))
    runNodeTryRecipe('v', 'video.firstLast')
    expect(state().edges.map((edge) => edge.mode)).toEqual(['first_frame', 'last_frame'])
  })

  it('文字生视频 switches to the text workflow and adds nothing', () => {
    seed(node('v', 'video', { archetype: { id: 'seedance-2', modeId: 'first' } }))
    runNodeTryRecipe('v', 'video.text')
    expect(state().nodes).toHaveLength(1)
    expect(modeOf('v')).toBe('t2v')
    expect(useNodePromptFocusStore.getState().request?.nodeId).toBe('v')
  })

  it('参考图生图: one upstream image as a reference, image switched to the image-reference workflow', () => {
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

  it('拿它生图: one downstream image fed by the text, selected and focused', () => {
    seed(node('t', 'text'))
    const before = state().readDocumentSnapshot()
    runNodeTryRecipe('t', 'text.toImage')
    const added = state().nodes.filter((candidate) => candidate.id !== 't')
    expect(added.map((candidate) => candidate.kind)).toEqual(['image'])
    expect(state().edges).toEqual([expect.objectContaining({ source: 't', target: added[0].id })])
    expect(added[0].position.x).toBeGreaterThan(600 + 420)
    expect(state().selectedNodeIds).toEqual([added[0].id])
    expect(useNodePromptFocusStore.getState().request?.nodeId).toBe(added[0].id)
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })
})
