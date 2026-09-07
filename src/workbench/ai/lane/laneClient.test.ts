// 渲染层订阅：本层**零状态机**。所以这一族测试问的都是「它有没有偷偷记账」。
import { describe, expect, it, vi } from 'vitest'

import type { LaneCommand, LaneProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { EMPTY_LANE_PROJECTION, createLaneClient, resolveLaneBridge, type LaneBridge } from './laneClient'

function fakeBridge() {
  const listeners = new Set<(projection: LaneProjection) => void>()
  const sent: LaneCommand[] = []
  const bridge: LaneBridge = {
    onProjection: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    send: async (command) => { sent.push(command); return { ok: true } },
  }
  return { bridge, sent, listenerCount: () => listeners.size, push: (projection: LaneProjection) => { for (const l of listeners) l(projection) } }
}

const projection = (text: string): LaneProjection => ({
  lane: 'main', running: false,
  parts: [{ sequence: 0, entrySeq: 0, contentIndex: 0, kind: 'user', text }],
  usage: {
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2,
    // 三行三态。这份夹具只关心「订阅有没有偷偷记账」，所以三行都停在「还没结算」那一态——
    // 但它们**必须存在**：`LaneUsage` 里没有「省略即 0」这条路了。
    cost: { state: 'unknown', reason: 'no-settled-turn' },
    contextTokens: { state: 'unknown', reason: 'no-settled-turn' },
    reasoningTokens: { state: 'unknown', reason: 'no-settled-turn' },
  },
  thinking: { supportedLevels: ['off'], level: 'off', canTurnOff: true },
})

describe('laneClient', () => {
  it('is unreachable in this build — that is the shadow period, not a bug', () => {
    // preload 没暴露 `agentLane`，`main.ts` 也没注册那两条通道（规则 O6）。
    expect(resolveLaneBridge({})).toBeUndefined()
    expect(resolveLaneBridge({ nomiDesktop: {} })).toBeUndefined()
    expect(resolveLaneBridge(undefined)).toBeUndefined()
  })

  it('keeps a stable snapshot reference until a new projection actually arrives', () => {
    // 引用不稳的 getter 在仓库里出过事：有待决工具时整页打成「工作台加载失败」（G6 判据②）。
    // `useSyncExternalStore` 会拿这个引用判断「变没变」，每次新建对象 = 每次都说「变了」。
    const { bridge, push } = fakeBridge()
    const client = createLaneClient(bridge)
    const first = client.projection()
    expect(client.projection()).toBe(first)
    const next = projection('hello')
    push(next)
    expect(client.projection()).toBe(next)
    expect(client.projection()).toBe(next)
  })

  it('starts from an empty projection, not from undefined', () => {
    const client = createLaneClient(fakeBridge().bridge)
    expect(client.projection()).toBe(EMPTY_LANE_PROJECTION)
    // 「这条 lane 还没有内容」和「出错了」是两句话。空投影说的是前者。
    expect(client.projection().parts).toEqual([])
  })

  it('fans a projection out to every subscriber and stops when they unsubscribe', () => {
    const { bridge, push } = fakeBridge()
    const client = createLaneClient(bridge)
    const seen: string[] = []
    const stop = client.subscribe(() => seen.push('a'))
    client.subscribe(() => seen.push('b'))
    push(projection('one'))
    stop()
    push(projection('two'))
    expect(seen).toEqual(['a', 'b', 'b'])
  })

  it('sends only the two commands the renderer is allowed to say', async () => {
    const { bridge, sent } = fakeBridge()
    const client = createLaneClient(bridge)
    await client.prompt('Append a line.')
    await client.abort()
    expect(sent).toEqual([{ kind: 'prompt', text: 'Append a line.' }, { kind: 'abort' }])
  })

  it('answers with a named failure when the bridge is absent, instead of throwing or pretending', async () => {
    const client = createLaneClient(undefined)
    await expect(client.prompt('hi')).resolves.toEqual({
      ok: false, code: 'agent_lane_bridge_absent',
      message: 'The agent lane bridge is not exposed in this build.',
    })
  })

  it('releases the bridge subscription on dispose, so a closed panel stops holding the lane', () => {
    const { bridge, listenerCount } = fakeBridge()
    const client = createLaneClient(bridge)
    expect(listenerCount()).toBe(1)
    client.dispose()
    expect(listenerCount()).toBe(0)
  })

  it('never mutates or re-derives what the main process sent', () => {
    const { bridge, push } = fakeBridge()
    const client = createLaneClient(bridge)
    const sent = projection('untouched')
    const spy = vi.spyOn(Array.prototype, 'sort')
    push(sent)
    expect(client.projection()).toBe(sent)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('四个动作里的三个走同一条命令，第四个是 abort——「停」停的是整轮，不是这一次', async () => {
    const sent: unknown[] = []
    const client = createLaneClient({
      onProjection: () => () => {},
      send: async (command) => { sent.push(command); return { ok: true } },
    })
    await client.approve('call-1')
    await client.approveForSession('call-1')
    await client.deny('call-1', '不对，横屏')
    await client.deny('call-1', '   ')
    await client.abort()
    expect(sent).toEqual([
      { kind: 'approval', toolCallId: 'call-1', action: 'allow-once' },
      { kind: 'approval', toolCallId: 'call-1', action: 'allow-session' },
      { kind: 'approval', toolCallId: 'call-1', action: 'deny', reason: '不对，横屏' },
      // 空白理由不过桥：默认文案由主进程决定，不由一串空格决定。
      { kind: 'approval', toolCallId: 'call-1', action: 'deny' },
      { kind: 'abort' },
    ])
  })

  it('按停止时没送出去的话原样交回调用方——它要回到输入框，不是被丢掉', async () => {
    const client = createLaneClient({
      onProjection: () => () => {},
      send: async () => ({ ok: true, restoredInput: ['不对，横屏'] }),
    })
    const result = await client.abort()
    expect(result).toEqual({ ok: true, restoredInput: ['不对，横屏'] })
  })
})
