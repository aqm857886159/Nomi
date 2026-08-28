import { describe, expect, it } from 'vitest'
import { createConversationBuckets } from './aiConversationBuckets'
import { useWorkbenchStore } from './workbenchStore'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import { swapGenerationAiProject } from './generationCanvas/store/generationAiConversation'

describe('createConversationBuckets', () => {
  it('A→B→A:各项目对话各归各位(S1 串台回归锁)', () => {
    const buckets = createConversationBuckets(() => ({ messages: [] as string[] }))
    let current = { messages: ['a1'] }
    current = buckets.swap('A', 'B', current) // 切到 B:空
    expect(current.messages).toEqual([])
    current = { messages: ['b1'] }
    current = buckets.swap('B', 'A', current) // 切回 A:还在
    expect(current.messages).toEqual(['a1'])
    current = buckets.swap('A', 'B', current) // 再到 B:b1 还在
    expect(current.messages).toEqual(['b1'])
  })

  it('首次进入(prev=null)不存桶只载空', () => {
    const buckets = createConversationBuckets(() => ({ messages: [] as string[] }))
    expect(buckets.swap(null, 'A', { messages: ['stale'] }).messages).toEqual([])
  })
})

// Canonical transcript belongs to ProjectAgentHost. Buckets exchange only
// unsent composer state such as drafts and attachment errors.
describe('store swap actions', () => {
  it('workbenchStore:创作区 draft 各归各位', () => {
    const store = useWorkbenchStore.getState()
    store.setCreationAiDraft('draft-A')
    store.swapCreationAiProject('proj-A', 'proj-B')
    expect(useWorkbenchStore.getState().creationAiDraft).toBe('')
    useWorkbenchStore.getState().setCreationAiDraft('draft-B')
    useWorkbenchStore.getState().swapCreationAiProject('proj-B', 'proj-A')
    expect(useWorkbenchStore.getState().creationAiDraft).toBe('draft-A')
  })

  it('generationCanvasStore:画布助手 draft 各归各位(外挂模块,不喂巨壳)', () => {
    useGenerationCanvasStore.getState().setGenerationAiDraft('canvas-A')
    swapGenerationAiProject('gp-A', 'gp-B')
    expect(useGenerationCanvasStore.getState().generationAiDraft).toBe('')
    useGenerationCanvasStore.getState().setGenerationAiDraft('canvas-B')
    swapGenerationAiProject('gp-B', 'gp-A')
    expect(useGenerationCanvasStore.getState().generationAiDraft).toBe('canvas-A')
  })
})
