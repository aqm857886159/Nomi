import { describe, expect, it, vi } from 'vitest'
import { LANE_IPC_CHANNELS, type LaneWorkspaceHandle, type LaneWorkspaceProjection } from '../shared/agentLane/laneContracts'
import { LANE_ERROR_CODES } from '../shared/agentLane/laneErrorCodes'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
  removeHandler: (channel: string) => ipc.handlers.delete(channel),
} }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: vi.fn() }))

import { registerAgentLaneIpc } from './laneIpc'

describe('desktop lane lifecycle', () => {
  it.each([
    { kind: 'prompt', text: 'one' }, { kind: 'steer', text: 'two' }, { kind: 'follow-up', text: 'three' },
    { kind: 'abort' }, { kind: 'approval', toolCallId: 'tool', action: 'allow-once' },
    { kind: 'cancel-queued', entryId: 'queued' }, { kind: 'history-older', before: 'older-entry' },
  ])('rejects a stale conversation identity for $kind before execution', async command => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const execute = vi.fn(async () => ({}))
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'new-session' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(), execute } as unknown as LaneWorkspaceHandle
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate: vi.fn(), configure: vi.fn(),
      receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open' }) as { workspaceId: string }
      expect(await send({ ...command, workspaceId: opened.workspaceId, expectedLane: 'main', expectedSessionId: 'old-session' }))
        .toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
      expect(execute).not.toHaveBeenCalled()
    } finally { await registration.dispose() }
  })

  it('releases IPC ownership when the workspace itself publishes its closed terminal state', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    let publish!: Parameters<LaneWorkspaceHandle['subscribe']>[0]
    const unsubscribe = vi.fn()
    const unknownMetric = { state: 'unknown', reason: 'no-settled-turn' } as const
    const initial: LaneWorkspaceProjection = { lanes: [], active: {
      lane: 'main', parts: [], running: false, queues: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
        cost: unknownMetric, contextTokens: unknownMetric, reasoningTokens: unknownMetric },
      thinking: { supportedLevels: ['off'], level: 'off', canTurnOff: true },
    } }
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => initial, subscribe: (listener: typeof publish) => { publish = listener; return unsubscribe },
      close: vi.fn(async () => { publish({ ...initial, closed: true }) }), execute: vi.fn() } as unknown as LaneWorkspaceHandle
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open', binding: { projectId: 'a' } }) as { workspaceId: string }
      const terminal: LaneWorkspaceProjection = { ...initial, closed: true }
      publish(terminal)
      expect(sender.send).toHaveBeenLastCalledWith(LANE_IPC_CHANNELS.projection, { ...terminal, workspaceId: opened.workspaceId })
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(workspace.close).toHaveBeenCalledOnce()
      expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
      expect(await send({ kind: 'approval', toolCallId: 'old', action: 'allow-once', workspaceId: opened.workspaceId })).toMatchObject({ ok: false, code: 'agent_lane_closed' })
      expect(workspace.execute).not.toHaveBeenCalled()
    } finally { await registration.dispose() }
  })

  it('opens and publishes history before the first command, then rebinds subscriptions on project change', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const event = { sender }
    const projection = (lane: string) => ({ lanes: [], active: { lane, parts: [] } })
    const makeWorkspace = (lane: string) => {
      const unsubscribe = vi.fn()
      return { captureInputSignal: () => new AbortController().signal, projection: () => projection(lane), subscribe: vi.fn(() => unsubscribe),
        close: vi.fn(), execute: vi.fn(async () => ({})), unsubscribe }
    }
    const first = makeWorkspace('first')
    const second = makeWorkspace('second')
    const openWorkspace = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const registration = registerAgentLaneIpc({
      openWorkspace,
      validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn(),
    })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!(event, wire)
    try {
      expect(await send({ kind: 'workspace-open', binding: { projectId: 'one' } })).toMatchObject({ ok: true })
      expect(openWorkspace).toHaveBeenCalledTimes(1)
      expect(sender.send).toHaveBeenLastCalledWith(LANE_IPC_CHANNELS.projection, { ...projection('first'), workspaceId: expect.any(String) })
      expect(await send({ kind: 'workspace-open', binding: { projectId: 'two' } })).toMatchObject({ ok: true })
      expect(first.unsubscribe).toHaveBeenCalledOnce()
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.subscribe).toHaveBeenCalledOnce()
      expect(sender.send).toHaveBeenLastCalledWith(LANE_IPC_CHANNELS.projection, { ...projection('second'), workspaceId: expect.any(String) })
    } finally { await registration.dispose() }
  })

  it('never sends one renderer commands into a workspace opened by another renderer', async () => {
    const owner = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const stranger = { id: 2, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const execute = vi.fn(async () => ({}))
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [], active: { lane: 'private', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(), execute } as unknown as LaneWorkspaceHandle
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (sender: typeof owner, wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      await send(owner, { kind: 'workspace-open', binding: { projectId: 'one' } })
      expect(await send(stranger, { kind: 'prompt', text: 'change another project' })).toMatchObject({ ok: false })
      expect(execute).not.toHaveBeenCalled()
      expect(stranger.send).not.toHaveBeenCalled()
    } finally { await registration.dispose() }
  })
  it('closes the owned workspace after its committed Surface has already been released', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const close = vi.fn()
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close, execute: vi.fn() } as unknown as LaneWorkspaceHandle
    const validate = vi.fn(() => { throw new Error('surface_port_suspended') })
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate, configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open', binding: { projectId: 'one' } }) as { workspaceId: string }
      expect(await send({ kind: 'workspace-close', workspaceId: opened.workspaceId })).toMatchObject({ ok: true })
      expect(close).toHaveBeenCalledOnce()
      expect(validate).not.toHaveBeenCalled()
    } finally { await registration.dispose() }
  })

  it('captures composer input atomically without holding approvals behind a running prompt', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    let finishConfigure!: () => void
    let configured!: () => void
    const entered = new Promise<void>((resolve) => { configured = resolve })
    const blocked = new Promise<void>((resolve) => { finishConfigure = resolve })
    let finishPrompt!: () => void
    const prompt = new Promise<void>((resolve) => { finishPrompt = resolve })
    const seen: string[] = []
    let context = ''
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(), execute: vi.fn(async (command) => {
        if (command.kind === 'prompt') { seen.push(`${command.text}:${context}`); await prompt }
        else seen.push(command.kind)
        return {}
      }) } as unknown as LaneWorkspaceHandle
    const configure = vi.fn(async (_event, wire) => {
      if (wire.context === 'A') { configured(); await blocked }
      context = wire.context
    })
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate: vi.fn(), configure, receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open' }) as { workspaceId: string }
      const common = { workspaceId: opened.workspaceId, expectedLane: 'main', expectedSessionId: 'session-main' }
      const first = send({ ...common, kind: 'prompt', text: 'one', context: 'A' })
      await entered
      const second = send({ ...common, kind: 'steer', text: 'two', context: 'B' })
      finishConfigure()
      await second
      expect(seen).toEqual(['one:A', 'steer'])
      expect(await send({ ...common, kind: 'approval', toolCallId: 'tool', action: 'allow-once' })).toMatchObject({ ok: true })
      expect(seen).toEqual(['one:A', 'steer', 'approval'])
      finishPrompt()
      expect(await first).toMatchObject({ ok: true })
    } finally { finishConfigure(); finishPrompt(); await registration.dispose() }
  })

  it('rejects a send whose project changed while configuration was opening its lane', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const configuring = new Promise<void>((resolve) => { entered = resolve })
    const make = () => ({ captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(), execute: vi.fn(async () => ({})) })
    const first = make(), second = make()
    const registration = registerAgentLaneIpc({ openWorkspace: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      validate: vi.fn(), configure: async () => { entered(); await blocked }, receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open' }) as { workspaceId: string }
      const pending = send({ kind: 'prompt', text: 'belongs to first', context: {}, expectedLane: 'main', expectedSessionId: 'session-main', workspaceId: opened.workspaceId })
      await configuring
      await send({ kind: 'workspace-open' })
      release()
      expect(await pending).toMatchObject({ ok: false })
      expect(first.execute).not.toHaveBeenCalled()
      expect(second.execute).not.toHaveBeenCalled()
    } finally { release(); await registration.dispose() }
  })

  // 用户在面板刚打开的那一两秒里就动手（打字回车 / 点卡上的按钮）是常态。以前这条路上的判断
  // 直接拒，桥上回的还是主进程那句英文散句——2026-09-11 用户真机截图里红色横幅上的那行字。
  it('holds a command that lands mid-open and runs it in the workspace that opens', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const execute = vi.fn(async () => ({}))
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(), execute } as unknown as LaneWorkspaceHandle
    const registration = registerAgentLaneIpc({
      openWorkspace: async () => { await blocked; return workspace },
      validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opening = send({ kind: 'workspace-open', binding: { projectId: 'one' } })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const held = send({ kind: 'abort' })
      release()
      const opened = await opening as { workspaceId: string }
      expect(opened.workspaceId).toBeTruthy()
      // 命令等到了这条对话开好，然后按落定后的真相判：它没带 workspaceId，所以以
      // **码**收尾（`agent_lane_workspace_stale`），而不是主进程那句英文原文。
      expect(await held).toMatchObject({ ok: false, code: 'agent_lane_workspace_stale' })
    } finally { release(); await registration.dispose() }
  })

  // 类边界：桥上任何一条失败都只出**已登记的码**，`diagnostic` 那一格永远不是给用户看的话。
  it('reports every failure as a registered code, never as prose', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const workspace = { captureInputSignal: () => new AbortController().signal, projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      subscribe: () => () => {}, close: vi.fn(),
      execute: vi.fn(async () => { throw new Error('Native PDF was not preserved by the provider payload adapter') }) } as unknown as LaneWorkspaceHandle
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace,
      validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open', binding: { projectId: 'one' } }) as { workspaceId: string }
      for (const wire of [
        { kind: 'abort', workspaceId: opened.workspaceId },
        { kind: 'prompt', text: '', workspaceId: opened.workspaceId },
        { kind: 'nonsense', workspaceId: opened.workspaceId },
        { kind: 'lane-create', laneName: '../escape', workspaceId: opened.workspaceId },
      ]) {
        const result = await send(wire) as { ok: boolean; code: string; diagnostic: string }
        expect(result.ok, JSON.stringify(wire)).toBe(false)
        expect(LANE_ERROR_CODES as readonly string[], JSON.stringify(wire)).toContain(result.code)
      }
    } finally { await registration.dispose() }
  })

})


