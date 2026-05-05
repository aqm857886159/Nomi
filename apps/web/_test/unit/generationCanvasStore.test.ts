import { beforeEach, describe, expect, it } from 'vitest'
import { __resetGenerationCanvasHistoryForTests, useGenerationCanvasStore } from '../../src/workbench/generationCanvasV2/store/generationCanvasStore'

function resetStore(): void {
  __resetGenerationCanvasHistoryForTests()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [] })
  useGenerationCanvasStore.getState().resetGenerationAiConversation()
}

describe('generationCanvasStore core user operations', () => {
  beforeEach(() => {
    resetStore()
  })

  it('creates, connects, edits, copies, pastes, and deletes nodes through one store boundary', () => {
    const store = useGenerationCanvasStore.getState()
    const text = store.addNode({ kind: 'text', title: '脚本', prompt: '第一幕' })
    const image = store.addNode({ kind: 'image', title: '画面', prompt: '雨夜街道' })

    useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)

    useGenerationCanvasStore.getState().updateNodePrompt(image.id, '电影感雨夜街道')
    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === image.id)?.prompt).toBe('电影感雨夜街道')

    useGenerationCanvasStore.getState().selectNode(image.id)
    useGenerationCanvasStore.getState().copySelectedNodes()
    useGenerationCanvasStore.getState().pasteNodes()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(3)

    useGenerationCanvasStore.getState().deleteSelectedNodes()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
  })

  it('keeps generation AI panel state in generation canvas store without persisting it in snapshots', () => {
    const store = useGenerationCanvasStore.getState()
    store.setGenerationAiDraft('用户草稿')
    store.setGenerationAiCollapsed(false)
    store.setGenerationAiMessages([{ id: 'm1', role: 'assistant', content: '回复' }])

    const snapshot = useGenerationCanvasStore.getState().readSnapshot()

    expect('generationAiDraft' in snapshot).toBe(false)
    expect('generationAiMessages' in snapshot).toBe(false)
    expect(useGenerationCanvasStore.getState().generationAiDraft).toBe('用户草稿')
  })

  it('restores snapshots without carrying stale selection for missing nodes', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: 'node-1',
          kind: 'image',
          title: '图片',
          position: { x: 0, y: 0 },
          prompt: '',
        },
      ],
      edges: [{ id: 'invalid-edge', source: 'missing', target: 'node-1' }],
      selectedNodeIds: ['node-1', 'missing'],
    })

    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual(['node-1'])
  })
})
