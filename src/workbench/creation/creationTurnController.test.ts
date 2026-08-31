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
    expect(reject).toHaveBeenCalledWith({ ok: false, message: expect.any(String) })
  })

  it('abandon 后旧轮 onContent 守卫:isCurrent 假', () => {
    const turn = useCreationTurnStore.getState().begin()
    abandonCreationTurn()
    expect(turn.isCurrent()).toBe(false)
  })

  it('nextMessageId 单调唯一', () => {
    const a = useCreationTurnStore.getState().nextMessageId('user')
    const b = useCreationTurnStore.getState().nextMessageId('assistant')
    const c = useCreationTurnStore.getState().nextMessageId('user')
    expect(new Set([a, b, c]).size).toBe(3)
    expect(a).toMatch(/^creation_ai_user_\d+$/)
    expect(b).toMatch(/^creation_ai_assistant_\d+$/)
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
