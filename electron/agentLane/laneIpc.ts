// The IPC registration lives for the app; its workspace subscription lives for the project.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { assertTrustedSender } from '../ipcSenderGuard'
import { LANE_IPC_CHANNELS, type LaneWorkspaceHandle, type LaneWorkspaceProjection } from '../shared/agentLane/laneContracts'
import { LaneCommandError, parseLaneCommand } from './laneCommandCodec'
import { laneErrorCodeOf } from '../shared/agentLane/laneErrorCodes'
import type { LaneDesktopResult, LaneRestoredDesktopInput } from '../shared/agentLane/laneDesktopContracts'

export interface LaneIpcDependencies {
  /** Validate project identity, resolve credentials in main, and capture the committed surface. */
  openWorkspace(event: IpcMainInvokeEvent, request: unknown): Promise<LaneWorkspaceHandle>
  /** Revalidate the committed project before every operation, including approvals and cancellation. */
  validate(event: IpcMainInvokeEvent): void
  updatePolicy(event: IpcMainInvokeEvent, policy: unknown, workspace: LaneWorkspaceHandle): void
  configure(event: IpcMainInvokeEvent, request: unknown, workspace: LaneWorkspaceHandle): Promise<void>
  receipt(event: IpcMainInvokeEvent, request: unknown, workspace: LaneWorkspaceHandle): Omit<Extract<LaneDesktopResult, { ok: true }>, 'ok'>
  restoreInput(workspace: LaneWorkspaceHandle, input: readonly import('../shared/agentLane/laneContracts').LaneDraftInput[]): readonly LaneRestoredDesktopInput[]
  singleShot(event: IpcMainInvokeEvent, request: unknown, signal: AbortSignal): Promise<LaneWorkspaceProjection['active']>
}

export interface LaneIpcRegistration { dispose(): Promise<void> }

/** 诊断串的上限。它只进日志与「技术详情」，不需要完整正文。 */
const MAX_DIAGNOSTIC_CHARS = 2048

function laneDiagnostic(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_DIAGNOSTIC_CHARS ? `${text.slice(0, MAX_DIAGNOSTIC_CHARS)}…` : text
}


