// 渲染层订阅：本层**零状态机**。所以这一族测试问的都是「它有没有偷偷记账」。
import { describe, expect, it, vi } from 'vitest'

import type {
  LaneProjection, LaneWorkspaceProjection,
} from '../../../../electron/shared/agentLane/laneContracts'
import type { LaneDesktopCommand } from '../../../../electron/shared/agentLane/laneDesktopContracts'
import {
  EMPTY_LANE_PROJECTION, EMPTY_LANE_WORKSPACE, createLaneClient, resolveLaneBridge, type LaneBridge,
} from './laneClient'

function fakeBridge() {
  const listeners = new Set<(projection: LaneWorkspaceProjection) => void>()
  const sent: LaneDesktopCommand[] = []
  const bridge: LaneBridge = {
    onProjection: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    send: async (command) => { sent.push(command); return { ok: true } },
  }
  return {
    bridge, sent, listenerCount: () => listeners.size,
    push: (projection: LaneWorkspaceProjection) => { for (const l of listeners) l(projection) },
  }
}

/** 一个只有一条对话的工作区。多 lane 那一族的断言在 `lane-multi.test.mts`（真落盘那一侧）。 */
const workspace = (active: LaneProjection): LaneWorkspaceProjection => ({
  lanes: [{ laneName: 'main', sessionId: 's-1', createdAt: 1, updatedAt: 2 }],
  active,
})

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
  queues: [],
})

