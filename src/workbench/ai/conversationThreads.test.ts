import { describe, expect, it, beforeEach } from 'vitest'
import type { WorkbenchAiMessage } from './workbenchAiTypes'
import {
  __resetConversationThreadsForTests,
  activateThread,
  deriveThreadTitle,
  getActiveThreadId,
  hydrateArea,
  listThreads,
  removeThread,
  serializeArea,
  startNewThread,
  syncActiveMessages,
} from './conversationThreads'

const PID = 'proj-1'
const msg = (id: string, role: WorkbenchAiMessage['role'], content: string): WorkbenchAiMessage => ({ id, role, content })

beforeEach(() => __resetConversationThreadsForTests())

describe('deriveThreadTitle', () => {
  it('跳过寒暄,取首条实质 user 文本', () => {
    expect(deriveThreadTitle([msg('1', 'user', '在吗'), msg('2', 'user', '帮我写产品开场白')])).toBe('帮我写产品开场白')
  })
  it('全是寒暄→退而取第一条 user', () => {
    expect(deriveThreadTitle([msg('1', 'user', '在吗')])).toBe('在吗')
  })
  it('超长截断到 24 字', () => {
    const long = '一'.repeat(40)
    expect(deriveThreadTitle([msg('1', 'user', long)]).length).toBe(24)
  })
})

describe('线程归档不销毁', () => {
  it('新对话:当前非空线程留在列表,新建空线程为活动', () => {
    syncActiveMessages(PID, 'creation', [msg('u1', 'user', '甲对话')], 100)
    const firstId = getActiveThreadId(PID, 'creation', 100)
    startNewThread(PID, 'creation', 200)
    const secondId = getActiveThreadId(PID, 'creation', 200)
    expect(secondId).not.toBe(firstId)
    // 旧线程仍在列表(归档,没销毁)。
    const ids = listThreads(PID, 'creation', 200).map((t) => t.id)
    expect(ids).toContain(firstId)
    expect(ids).toContain(secondId)
  })

  it('当前活动为空→新对话复用,不堆叠空线程', () => {
    const before = getActiveThreadId(PID, 'creation', 100)
    startNewThread(PID, 'creation', 200)
    expect(getActiveThreadId(PID, 'creation', 200)).toBe(before)
    expect(listThreads(PID, 'creation', 200)).toHaveLength(1)
  })

  it('切回旧线程:活动切换,返回旧线程气泡', () => {
    syncActiveMessages(PID, 'creation', [msg('u1', 'user', '甲')], 100)
    const oldId = getActiveThreadId(PID, 'creation', 100)
    startNewThread(PID, 'creation', 200)
    syncActiveMessages(PID, 'creation', [msg('u2', 'user', '乙')], 210)
    const target = activateThread(PID, 'creation', oldId, 300)
    expect(target?.messages.map((m) => m.content)).toEqual(['甲'])
    expect(getActiveThreadId(PID, 'creation', 300)).toBe(oldId)
  })

  it('不能删活动线程,能删归档线程', () => {
    syncActiveMessages(PID, 'creation', [msg('u1', 'user', '甲')], 100)
    const oldId = getActiveThreadId(PID, 'creation', 100)
    startNewThread(PID, 'creation', 200)
    const activeId = getActiveThreadId(PID, 'creation', 200)
    expect(removeThread(PID, 'creation', activeId, 300)).toBe(false)
    expect(removeThread(PID, 'creation', oldId, 300)).toBe(true)
    expect(listThreads(PID, 'creation', 300).map((t) => t.id)).toEqual([activeId])
  })
})

describe('序列化 ↔ 迁灌 往返', () => {
  it('serialize 后 hydrate 保留线程列表 + 活动 + 气泡', () => {
    syncActiveMessages(PID, 'creation', [msg('u1', 'user', '甲')], 100)
    const oldId = getActiveThreadId(PID, 'creation', 100)
    startNewThread(PID, 'creation', 200)
    syncActiveMessages(PID, 'creation', [msg('u2', 'user', '乙')], 210)
    const activeId = getActiveThreadId(PID, 'creation', 210)
    const persisted = serializeArea(PID, 'creation', 210)

    __resetConversationThreadsForTests()
    const restoredActiveMessages = hydrateArea('proj-2', 'creation', persisted, 999)
    expect(restoredActiveMessages.map((m) => m.content)).toEqual(['乙'])
    expect(getActiveThreadId('proj-2', 'creation', 999)).toBe(activeId)
    const ids = listThreads('proj-2', 'creation', 999).map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining([oldId, activeId]))
  })

  it('hydrate 空/null → 建空活动线程', () => {
    const messages = hydrateArea(PID, 'generation', null, 100)
    expect(messages).toEqual([])
    expect(listThreads(PID, 'generation', 100)).toHaveLength(1)
  })
})
