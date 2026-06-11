import { describe, expect, it } from 'vitest'
import { createConversationBuckets } from './aiConversationBuckets'
import { useWorkbenchStore } from './workbenchStore'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import { swapGenerationAiProject } from './generationCanvas/store/generationAiConversation'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'

const msg = (text: string): WorkbenchAiMessage => ({ id: `m-${text}`, role: 'user', content: text }) as WorkbenchAiMessage

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

describe('store swap actions', () => {
  it('workbenchStore:切项目后创作面板气泡不串台', () => {
    const store = useWorkbenchStore.getState()
    store.setCreationAiMessages([msg('hello-A')])
    store.swapCreationAiProject('proj-A', 'proj-B')
    expect(useWorkbenchStore.getState().creationAiMessages).toEqual([])
    useWorkbenchStore.getState().setCreationAiMessages([msg('hello-B')])
    useWorkbenchStore.getState().swapCreationAiProject('proj-B', 'proj-A')
    expect(useWorkbenchStore.getState().creationAiMessages.map((m) => m.content)).toEqual(['hello-A'])
  })

  it('generationCanvasStore:切项目后画布助手气泡不串台(外挂模块,不喂巨壳)', () => {
    useGenerationCanvasStore.getState().setGenerationAiMessages([msg('canvas-A')])
    swapGenerationAiProject('gp-A', 'gp-B')
    expect(useGenerationCanvasStore.getState().generationAiMessages).toEqual([])
    useGenerationCanvasStore.getState().setGenerationAiMessages([msg('canvas-B')])
    swapGenerationAiProject('gp-B', 'gp-A')
    expect(useGenerationCanvasStore.getState().generationAiMessages.map((m) => m.content)).toEqual(['canvas-A'])
  })
})
