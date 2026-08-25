import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useSpendConfirmStore } from './spendConfirm'

// B4 确认竞态收口（plan 2026-08-11-mcp-conversation-native-phase-b）：
// 根治「单槽覆盖」——pending 单槽时，第二个 requestConfirm 会直接冲掉第一个，
// 前一个的 resolve 永不触发（调用方那头永远挂着）。改 FIFO 队列：一次显示一个，
// 前一个决议后自动出下一个，两个 resolve 都会兑现、互不覆盖。

function resetStore() {
  useSpendConfirmStore.setState({ pending: null, queue: [], lightSuppressed: false })
}

describe('spendConfirm FIFO 队列 (B4 · 竞态不丢 resolve)', () => {
  beforeEach(resetStore)

  it('两个审批同时来：第二个不覆盖第一个，两个 resolve 都兑现（FIFO）', async () => {
    const store = useSpendConfirmStore.getState()
    // 两个请求几乎同时发起（第二个到来时第一个还在显）。
    const p1 = store.requestConfirm({ title: '合同 A', message: '批准 A？', source: 'agent' })
    const p2 = store.requestConfirm({ title: '合同 B', message: '批准 B？', source: 'agent' })

    // 只显第一个；第二个排队等候（根治：没被冲掉）。
    expect(useSpendConfirmStore.getState().pending?.title).toBe('合同 A')
    expect(useSpendConfirmStore.getState().queue).toHaveLength(1)
    expect(useSpendConfirmStore.getState().queue[0]?.title).toBe('合同 B')

    // 决议第一个 → 第二个自动晋升到显示位。
    useSpendConfirmStore.getState().resolvePending(true)
    await expect(p1).resolves.toBe(true)
    expect(useSpendConfirmStore.getState().pending?.title).toBe('合同 B')
    expect(useSpendConfirmStore.getState().queue).toHaveLength(0)

    // 决议第二个 → 队列清空，两个 resolve 都兑现（旧 bug 下 p1 永远挂着）。
    useSpendConfirmStore.getState().resolvePending(false)
    await expect(p2).resolves.toBe(false)
    expect(useSpendConfirmStore.getState().pending).toBeNull()
  })

  it('三个连发：严格 FIFO 顺序逐个显示，各自独立决议', async () => {
    const store = useSpendConfirmStore.getState()
    const results: Array<boolean> = []
    const p1 = store.requestConfirm({ title: 'A', message: 'a' }).then((ok) => { results.push(ok); return ok })
    const p2 = store.requestConfirm({ title: 'B', message: 'b' }).then((ok) => { results.push(ok); return ok })
    const p3 = store.requestConfirm({ title: 'C', message: 'c' }).then((ok) => { results.push(ok); return ok })

    expect(useSpendConfirmStore.getState().pending?.title).toBe('A')
    expect(useSpendConfirmStore.getState().queue.map((q) => q.title)).toEqual(['B', 'C'])

    useSpendConfirmStore.getState().resolvePending(true) // A=true
    await p1
    expect(useSpendConfirmStore.getState().pending?.title).toBe('B')
    useSpendConfirmStore.getState().resolvePending(false) // B=false
    await p2
    expect(useSpendConfirmStore.getState().pending?.title).toBe('C')
    useSpendConfirmStore.getState().resolvePending(true) // C=true
    await p3

    expect(results).toEqual([true, false, true]) // 顺序与决议都对上
    expect(useSpendConfirmStore.getState().pending).toBeNull()
  })

  it('light 抑制仍即时短路（不入队、不占显示位）', async () => {
    useSpendConfirmStore.setState({ pending: null, queue: [], lightSuppressed: true })
    const ok = await useSpendConfirmStore.getState().requestConfirm({ title: 'X', message: 'x', light: true })
    expect(ok).toBe(true)
    expect(useSpendConfirmStore.getState().pending).toBeNull()
    expect(useSpendConfirmStore.getState().queue).toHaveLength(0)
  })

  it('勾选「本会话不再提示」在队列语义下仍生效（只对 light 请求短路后续）', async () => {
    const store = useSpendConfirmStore.getState()
    const p1 = store.requestConfirm({ title: 'A', message: 'a', light: true })
    store.resolvePending(true, true) // 确认并勾抑制
    await expect(p1).resolves.toBe(true)
    expect(useSpendConfirmStore.getState().lightSuppressed).toBe(true)
    // 后续 light 请求直接放行（不弹）。
    const p2 = store.requestConfirm({ title: 'B', message: 'b', light: true })
    await expect(p2).resolves.toBe(true)
    expect(useSpendConfirmStore.getState().pending).toBeNull()
  })

  it('resolves the merged hosting disclosure and remembers only when checked', async () => {
    const remember = vi.fn(async () => {})
    const promise = useSpendConfirmStore.getState().requestConfirm({
      title: '开始生成',
      message: '将生成 1 张画面',
      light: true,
      hostingDisclosure: { message: '素材会离开本机', rememberLabel: '记住我的选择', onRemember: remember },
    })
    expect(useSpendConfirmStore.getState().pending?.hostingDisclosure?.rememberLabel).toBe('记住我的选择')
    useSpendConfirmStore.getState().resolvePending(true, false, true)
    await expect(promise).resolves.toBe(true)
    expect(remember).toHaveBeenCalledTimes(1)
  })
})