export function registerAgentLaneIpc(dependencies: LaneIpcDependencies): LaneIpcRegistration {
  let active: { workspace: LaneWorkspaceHandle; workspaceId: string; target: WebContents; unsubscribe: () => void; destroyed: () => void } | undefined
  let lifecycle = Promise.resolve()
  let inputPreparation = Promise.resolve()
  let switching = 0
  let disposed = false
  const singleShots = new Map<string, { target: WebContents; controller: AbortController }>()

  function abortSingleShots(target: WebContents): void {
    for (const shot of singleShots.values()) if (shot.target === target) shot.controller.abort()
  }

  async function close(): Promise<void> {
    const previous = active
    active = undefined
    previous?.unsubscribe()
    if (previous) abortSingleShots(previous.target)
    if (previous) previous.target.removeListener('destroyed', previous.destroyed)
    await previous?.workspace.close()
  }

  function replace(operation: () => Promise<void>): Promise<void> {
    switching += 1
    const next = lifecycle.then(operation).finally(() => { switching -= 1 })
    lifecycle = next.catch(() => undefined)
    return next
  }

  /**
   * 等这一轮开/关落定。
   *
   * 面板刚打开的那一两秒里用户就打字/点按钮是**常态**，不是异常用法。以前这条路上的两处
   * 判断都直接**拒**（一句英文原文糊在面板顶上，那句话还得他自己重打），而开/关本身是有界的
   * ——正确的行为是等它落定，再按落定后的真相判一次。
   *
   * 逐次等而不是等一次：切项目是 `close` + `open` 两次 `replace`，第一次落定时第二次已经排上了。
   * `lifecycle` 没再被换掉就说明没有后续，可以收手；上限只是防一条卡死的关闭把命令永远挂住
   * ——真挂满了下面的 `switching` 判断会以 `agent_lane_opening` 收尾（fail-closed，有码可译）。
   */
  async function settleLifecycle(): Promise<void> {
    for (let step = 0; switching && step < 8; step += 1) {
      const awaited = lifecycle
      await awaited
      if (lifecycle === awaited) break
    }
  }

  ipcMain.handle(LANE_IPC_CHANNELS.command, async (event, wire: unknown) => {
    assertTrustedSender(event)
    try {
      if (disposed) throw new Error('agent_lane_disposed')
      const kind = wire && typeof wire === 'object' ? (wire as { kind?: unknown }).kind : undefined
      if (kind === 'single-shot' || kind === 'single-shot-abort') {
        const requestId = (wire as { requestId?: unknown }).requestId
        if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256) throw new LaneCommandError('A single-shot request needs a request identity')
        const key = `${event.sender.id}:${requestId}`
        if (kind === 'single-shot-abort') {
          singleShots.get(key)?.controller.abort()
          return { ok: true as const }
        }
        if (singleShots.has(key)) throw new Error('agent_lane_request_duplicate')
        const controller = new AbortController()
        const destroyed = () => controller.abort()
        singleShots.set(key, { target: event.sender, controller })
        event.sender.once('destroyed', destroyed)
        try { return { ok: true as const, singleShot: await dependencies.singleShot(event, wire, controller.signal) } }
        finally { singleShots.delete(key); event.sender.removeListener('destroyed', destroyed) }
      }
      if (kind === 'workspace-open') {
        if (active && active.target !== event.sender && !active.target.isDestroyed()) throw new Error('agent_lane_owner_mismatch')
        abortSingleShots(event.sender)
        const workspaceId = randomUUID()
        await replace(async () => {
          await close()
          if (disposed) throw new Error('agent_lane_disposed')
          const workspace = await dependencies.openWorkspace(event, wire)
          if (disposed || event.sender.isDestroyed()) { await workspace.close(); return }
          const target = event.sender
          const push = (projection: LaneWorkspaceProjection) => {
            if (!target.isDestroyed()) target.send(LANE_IPC_CHANNELS.projection, projection)
          }
          const destroyed = () => { void replace(async () => { if (active?.workspaceId === workspaceId) await close() }) }
          active = { workspace, workspaceId, target, unsubscribe: workspace.subscribe(push), destroyed }
          target.once('destroyed', destroyed)
          push(workspace.projection())
        })
        return { ok: true as const, workspaceId }
      }
      if (kind === 'workspace-close' && !active && !switching) {
        abortSingleShots(event.sender)
        return { ok: true as const }
      }
      // 命令撞上正在进行的开/关：等，别拒（理由见 settleLifecycle）。等完之后下面每一条判断
      // 看到的都是**落定后**的真相——该归属就执行，该作废就以 `agent_lane_workspace_stale` 收尾。
      if (switching) await settleLifecycle()
      if (kind === 'workspace-close' && !active) {
        abortSingleShots(event.sender)
        return { ok: true as const }
      }
      if (!active || active.target !== event.sender) {
        return { ok: false as const, code: 'agent_lane_closed' as const, diagnostic: 'no workspace is open for this sender' }
      }
      if ((wire as { workspaceId?: unknown }).workspaceId !== active.workspaceId) throw new Error('agent_lane_workspace_stale')
      if (kind === 'workspace-close') {
        await replace(close)
        return { ok: true as const }
      }
      dependencies.validate(event)
      if (switching) throw new Error('agent_lane_opening')
      if (kind === 'workspace-policy') {
        dependencies.updatePolicy(event, (wire as { policy?: unknown }).policy, active.workspace)
        return { ok: true as const }
      }
      if (typeof kind === 'string' && kind.startsWith('receipt-')) {
        return { ok: true as const, ...dependencies.receipt(event, wire, active.workspace) }
      }
      const command = parseLaneCommand(wire)
      const owner = active
      let execution: Promise<Awaited<ReturnType<LaneWorkspaceHandle['execute']>>>
      if (command.kind === 'prompt' || command.kind === 'steer' || command.kind === 'follow-up') {
        const expectedLane = (wire as { expectedLane?: unknown }).expectedLane
        const assertCurrent = () => {
          if (disposed || switching || active !== owner || owner.workspace.projection().active.lane !== expectedLane) {
            throw new Error('agent_lane_workspace_stale')
          }
          dependencies.validate(event)
        }
        // Serialize only configure + synchronous message capture. A running prompt must never
        // hold an approval, abort or the next queued input behind its model request.
        const preparation = inputPreparation.then(async () => {
          assertCurrent()
          await dependencies.configure(event, wire, owner.workspace)
          assertCurrent()
          let acknowledge!: (value: Awaited<ReturnType<LaneWorkspaceHandle['execute']>>) => void
          const accepted = new Promise<Awaited<ReturnType<LaneWorkspaceHandle['execute']>>>((resolve) => { acknowledge = resolve })
          const settled = owner.workspace.execute(command, { onAccepted: () => acknowledge({}) })
          return { execution: command.kind === 'prompt' ? Promise.race([accepted, settled]) : settled }
        })
        inputPreparation = preparation.then(() => undefined, () => undefined)
        execution = (await preparation).execution
      } else execution = owner.workspace.execute(command)
      const outcome = await execution
      return { ok: true as const, ...outcome,
        ...(outcome.restoredInput
          ? { restoredInput: dependencies.restoreInput(owner.workspace, outcome.restoredInput) } : {}),
      }
    } catch (error) {
      // 桥上只出**码**。`message` 留着是给日志与「技术详情」的诊断串——渲染层的显示边界
      // (`laneCommandFailureText`) 按码取本地化文案，永不把它印成界面文字。
      // 诊断串封顶：一条来自第三方栈/上游正文的失败可以是几十 KB，而它的用途只有日志与
      // 「技术详情」。Codex 对同一格的处置是 UI 2KB / 正文 1KB 上限（codex-rs/protocol/src/error.rs:34）。
      return { ok: false as const, code: laneErrorCodeOf(error), diagnostic: laneDiagnostic(error) }
    }
  })

  return {
    dispose: async () => {
      disposed = true
      for (const shot of singleShots.values()) shot.controller.abort()
      ipcMain.removeHandler(LANE_IPC_CHANNELS.command)
      await lifecycle
      await close()
    },
  }
}
