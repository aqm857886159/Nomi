// T-ED-06 终态保证：**每个分镜表节点必须落到成功 / 失败 / 可找回三者之一，没有「永远在跑」这一格**。
//
// 依据 docs/audit/2026-09-17-post-804-walkthrough.md §6.5：拆解跑到一半把 app 关掉再打开，
// 分镜表节点永久停在「本地找切点 / 0 镜」——不报错、不续跑、不提示可重试，和「正在跑」长得一模一样。
//
// 这里按「中断有几种」逐条钉：进程重启（快照 + 事件尾巴重放）/ 项目被替换（窗口关掉、切项目）/
// 子进程或引擎死 / 用户取消。每一条都断言节点在有限步内落到终态，且**有一句用户看得见的话**。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { abandonPendingCanvasWrite } from '../../events/canvasWriteBoundary'
import { readShotTable } from '../../../../../electron/shared/canvas/shotTable'
import {
  convergeDeconstructionTable,
  isDeconstructionRunLive,
  deconstructionNoticeKey,
  isDeconstructionTerminal,
  registerDeconstructionRun,
  releaseDeconstructionRun,
  resetDeconstructionRuns,
} from './deconstructionLifecycle'
import { cancelDeconstruction, deconstructToShotTable, ensureDeconstructionShotTable, retryShot } from './factBridge'

const bridge = vi.hoisted(() => ({
  deconstruct: vi.fn(),
  cancelDeconstruct: vi.fn(async () => ({ ok: true })),
  onDeconstructionProgress: vi.fn(() => vi.fn()),
}))
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ video: bridge }) }))

const project = vi.hoisted(() => ({ controller: new AbortController() }))
function originProject() {
  const signal = project.controller.signal
  return {
    binding: { projectId: 'isolated-project', immutableProjectUuid: 'uuid', projectGeneration: 1 },
    signal,
    assertCurrent() { if (signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) },
  }
}

beforeEach(() => {
  project.controller = new AbortController()
  abandonPendingCanvasWrite()
  bridge.deconstruct.mockReset()
  bridge.cancelDeconstruct.mockClear()
  resetDeconstructionRuns()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})

function sourceVideo(): string {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'video', title: 'Reference', position: { x: 0, y: 0 }, meta: {} })
  store.updateNode(node.id, { result: { id: 'result', type: 'video', url: 'nomi-local://isolated-project/video.mp4', createdAt: 1 } })
  return node.id
}

function tableSource(tableId: string) {
  const table = readShotTable(useGenerationCanvasStore.getState().nodes.find(node => node.id === tableId)?.meta)
  if (table?.source.kind !== 'deconstruction') throw new Error('expected a deconstruction table')
  return table.source
}

