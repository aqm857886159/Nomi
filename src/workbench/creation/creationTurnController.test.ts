import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCreationTurnStore, abandonCreationTurn } from './creationTurnController'

function reset(): void {
  // 每例从干净态起（store 是模块级单例）。
  abandonCreationTurn()
  useCreationTurnStore.setState({ pendingToolCalls: [] })
}

afterEach(() => {
  reset()
  vi.restoreAllMocks()
})

describe('creationTurnController', () => {
  it('begin 开一轮:sending 置真、isCurrent 真', () => {
    const turn = useCreationTurnStore.getState().begin()
    expect(useCreationTurnStore.getState().sending).toBe(true)
    expect(turn.isCurrent()).toBe(true)
  })

  it('第二次 begin 作废第一轮(旧 isCurrent 假),自身仍流式', () => {
    const first = useCreationTurnStore.getState().begin()
    const second = useCreationTurnStore.getState().begin()
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    expect(useCreationTurnStore.getState().sending).toBe(true)
  })

  it('finish 当前轮:sending 归零;finish 过期轮:无副作用', () => {
    const stale = useCreationTurnStore.getState().begin()
    const current = useCreationTurnStore.getState().begin()
    useCreationTurnStore.getState().finish(stale.id) // 过期 → 不动
    expect(useCreationTurnStore.getState().sending).toBe(true)
    useCreationTurnStore.getState().finish(current.id)
    expect(useCreationTurnStore.getState().sending).toBe(false)
  })

  it('finish expires the running turn approval before its rejection callback can write', () => {
    const turn = useCreationTurnStore.getState().begin()
    const stateAtConfirm: Array<{ writable: boolean; pending: number }> = []
    const confirm = vi.fn(async () => {
      stateAtConfirm.push({ writable: turn.canWrite(), pending: useCreationTurnStore.getState().pendingToolCalls.length })
    })
    useCreationTurnStore.getState().addPendingToolCall({
      toolCallId: 'expired-tool', toolName: 'append_to_end', content: 'must not write', confirm,
    })
    useCreationTurnStore.getState().finish(turn.id)
    expect(turn.canWrite()).toBe(false)
    expect(useCreationTurnStore.getState().pendingToolCalls).toEqual([])
    expect(confirm).toHaveBeenCalledWith({ ok: false, denied: true, message: expect.any(String) })
    expect(stateAtConfirm).toEqual([{ writable: false, pending: 0 }])
  })

  it('a stale terminal callback cannot expire the new running turn approval', () => {
    const stale = useCreationTurnStore.getState().begin()
    const current = useCreationTurnStore.getState().begin()
    const confirm = vi.fn(async () => {})
    const call = { toolCallId: 'current-tool', toolName: 'append_to_end' as const, content: 'new', confirm }
    useCreationTurnStore.getState().addPendingToolCall(call)
    useCreationTurnStore.getState().finish(stale.id)
    expect(current.canWrite()).toBe(true)
    expect(useCreationTurnStore.getState().pendingToolCalls).toEqual([call])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('a repeated terminal callback preserves a local chatStory card created before the next begin', () => {
    const completed = useCreationTurnStore.getState().begin()
    useCreationTurnStore.getState().finish(completed.id)
    const confirm = vi.fn(async () => {})
    const call = { toolCallId: 'local-script-draft', toolName: 'append_to_end' as const, content: 'local draft', confirm }
    useCreationTurnStore.getState().addPendingToolCall(call)
    useCreationTurnStore.getState().finish(completed.id)
    expect(useCreationTurnStore.getState().sending).toBe(false)
    expect(useCreationTurnStore.getState().pendingToolCalls).toEqual([call])
    useCreationTurnStore.getState().resolvePendingToolCall(call.toolCallId, { ok: true })
    expect(confirm).toHaveBeenCalledExactlyOnceWith({ ok: true })
  })

  it('attachCancel 仅对当前轮生效;requestUserCancel 调句柄但保留当前轮', () => {
    const cancel = vi.fn()
    const turn = useCreationTurnStore.getState().begin()
    useCreationTurnStore.getState().attachCancel(turn.id, cancel)
    useCreationTurnStore.getState().requestUserCancel()
    expect(cancel).toHaveBeenCalledTimes(1)
    // 用户停止保留当前轮(让 resolved 分支把气泡落到 cancelled),sending 仍真直到 finish。
    expect(turn.isCurrent()).toBe(true)
    expect(useCreationTurnStore.getState().sending).toBe(true)
  })

  it('attachCancel 对过期轮无效', () => {
    const cancel = vi.fn()
    const stale = useCreationTurnStore.getState().begin()
    useCreationTurnStore.getState().begin() // 作废 stale
    useCreationTurnStore.getState().attachCancel(stale.id, cancel)
    expect(useCreationTurnStore.getState().cancel).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('Stop 在句柄到达前发生也会取消，重复 Stop 不重复发取消', () => {
    const turn = useCreationTurnStore.getState().begin()
    const cancel = vi.fn()
    useCreationTurnStore.getState().requestUserCancel()
    useCreationTurnStore.getState().requestUserCancel()
    useCreationTurnStore.getState().attachCancel(turn.id, cancel)
    expect(cancel).toHaveBeenCalledTimes(1)
    useCreationTurnStore.getState().requestUserCancel()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(turn.isCurrent()).toBe(true)
  })

  it('新轮次先作废旧 token 再取消旧传输，迟到同步回调不能写入', () => {
    const first = useCreationTurnStore.getState().begin()
    const currentAtCancel: boolean[] = []
    useCreationTurnStore.getState().attachCancel(first.id, () => currentAtCancel.push(first.isCurrent()))
    const second = useCreationTurnStore.getState().begin()
    expect(currentAtCancel).toEqual([false])
    expect(second.isCurrent()).toBe(true)
  })

  it('abandon 先使旧 token 失效，再调用可能同步回调的取消句柄', () => {
    const turn = useCreationTurnStore.getState().begin()
    const currentAtCancel: boolean[] = []
    useCreationTurnStore.getState().attachCancel(turn.id, () => currentAtCancel.push(turn.isCurrent()))
    abandonCreationTurn()
    expect(currentAtCancel).toEqual([false])
  })

  it('abandon 中止在途:调句柄、作废轮次、sending 归零、清空并拒绝写卡', () => {
    const cancel = vi.fn()
    const reject = vi.fn(async () => {})
    const turn = useCreationTurnStore.getState().begin()
    useCreationTurnStore.getState().attachCancel(turn.id, cancel)
    useCreationTurnStore.getState().addPendingToolCall({
      toolCallId: 't1', toolName: 'insert_at_cursor', content: 'x', confirm: reject,
    })
    abandonCreationTurn()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(turn.isCurrent()).toBe(false)
    expect(useCreationTurnStore.getState().sending).toBe(false)
    expect(useCreationTurnStore.getState().pendingToolCalls).toHaveLength(0)
    expect(reject).toHaveBeenCalledWith({ ok: false, denied: true, message: expect.any(String) })
  })

  it('abandon 后旧轮 onContent 守卫:isCurrent 假', () => {
    const turn = useCreationTurnStore.getState().begin()
    abandonCreationTurn()
    expect(turn.isCurrent()).toBe(false)
  })

  it('nextMessageId 唯一并保留 role 前缀', () => {
    const a = useCreationTurnStore.getState().nextMessageId('user')
    const b = useCreationTurnStore.getState().nextMessageId('assistant')
    const c = useCreationTurnStore.getState().nextMessageId('user')
    expect(new Set([a, b, c]).size).toBe(3)
    expect(a).toMatch(/^creation_ai_user_.+$/)
    expect(b).toMatch(/^creation_ai_assistant_.+$/)
  })

  it('resolvePendingToolCall 调 confirm 并移除指定卡', () => {
    const c1 = vi.fn(async () => {})
    const c2 = vi.fn(async () => {})
    useCreationTurnStore.getState().addPendingToolCall({
      toolCallId: 't1', toolName: 'append_to_end', content: 'a', confirm: c1,
    })
    useCreationTurnStore.getState().addPendingToolCall({
      toolCallId: 't2', toolName: 'append_to_end', content: 'b', confirm: c2,
    })
    useCreationTurnStore.getState().resolvePendingToolCall('t1', { ok: true })
    expect(c1).toHaveBeenCalledWith({ ok: true })
    expect(c2).not.toHaveBeenCalled()
    const remaining = useCreationTurnStore.getState().pendingToolCalls
    expect(remaining.map((c) => c.toolCallId)).toEqual(['t2'])
  })
})
