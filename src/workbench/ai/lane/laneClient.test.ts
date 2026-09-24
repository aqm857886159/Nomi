// 渲染层订阅：本层**零状态机**。所以这一族测试问的都是「它有没有偷偷记账」。
import { describe, expect, it, vi } from 'vitest'

import type {
  LaneProjection, LaneWorkspaceProjection,
} from '../../../../electron/shared/agentLane/laneContracts'
import type { LaneDesktopCommand } from '../../../../electron/shared/agentLane/laneDesktopContracts'
import {
  EMPTY_LANE_PROJECTION, EMPTY_LANE_WORKSPACE, createLaneClient, resolveLaneBridge, type LaneBridge, type LaneCommandResult,
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
  it('returns only the safe code when automatic reopen fails with provider diagnostics', async () => {
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'old' })
      .mockResolvedValueOnce({ ok: false, code: 'agent_lane_model_unconfigured', diagnostic: 'secret-provider-token /private/project' })
    const client = createLaneClient(bridge)
    await client.open({ projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 })
    push({ ...workspace(projection('history')), closed: true })
    expect(await client.prompt('new input')).toEqual({ ok: false, code: 'agent_lane_model_unconfigured', diagnostic: '' })
  })

  it('does not borrow B authority when A command waits for its opening promise', async () => {
    const { bridge, sent, push } = fakeBridge()
    let finishA!: (result: { ok: true; workspaceId: string }) => void
    bridge.send = async command => {
      sent.push(command)
      if (command.kind !== 'workspace-open') return { ok: true }
      if (command.binding.projectId === 'a') return new Promise(resolve => { finishA = resolve })
      return { ok: true, workspaceId: 'workspace-b' }
    }
    const client = createLaneClient(bridge)
    const openingA = client.open({ projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 })
    const pending = client.prompt('belongs to A')
    await client.open({ projectId: 'b', immutableProjectUuid: 'uuid-b', projectGeneration: 1 })
    push({ ...workspace(projection('B')), workspaceId: 'workspace-b' })
    finishA({ ok: true, workspaceId: 'workspace-a' })
    await openingA
    expect(await pending).toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
    expect(sent.filter(command => command.kind === 'prompt')).toEqual([])
  })

  it('retires a main-closed workspace and requests fresh authority only for the next new prompt', async () => {
    const binding = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'old' })
      .mockResolvedValueOnce({ ok: false, code: 'agent_lane_closed' })
      // 主进程开工作区时先推一份投影再回 ok（`laneIpc.ts` workspace-open 里的 `push(workspace.projection())`）。
      .mockImplementationOnce(async () => { push({ ...workspace(projection('history')), workspaceId: 'new' }); return { ok: true, workspaceId: 'new' } })
      .mockResolvedValue({ ok: true })
    const client = createLaneClient(bridge)
    await client.open(binding)
    push({ ...workspace(projection('history')), closed: true })
    expect(client.context()).toBeNull()
    expect(client.projection().parts).toEqual(projection('history').parts)
    await client.approve('obsolete-approval')
    expect(bridge.send).toHaveBeenCalledTimes(2)
    await client.prompt('New action after reopening')
    expect(bridge.send).toHaveBeenNthCalledWith(3, { kind: 'workspace-open', binding })
    expect(bridge.send).toHaveBeenLastCalledWith({ kind: 'prompt', text: 'New action after reopening', workspaceId: 'new',
      expectedLane: 'main', expectedSessionId: 's-1' })
  })

  it('refuses input with a named failure when the workspace lists no conversation, instead of a silent null', async () => {
    // 2026-09-24 Windows 真机：列表认不出任何对话 → 以前 prepareInput 回 null，发送钮静默返回，
    // 字留在框里、哪儿都没有一句话。现在这一步必须有名有姓地失败，面板按码出文案。
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn().mockImplementation(async (command: LaneDesktopCommand) => {
      if (command.kind === 'workspace-open') push({ lanes: [], active: projection('none'), workspaceId: 'w' })
      return command.kind === 'workspace-open' ? { ok: true, workspaceId: 'w' } : { ok: true }
    })
    const client = createLaneClient(bridge)
    await client.open({ projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 })
    await expect(client.prepareInput()).rejects.toMatchObject({ laneCode: 'agent_lane_closed' })
  })

  it('does not reopen old A after the user switches to B', async () => {
    const a = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
    const b = { projectId: 'b', immutableProjectUuid: 'uuid-b', projectGeneration: 1 }
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'a' })
      .mockResolvedValueOnce({ ok: true, workspaceId: 'b' }).mockResolvedValue({ ok: true })
    const client = createLaneClient(bridge)
    await client.open(a)
    push({ ...workspace(projection('A closed')), closed: true })
    await client.open(b)
    push({ ...workspace(projection('late A closed')), closed: true, workspaceId: 'a' })
    expect(client.context()?.subscriptionId).toBe('b')
    await client.prompt('Only B')
    expect(bridge.send).toHaveBeenCalledTimes(3)
    expect(bridge.send).toHaveBeenLastCalledWith({ kind: 'prompt', text: 'Only B', workspaceId: 'b' })
  })

  it('does not send A input to B when project selection changes during fresh authorization', async () => {
    const a = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
    const b = { projectId: 'b', immutableProjectUuid: 'uuid-b', projectGeneration: 1 }
    const { bridge, push } = fakeBridge()
    let finish!: (value: { ok: true; workspaceId: string }) => void
    const gate = new Promise<{ ok: true; workspaceId: string }>(resolve => { finish = resolve })
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'old-a' })
      .mockReturnValueOnce(gate).mockResolvedValueOnce({ ok: true, workspaceId: 'b' })
    const client = createLaneClient(bridge)
    await client.open(a)
    push({ ...workspace(projection('closed')), closed: true, workspaceId: 'old-a' })
    const prompt = client.prompt('Only intended for A')
    await client.open(b)
    finish({ ok: true, workspaceId: 'new-a' })
    expect(await prompt).toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
    expect(bridge.send).toHaveBeenCalledTimes(3)
    expect(client.context()?.subscriptionId).toBe('b')
  })

  it('does not replay the prompt when fresh authority is rejected', async () => {
    const binding = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'old' })
      .mockResolvedValueOnce({ ok: false, code: 'project_binding_stale' })
    const client = createLaneClient(bridge)
    await client.open(binding)
    push({ ...workspace(projection('closed')), closed: true })
    expect(await client.prompt('No stale write')).toMatchObject({ ok: false, code: 'project_binding_stale' })
    expect(bridge.send).toHaveBeenCalledTimes(2)
    expect(bridge.send).toHaveBeenLastCalledWith({ kind: 'workspace-open', binding })
  })

  it('does not restore authority when main closes that workspace before open returns', async () => {
    const binding = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
    const { bridge, push } = fakeBridge()
    bridge.send = vi.fn(async () => {
      push({ ...workspace(projection('already closed')), workspaceId: 'closing', closed: true })
      return { ok: true as const, workspaceId: 'closing' }
    })
    const client = createLaneClient(bridge)
    await client.open(binding)
    expect(client.context()).toBeNull()
    expect(client.workspace().closed).toBe(true)
  })

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