describe('deconstruction node terminal state', () => {
  it('落到中断可找回态，而不是重启后永远停在「本次拆解进行中」', () => {
    // 磁盘上的项目文件：拆到一半退出，快照里 status 还是 running。
    const persistedSnapshot = {
      nodes: [{
        id: 'table-1', kind: 'shot_table', title: 'Reference', position: { x: 0, y: 0 }, status: 'idle',
        meta: {
          shotTable: {
            schemaVersion: 1,
            source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'running', phase: 0 },
            columnSetId: 'facts', columns: [], rows: [],
            view: { selectedRowIds: [], density: 'auto' }, revision: 3, updatedAt: '2026-09-17T09:50:00.000Z',
          },
        },
      }],
      edges: [], groups: [], selectedNodeIds: [],
    }
    // 快照之后还落了一截事件尾巴（写进度那几下也走 canvas.node.updated）。
    const eventTail = [{
      type: 'canvas.node.updated',
      payload: {
        nodeId: 'table-1',
        patch: {
          meta: {
            shotTable: {
              schemaVersion: 1,
              source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'running', phase: 0 },
              columnSetId: 'facts', columns: [], rows: [],
              view: { selectedRowIds: [], density: 'auto' }, revision: 4, updatedAt: '2026-09-17T09:50:30.000Z',
            },
          },
        },
      },
    }]

    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot(persistedSnapshot)
    useGenerationCanvasStore.getState().applyEventTail(eventTail)

    const source = tableSource('table-1')
    expect(source.status).not.toBe('running')
    expect(isDeconstructionTerminal(source.status)).toBe(true)
    // 「可找回」不是「什么都没发生」：必须有一句用户看得见的话。
    // 但那句话**不落盘**——它是界面文案，冻进项目数据就再也跟不上语言切换（真机走查抓到过）。
    expect(deconstructionNoticeKey(source.status)).toBe('shotTable.interrupted')
    expect(source.errorMessage).toBeUndefined()
    expect(source.phase).toBeUndefined()
  })

  it('项目被换走（窗口关掉 / 切项目）后落中断态，而不是把 running 永久焊死', async () => {
    const sourceId = sourceVideo()
    const tableId = ensureDeconstructionShotTable(sourceId)!
    bridge.deconstruct.mockImplementation(async () => {
      project.controller.abort()
      project.controller = new AbortController()
      return { shots: [], durationSeconds: 0, hasAudio: false, failedShotIndexes: [] }
    })
    await deconstructToShotTable(sourceId, originProject())
    const source = tableSource(tableId)
    expect(source.status).not.toBe('running')
    expect(isDeconstructionTerminal(source.status)).toBe(true)
    expect(deconstructionNoticeKey(source.status)).toBeTruthy()
  })

  it('引擎 / ffmpeg 子进程死掉时落失败态并带上原因', async () => {
    const sourceId = sourceVideo()
    bridge.deconstruct.mockRejectedValue(new Error('镜头切点检测失败（code -1）：ffmpeg 被杀'))
    const tableId = await deconstructToShotTable(sourceId, originProject())
    const source = tableSource(tableId!)
    expect(source.status).toBe('failed')
    expect(source.errorMessage).toContain('ffmpeg 被杀')
    expect(isDeconstructionTerminal(source.status)).toBe(true)
  })

  it('用户取消时落取消态，且取消后还能重新拆解', async () => {
    const sourceId = sourceVideo()
    const tableId = ensureDeconstructionShotTable(sourceId)!
    let releaseEngine!: () => void
    const engineHeld = new Promise<void>(resolve => { releaseEngine = resolve })
    let engineStarted!: () => void
    const started = new Promise<void>(resolve => { engineStarted = resolve })
    bridge.deconstruct.mockImplementation(async () => {
      engineStarted()
      await engineHeld
      return { shots: [], durationSeconds: 0, hasAudio: false, failedShotIndexes: [] }
    })
    const running = deconstructToShotTable(sourceId, originProject())
    await started
    cancelDeconstruction(tableId)
    expect(tableSource(tableId).status).toBe('cancelled')
    releaseEngine()
    await running
    // 取消之后引擎的迟到结果不许把表拽回 ready。
    expect(tableSource(tableId).status).toBe('cancelled')
    expect(isDeconstructionTerminal(tableSource(tableId).status)).toBe(true)
    // 取消是终态，但不是死胡同：重新拆解要能起来。
    bridge.deconstruct.mockResolvedValue({ shots: [], durationSeconds: 0, hasAudio: false, failedShotIndexes: [] })
    await deconstructToShotTable(sourceId, originProject())
    expect(tableSource(tableId).status).toBe('ready')
  })
})