describe('laneClient', () => {
  it('does not acknowledge release or discard the owner when main rejects close', async () => {
    const binding = { projectId: 'p', immutableProjectUuid: 'u', projectGeneration: 1 }
    const bridge = fakeBridge().bridge
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'w' })
      .mockResolvedValueOnce({ ok: false, code: 'agent_lane_execute_failed', diagnostic: 'storage close failed' })
      .mockResolvedValueOnce({ ok: true })
    const client = createLaneClient(bridge)
    await client.open(binding)
    await expect(client.close()).rejects.toThrow('agent_lane_execute_failed')
    expect(client.context()?.subscriptionId).toBe('w')
    await client.close()
    expect(client.context()).toBeNull()
    expect(bridge.send).toHaveBeenLastCalledWith({ kind: 'workspace-close', workspaceId: 'w' })
  })

  it('has no desktop bridge in a plain browser without Electron preload', () => {
    // 普通浏览器没有 Electron preload，实验室通过参数注入桥。
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
    push(workspace(next))
    expect(client.projection()).toBe(next)
    expect(client.projection()).toBe(next)
  })

  it('starts from an empty projection, not from undefined', () => {
    const client = createLaneClient(fakeBridge().bridge)
    expect(client.workspace()).toBe(EMPTY_LANE_WORKSPACE)
    expect(client.projection()).toBe(EMPTY_LANE_PROJECTION)
    // 桥没接上时列不出对话。这句话不是「这个项目没有对话」，是「还没问到」。
    expect(client.lanes()).toEqual([])
    // 「这条 lane 还没有内容」和「出错了」是两句话。空投影说的是前者。
    expect(client.projection().parts).toEqual([])
  })

  it('fans a projection out to every subscriber and stops when they unsubscribe', () => {
    const { bridge, push } = fakeBridge()
    const client = createLaneClient(bridge)
    const seen: string[] = []
    const stop = client.subscribe(() => seen.push('a'))
    client.subscribe(() => seen.push('b'))
    push(workspace(projection('one')))
    stop()
    push(workspace(projection('two')))
    expect(seen).toEqual(['a', 'b', 'b'])
  })

  it('sends intents only — every id it puts on the wire came from the main process', async () => {
    const { bridge, sent } = fakeBridge()
    const client = createLaneClient(bridge)
    await client.prompt('Append a line.')
    await client.steer('Landscape, not portrait.')
    await client.followUp('Then export it.')
    await client.cancelQueued('entry-7')
    await client.selectLane('research')
    await client.createLane('research')
    await client.deleteLane('research')
    await client.abort()
    expect(sent).toEqual([
      { kind: 'prompt', text: 'Append a line.' },
      { kind: 'steer', text: 'Landscape, not portrait.' },
      { kind: 'follow-up', text: 'Then export it.' },
      { kind: 'cancel-queued', entryId: 'entry-7' },
      { kind: 'lane-select', laneName: 'research' },
      { kind: 'lane-create', laneName: 'research' },
      { kind: 'lane-delete', laneName: 'research' },
      { kind: 'abort' },
    ])
  })

  it('say(): 同一句话在三种状态下走三条不同的路（方案 §1.3 那张表）', async () => {
    const { bridge, sent, push } = fakeBridge()
    const client = createLaneClient(bridge)

    // ① 空闲：新一轮。
    push(workspace(projection('idle')))
    await client.say('横屏')

    // ② 在跑、没卡：默认 steer，次选 followUp。
    push(workspace({ ...projection('busy'), running: true }))
    await client.say('横屏')
    await client.say('横屏', 'secondary')

    // ③ 有卡在等：默认 steer 交宿主解除等待，次级选择才 follow-up。
    push(workspace({
      ...projection('waiting'), running: true,
      pending: { toolCallId: 'call-9', toolName: 'write_document', args: {}, grantable: false, pendingCount: 1 },
    }))
    await client.say('横屏')
    await client.say('横屏', 'secondary')

    expect(sent).toEqual([
      { kind: 'prompt', text: '横屏' },
      { kind: 'steer', text: '横屏' },
      { kind: 'follow-up', text: '横屏' },
      { kind: 'steer', text: '横屏' },
      { kind: 'follow-up', text: '横屏' },
    ])
  })

  it('空闲态没有次选：按到「第二个按钮」也回落到主动作，不抛错', async () => {
    const { bridge, sent, push } = fakeBridge()
    const client = createLaneClient(bridge)
    push(workspace(projection('idle')))
    expect(client.intent('横屏').secondary).toBeUndefined()
    await client.say('横屏', 'secondary')
    expect(sent).toEqual([{ kind: 'prompt', text: '横屏' }])
  })

  it('answers with a named failure when the bridge is absent, instead of throwing or pretending', async () => {
    const client = createLaneClient(undefined)
    await expect(client.prompt('hi')).resolves.toEqual({
      ok: false, code: 'agent_lane_bridge_absent',
      diagnostic: 'nomiDesktop.agentLane is not exposed on this build',
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
    push(workspace(sent))
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
      send: async () => ({ ok: true, restoredInput: [{ text: '不对，横屏' }] }),
    })
    const result = await client.abort()
    expect(result).toEqual({ ok: true, restoredInput: [{ text: '不对，横屏' }] })
  })
  // 面板刚打开的那一两秒里用户就打字回车：以前这条命令带着**空身份**（`current` 还是 null）
  // 就发出去了，主进程当然找不到归属、回一条失败，那句话还得他自己重打。
  it('holds a command until its own open settles, then sends it with the real workspace id', async () => {
    const binding = { projectId: 'p', immutableProjectUuid: 'u', projectGeneration: 1 }
    const sent: LaneDesktopCommand[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const bridge: LaneBridge = {
      onProjection: () => () => {},
      send: async (command) => {
        sent.push(command)
        if (command.kind === 'workspace-open') { await blocked; return { ok: true, workspaceId: 'w' } }
        return { ok: true }
      },
    }
    const client = createLaneClient(bridge)
    const opening = client.open(binding)
    const saying = client.prompt('打开的时候我就打字了')
    expect(sent.map((one) => one.kind)).toEqual(['workspace-open'])
    release()
    await opening
    await saying
    expect(sent.map((one) => one.kind)).toEqual(['workspace-open', 'prompt'])
    expect(sent[1]).toMatchObject({ kind: 'prompt', workspaceId: 'w' })
  })

})