describe('F12 IPC pre-admission cancellation', () => {
  it('invalidates both configuring and waiting inputs before they enter the workspace', async () => {
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const configuring = new Promise<void>(resolve => { entered = resolve })
    let admission = new AbortController()
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const executed: string[] = []
    const workspace = { projection: () => ({ lanes: [{ laneName: 'main', sessionId: 'session-main' }], active: { lane: 'main', parts: [] } }),
      captureInputSignal: () => admission.signal,
      subscribe: () => () => {}, close: vi.fn(), execute: vi.fn(async command => {
        if (command.kind === 'abort') { admission.abort(new Error('agent_lane_input_cancelled')); admission = new AbortController() }
        else executed.push(command.text)
        return {}
      }) } as unknown as LaneWorkspaceHandle
    const configure = vi.fn(async () => { if (configure.mock.calls.length === 1) { entered(); await blocked } })
    const registration = registerAgentLaneIpc({ openWorkspace: async () => workspace, validate: vi.fn(), configure,
      receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    const send = (wire: unknown) => ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, wire)
    try {
      const opened = await send({ kind: 'workspace-open' }) as { workspaceId: string }
      const common = { workspaceId: opened.workspaceId, expectedLane: 'main', expectedSessionId: 'session-main' }
      const first = send({ ...common, kind: 'prompt', text: 'configuring' })
      await configuring
      const second = send({ ...common, kind: 'follow-up', text: 'waiting behind configure' })
      await send({ ...common, kind: 'abort' })
      release()
      expect(await first).toMatchObject({ ok: false, code: 'agent_lane_input_cancelled' })
      expect(await second).toMatchObject({ ok: false, code: 'agent_lane_input_cancelled' })
      expect(executed).toEqual([])
      expect(await send({ ...common, kind: 'prompt', text: 'after Stop' })).toMatchObject({ ok: true })
      expect(executed).toEqual(['after Stop'])
    } finally { release(); await registration.dispose() }
  })
})

describe('quit lifecycle', () => {
  it('keeps the command handler alive after disposal and returns a structured failure', async () => {
    const sender = { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() }
    const registration = registerAgentLaneIpc({ openWorkspace: vi.fn(), validate: vi.fn(), configure: vi.fn(), receipt: vi.fn(), singleShot: vi.fn(), updatePolicy: vi.fn(), restoreInput: vi.fn() })
    await registration.dispose()
    const result = await ipc.handlers.get(LANE_IPC_CHANNELS.command)!({ sender }, { kind: 'prompt', text: 'after quit cancel' }) as { ok: boolean; code: string }
    expect(result).toMatchObject({ ok: false, code: 'agent_lane_disposed' })
    expect(ipc.handlers.has(LANE_IPC_CHANNELS.command)).toBe(true)
  })
})