// 拆解取消 · 渲染层（第一刀，2026-10-27；设计卡 docs/plan/2026-10-27-deconstruct-cancel.md）。
// 第 1 轮在这里钉过修前现状：取消、项目被换走都只在渲染层落笔，主进程那次 invoke 一个字都收不到；
// 单镜重试连 requestId 都不带。现在：拆解与单镜重试都带 requestId + projectBinding；点取消、项目被换走
// 都按同一个 requestId 撤主进程那次（主进程不再起新的一步、不再进付费闸）；主进程回 null = 被停下了，不是失败。
describe('取消撤到主进程（第一刀）', () => {
  /** 主进程那次拆解的替身：挂着，直到测试给它一个回话（null = 主进程说「停下了」）。 */
  function holdEngine() {
    let reply!: (value: unknown) => void
    let engineStarted!: () => void
    const started = new Promise<void>(resolve => { engineStarted = resolve })
    bridge.deconstruct.mockImplementation(() => { engineStarted(); return new Promise(resolve => { reply = resolve }) })
    return { started, reply: (value: unknown) => reply(value) }
  }
  const firstPayload = () => bridge.deconstruct.mock.calls[0]?.[0] as Record<string, unknown>
  function legacyTable(): string {
    const legacy = {
      shots: [{ index: 1, startSeconds: 0, endSeconds: 2, durationSeconds: 2, sourceFrameUrl: 'nomi-local://isolated-project/frame.png', shotSize: 'close', mood: 'quiet',
        visual: 'Door opens', onScreenText: '', dialogue: '', carriedOver: false, imagePrompt: 'A door', motionPrompt: 'Opening', custom: {} }],
      durationSeconds: 2, hasAudio: false, failedShotIndexes: [],
    }
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({ kind: 'video', title: 'Reference', position: { x: 0, y: 0 }, meta: { videoDeconstruction: legacy } })
    store.updateNode(node.id, { result: { id: 'result', type: 'video', url: 'nomi-local://isolated-project/video.mp4', createdAt: 1 } })
    return ensureDeconstructionShotTable(node.id)!
  }
  const tableMeta = (tableId: string) => useGenerationCanvasStore.getState().nodes.find(node => node.id === tableId)?.meta

  it('点取消：按这次调用的同一个 requestId 撤主进程那次；主进程回 null 不落失败，表停在已取消', async () => {
    const sourceId = sourceVideo()
    const tableId = ensureDeconstructionShotTable(sourceId)!
    const engine = holdEngine()
    const running = deconstructToShotTable(sourceId, originProject())
    await engine.started
    expect(firstPayload().requestId).toEqual(expect.any(String))
    expect(firstPayload().projectBinding).toEqual(originProject().binding)
    expect(bridge.cancelDeconstruct).not.toHaveBeenCalled()

    cancelDeconstruction(tableId)
    expect(bridge.cancelDeconstruct).toHaveBeenCalledTimes(1)
    expect(bridge.cancelDeconstruct).toHaveBeenCalledWith({ requestId: firstPayload().requestId })
    expect(tableSource(tableId).status).toBe('cancelled')
    engine.reply(null)
    await running
    expect(tableSource(tableId).status).toBe('cancelled')
    expect(tableSource(tableId).errorMessage).toBeUndefined()
    // 取消之后不再撤第二次（窗口的项目信号只在项目被换走时才响）。
    expect(bridge.cancelDeconstruct).toHaveBeenCalledTimes(1)
  })

  it('项目被换走（窗口关掉 / 切项目）：同一个 requestId 撤主进程那次，表落中断态', async () => {
    const sourceId = sourceVideo()
    const tableId = ensureDeconstructionShotTable(sourceId)!
    const engine = holdEngine()
    const running = deconstructToShotTable(sourceId, originProject())
    await engine.started
    project.controller.abort()
    expect(bridge.cancelDeconstruct).toHaveBeenCalledWith({ requestId: firstPayload().requestId })
    engine.reply(null)
    await running
    expect(tableSource(tableId).status).toBe('interrupted')
  })

  it('主进程自己停下回 null（发起时项目会话已过期）：不写结果、不落失败，收敛到中断态、可重新拆解', async () => {
    const sourceId = sourceVideo()
    const tableId = ensureDeconstructionShotTable(sourceId)!
    bridge.deconstruct.mockResolvedValue(null)
    await deconstructToShotTable(sourceId, originProject())
    expect(tableSource(tableId).status).toBe('interrupted')
    expect(tableSource(tableId).errorMessage).toBeUndefined()
    expect(bridge.cancelDeconstruct).not.toHaveBeenCalled()
  })

  it('单镜重试带 requestId + projectBinding；重试途中项目被换走就撤主进程那 1 次；回 null 什么都不写', async () => {
    const tableId = legacyTable()
    const before = tableMeta(tableId)
    const engine = holdEngine()
    const retrying = retryShot(tableId, 'fact-1', originProject())
    await engine.started
    expect(firstPayload().requestId).toEqual(expect.any(String))
    expect(firstPayload().projectBinding).toEqual(originProject().binding)

    project.controller.abort()
    expect(bridge.cancelDeconstruct).toHaveBeenCalledWith({ requestId: firstPayload().requestId })
    engine.reply(null)
    await retrying
    expect(tableMeta(tableId)).toBe(before)
  })

  // 上一条先把项目换走再回 null，`canWrite()` 抢先拦下了，守不住 `if (!result) return` 那一句；这一条把两件事拆开：
  // 项目仍是当前项目、主进程自己回 null（它说「停下了」）时，也得不写表、不抛、不再撤第二次。
  it('单镜重试：项目仍是当前项目、主进程回 null → 不写表、不抛', async () => {
    const tableId = legacyTable()
    const before = tableMeta(tableId)
    bridge.deconstruct.mockResolvedValue(null)
    await expect(retryShot(tableId, 'fact-1', originProject())).resolves.toBeUndefined()
    expect(tableMeta(tableId)).toBe(before)
    expect(project.controller.signal.aborted).toBe(false)
    expect(bridge.cancelDeconstruct).not.toHaveBeenCalled()
  })

  it('项目已经换走了才点单镜重试：一次都不发', async () => {
    const tableId = legacyTable()
    project.controller.abort()
    await retryShot(tableId, 'fact-1', originProject())
    expect(bridge.deconstruct).not.toHaveBeenCalled()
    expect(bridge.cancelDeconstruct).not.toHaveBeenCalled()
  })
})

