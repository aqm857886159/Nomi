/**
 * 「我的库」列表的共享缓存：唯一持有者的几条规矩。
 * 写口 / 读口发布、hook 订阅的整条链路在 promptLibraryApi.test.ts 与 useUserPrompts.behavior.test.tsx。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryPrompt } from '../api/promptLibraryApi'

const logged = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('../../desktop/rendererLog', () => ({
  logRendererError: (...args: unknown[]) => { logged.calls.push(args) },
}))

import {
  beginUserPromptRequest,
  getUserPromptsSnapshot,
  hasLoadedUserPrompts,
  publishUserPrompts,
  resetUserPromptListForTests,
  subscribeUserPrompts,
} from './userPromptList'

const prompt = (id: string): LibraryPrompt => ({
  id, title: id, prompt: id, mediaUrl: '', mediaType: 'image', promptType: 'image',
  tags: [], source: '', sourceId: '', sourceUrl: '', origin: 'user',
})
const ids = (items: LibraryPrompt[]): string[] => items.map((item) => item.id)

/** 订阅者活在模块级：每个用例订阅的都在用例结束时退掉，免得上一个用例的（比如会抛错的）串进下一个。 */
const unsubscribers: Array<() => void> = []
function subscribe(listener: () => void): () => void {
  const off = subscribeUserPrompts(listener)
  unsubscribers.push(off)
  return off
}

describe('userPromptList', () => {
  beforeEach(() => {
    resetUserPromptListForTests()
    logged.calls.length = 0
  })

  afterEach(() => {
    for (const off of unsubscribers.splice(0)) off()
  })

  it('没载入过时是同一个冻住的空数组（引用稳定，useSyncExternalStore 才不会反复重渲），且不算「已载入」', () => {
    expect(hasLoadedUserPrompts()).toBe(false)
    expect(getUserPromptsSnapshot()).toEqual([])
    expect(getUserPromptsSnapshot()).toBe(getUserPromptsSnapshot())
    expect(Object.isFrozen(getUserPromptsSnapshot())).toBe(true)
  })

  it('发布后换成新整表、算已载入；到下一次发布之前引用不变；发布空表也算载入', () => {
    const list = [prompt('a')]
    expect(publishUserPrompts(list, beginUserPromptRequest())).toBe(true)
    expect(hasLoadedUserPrompts()).toBe(true)
    expect(getUserPromptsSnapshot()).toBe(list)
    expect(getUserPromptsSnapshot()).toBe(getUserPromptsSnapshot())

    const emptied: LibraryPrompt[] = []
    publishUserPrompts(emptied, beginUserPromptRequest())
    expect(getUserPromptsSnapshot()).toBe(emptied)
    expect(hasLoadedUserPrompts()).toBe(true)
  })

  it('每次被接受的发布叫醒每个订阅者一次，退订后不再叫', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = subscribe(first)
    subscribe(second)
    publishUserPrompts([prompt('a')], beginUserPromptRequest())
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1])
    offFirst()
    publishUserPrompts([prompt('b')], beginUserPromptRequest())
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 2])
  })

  it('按发起顺序发布：晚到的旧应答（号更小）被丢掉，缓存不回退、订阅者也不被叫醒', () => {
    const slowRead = beginUserPromptRequest()
    const laterWrite = beginUserPromptRequest()
    publishUserPrompts([prompt('written')], laterWrite)
    const wake = vi.fn()
    subscribe(wake)

    expect(publishUserPrompts([prompt('stale-read')], slowRead)).toBe(false)
    expect(ids(getUserPromptsSnapshot())).toEqual(['written'])
    expect(wake).not.toHaveBeenCalled()
  })

  it('按序到达的两次发布都落地（后发起的覆盖先发起的）', () => {
    const first = beginUserPromptRequest()
    const second = beginUserPromptRequest()
    expect(publishUserPrompts([prompt('one')], first)).toBe(true)
    expect(publishUserPrompts([prompt('two')], second)).toBe(true)
    expect(ids(getUserPromptsSnapshot())).toEqual(['two'])
  })

  it('一个订阅者抛错：发布不抛、后面的订阅者照样被叫醒、错误进渲染层日志（一次已成功的写不能因此变成「写失败」）', () => {
    const boom = new Error('listener exploded')
    const after = vi.fn()
    subscribe(() => { throw boom })
    subscribe(after)

    expect(() => publishUserPrompts([prompt('a')], beginUserPromptRequest())).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(ids(getUserPromptsSnapshot())).toEqual(['a'])
    expect(logged.calls).toEqual([['user-prompt-listener-failed', boom]])
  })

  it('订阅者在被叫醒时退订自己，不会让后面的订阅者被漏叫', () => {
    const order: string[] = []
    const offSelf = subscribe(() => { order.push('self'); offSelf() })
    subscribe(() => { order.push('next') })
    publishUserPrompts([prompt('a')], beginUserPromptRequest())
    expect(order).toEqual(['self', 'next'])
  })

  it('测试复位：忘掉列表和号，但订阅者留着并被叫醒（挂着的 hook 不该因为复位丢订阅）', () => {
    publishUserPrompts([prompt('a')], beginUserPromptRequest())
    const wake = vi.fn()
    subscribe(wake)

    resetUserPromptListForTests()
    expect(hasLoadedUserPrompts()).toBe(false)
    expect(getUserPromptsSnapshot()).toEqual([])
    expect(wake).toHaveBeenCalledTimes(1)

    // 号也复位了：复位前发起的老号不会挡住复位后的第一次发布。
    expect(publishUserPrompts([prompt('b')], beginUserPromptRequest())).toBe(true)
    expect(wake).toHaveBeenCalledTimes(2)
  })
})