it('R05 withholds old workspace pushes during a new open until its identity is acknowledged', async () => {
  const { bridge, push } = fakeBridge()
  let finish!: (value: { ok: true; workspaceId: string }) => void
  bridge.send = vi.fn().mockResolvedValueOnce({ ok: true, workspaceId: 'old' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const client = createLaneClient(bridge)
  await client.open({ projectId: 'a', immutableProjectUuid: 'a', projectGeneration: 1 })
  const opening = client.open({ projectId: 'b', immutableProjectUuid: 'b', projectGeneration: 1 })
  push({ ...workspace(projection('old secret')), workspaceId: 'old' })
  expect(client.projection().parts).toEqual([])
  push({ ...workspace(projection('new history')), workspaceId: 'new' })
  expect(client.projection().parts).toEqual([])
  finish({ ok: true, workspaceId: 'new' })
  await opening
  expect(client.projection().parts).toEqual(projection('new history').parts)
})

describe('C23 late history delivery', () => {
  it.each(['workspace', 'reconnect'] as const)('%s replacement rejects an old page and old approval without touching the new draft', async replacement => {
    const { useWorkbenchStore } = await import('../../workbenchStore')
    const before = useWorkbenchStore.getState()
    let finishPage!: (result: { ok: true }) => void
    let oldListener!: (value: LaneWorkspaceProjection) => void
    const old = fakeBridge()
    old.bridge.onProjection = listener => { oldListener = listener; return () => {} }
    old.bridge.send = vi.fn(async (command: LaneDesktopCommand): Promise<LaneCommandResult> => {
      old.sent.push(command)
      if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'old' }
      if (command.kind === 'history-older') return new Promise(resolve => { finishPage = resolve })
      return { ok: true }
    })
    const client = createLaneClient(old.bridge)
    try {
      await client.open({ projectId: 'a', immutableProjectUuid: 'a', projectGeneration: 1 })
      oldListener({ ...workspace({ ...projection('A newest'), history: { hasMore: true, before: 'a-cursor' } }), workspaceId: 'old' })
      const address = client.conversation()!
      const loading = client.loadOlder()
      expect(old.sent.at(-1)).toEqual({ kind: 'history-older', before: 'a-cursor', workspaceId: 'old', expectedLane: 'main', expectedSessionId: 's-1' })
      const next = fakeBridge()
      next.bridge.send = vi.fn(async (command: LaneDesktopCommand): Promise<LaneCommandResult> => { next.sent.push(command); return command.kind === 'workspace-open' ? { ok: true, workspaceId: 'new' } : { ok: true } })
      if (replacement === 'reconnect') client.connect(next.bridge)
      else old.bridge.send = next.bridge.send
      await client.open({ projectId: 'b', immutableProjectUuid: 'b', projectGeneration: 1 })
      const current = { ...workspace(projection('B newest')), workspaceId: 'new' }
      if (replacement === 'reconnect') next.push(current)
      else oldListener(current)
      useWorkbenchStore.getState().setProjectAgentDraft('NEW_B_UNSENT_DRAFT')
      const revision = useWorkbenchStore.getState().projectAgentDraftRevision
      // Invoke the retired subscription even after unsubscribe: connectionEpoch must defend this boundary.
      oldListener({ ...workspace(projection('A late older page')), workspaceId: 'old' })
      finishPage({ ok: true })
      await loading
      expect(client.workspace()).toBe(current)
      expect(await client.approve('old-approval', address)).toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
      expect([...old.sent, ...next.sent].filter(command => command.kind === 'approval' || command.kind === 'prompt')).toEqual([])
      expect(useWorkbenchStore.getState().projectAgentDraft).toBe('NEW_B_UNSENT_DRAFT')
      expect(useWorkbenchStore.getState().projectAgentDraftRevision).toBe(revision)
      // Positive control: the newly published conversation still accepts its own explicit command.
      await client.approve('current-approval', client.conversation()!)
      expect(next.sent.at(-1)).toMatchObject({ kind: 'approval', toolCallId: 'current-approval', workspaceId: 'new', expectedSessionId: 's-1' })
    } finally {
      client.dispose()
      useWorkbenchStore.setState(before)
    }
  })

  it('a pending page ACK after lane selection cannot restore the old lane or admit its approval', async () => {
    const { bridge, sent, push } = fakeBridge()
    let finishPage!: (result: { ok: true }) => void
    bridge.send = async command => {
      sent.push(command)
      if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'w' }
      if (command.kind === 'history-older') return new Promise(resolve => { finishPage = resolve })
      return { ok: true }
    }
    const client = createLaneClient(bridge)
    try {
      await client.open({ projectId: 'a', immutableProjectUuid: 'a', projectGeneration: 1 })
      push({ ...workspace({ ...projection('A'), history: { hasMore: true, before: 'a-cursor' } }), workspaceId: 'w' })
      const oldAddress = client.conversation()!
      const loading = client.loadOlder()
      await client.selectLane('research')
      const selected: LaneWorkspaceProjection = { workspaceId: 'w', lanes: [{ laneName: 'research', sessionId: 's-2', createdAt: 1, updatedAt: 2 }], active: { ...projection('B'), lane: 'research' } }
      push(selected)
      finishPage({ ok: true })
      await loading
      expect(client.workspace()).toBe(selected)
      expect(await client.approve('old-tool', oldAddress)).toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
      expect(sent.filter(command => command.kind === 'approval')).toEqual([])
      await client.prompt('new B input')
      expect(sent.at(-1)).toMatchObject({ kind: 'prompt', expectedLane: 'research', expectedSessionId: 's-2' })
    } finally { client.dispose() }
  })
})