// owner 本体的纯函数判据。节点只投影它，所以判据在这里钉一次，读路径那边不再各钉一份。
describe('deconstruction lifecycle owner', () => {
  const table = {
    schemaVersion: 1 as const,
    source: { kind: 'deconstruction' as const, sourceNodeId: 'video-1', title: 'Reference', status: 'running' as const, phase: 0 as const, progressDetail: '转写第 2/6 段' },
    columnSetId: 'facts' as const, columns: [], rows: [],
    view: { selectedRowIds: [], density: 'auto' as const }, revision: 1, updatedAt: '2026-09-22T00:00:00.000Z',
  }

  it('只有 running 不是终态', () => {
    expect(isDeconstructionTerminal('running')).toBe(false)
    for (const status of ['idle', 'ready', 'failed', 'interrupted', 'cancelled'] as const) {
      expect(isDeconstructionTerminal(status)).toBe(true)
    }
  })

  it('在飞时不收敛，没人作保时落中断并清掉进度残影', () => {
    expect(convergeDeconstructionTable('table-1', table, () => true)).toBeUndefined()
    const converged = convergeDeconstructionTable('table-1', table, () => false)
    expect(converged?.source.status).toBe('interrupted')
    // 阶段与阶段内进度是「还在跑」的两条视觉证据，中断时必须一起清掉，否则节点还在演。
    expect(converged?.source.phase).toBeUndefined()
    expect(converged?.source.progressDetail).toBeUndefined()
    // 中断没有原话可抄：落盘字段留空，那句话由 key 在渲染时现取。
    expect(converged?.source.errorMessage).toBeUndefined()
    expect(deconstructionNoticeKey('interrupted')).toBe('shotTable.interrupted')
    expect(deconstructionNoticeKey('cancelled')).toBe('shotTable.cancelled')
    // 失败那一格没有界面文案——它要显示的是供应商 / ffmpeg 的原话。
    expect(deconstructionNoticeKey('failed')).toBeUndefined()
  })

  it('幂等：已经是终态的表再收敛一次原样不动', () => {
    for (const status of ['idle', 'ready', 'failed', 'interrupted', 'cancelled'] as const) {
      expect(convergeDeconstructionTable('table-1', { ...table, source: { ...table.source, status } }, () => false)).toBeUndefined()
    }
  })

  it('在飞登记只认自己那次 requestId，迟到的一次注销不掉后来者', () => {
    registerDeconstructionRun('table-1', 'req-1')
    releaseDeconstructionRun('table-1', 'req-0')
    expect(isDeconstructionRunLive('table-1')).toBe(true)
    releaseDeconstructionRun('table-1', 'req-1')
    expect(isDeconstructionRunLive('table-1')).toBe(false)
  })
})
