// 生成节点的存活性（2026-09-28「生成完了却一直停在『正在存到你电脑上』」）。
//
// 这一组测的是**兜底那一层**：不管主进程里哪一个 await 不返回，节点都必须在登记的时限内落到一个能继续的状态
// （可找回 / 诚实失败），用户点停止也必须立刻停下来。夹具就是那个事故本身——一个永远不返回的查结果函数。
// 把 generationPhaseDeadline 的时限拿掉（awaitWithinPhase 退回裸 await），这里的节点会永远停在 running：必红。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERATION_PHASE, type GenerationProgressPhase } from '../../observability/narrate'
import { PROVIDER_MEDIA_RETRIEVAL_MAX_MS } from '../../../../electron/shared/assets/providerMediaRetrievalBudget'
import type { DesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import i18n from '../../../i18n'
import {
  GENERATION_PHASE_DEADLINE,
  GenerationPhaseStalledError,
  MEDIA_TRANSFER_STEP_MAX_MS,
  awaitWithinPhase,
  createPhaseClock,
  isGenerationPhaseStalledError,
} from './generationPhaseDeadline'
import { RecoverableTimeoutError, isRecoverableTimeoutError } from './recoverableTimeout'
import { isRetryableGenerationError, normalizeBaseDelayMs, normalizeRetryAttempts } from './generationRetryPolicy'
import { runCatalogGenerationTask } from './catalogTaskActions'
import { runGenerationNodesBatch } from './generationRunController'
import { useGenerationQueueStore } from './generationQueueStore'
import { requestTaskCancel } from './localTaskControl'
import { recoverNodeResult } from './recoverTaskActions'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { fetchWorkbenchTaskResultByVendor } from '../../api/taskApi'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'

type LocalizationListener = (event: { projectId: string; nodeId: string }) => void
const localizationListeners = new Set<LocalizationListener>()
/** 主进程「开始落地」的广播：只接这一条通道，别的桥能力一律不存在（与单测里没有 Electron 一致）。 */
const fakeBridge = {
  assets: {
    onLocalizationStarted: (listener: LocalizationListener) => {
      localizationListeners.add(listener)
      return () => localizationListeners.delete(listener)
    },
  },
} as unknown as DesktopBridge

vi.mock('../../../desktop/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../desktop/bridge')>()),
  getDesktopBridge: () => fakeBridge,
}))
vi.mock('../../api/taskApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taskApi')>()),
  fetchWorkbenchTaskResultByVendor: vi.fn(),
  // 这里的找回走旧运行记录（没有单镜 Run）。
  pollCanvasShotRun: vi.fn(async () => null),
}))

const TICK_MS = GENERATION_PHASE_DEADLINE.generating.maxMs
const SECOND = 1_000
/** 查结果连续失败的宽限（catalogTaskActions 的 POLL_FAILURE_GRACE_MS 是 45s）之后再多给一点。 */
const PAST_GRACE_MS = 60 * SECOND
const TARGET_FOR_UNIT = { projectId: 'project-test', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 } as const

/** 事故本身：一次永远不返回的查结果。 */
const neverAnswers = () => new Promise<never>(() => {})

/** 到期那一刻「等了几分钟」的人话，与 describePhaseSilence 同一个取整。 */
function silence(key: 'resultSilent' | 'savingSilent', waitedMs: number): string {
  return i18n.t(`generationCommon.phaseDeadline.${key}`, { minutes: Math.max(1, Math.round(waitedMs / 60_000)) })
}

describe('阶段时限表：每个非终态阶段都有出口，而且不比主进程先放弃', () => {
  it('narrate 里登记的每一个阶段都有正数时限和一个收场动作（typecheck 之外再钉一次运行时）', () => {
    for (const phase of Object.keys(GENERATION_PHASE) as GenerationProgressPhase[]) {
      const deadline = GENERATION_PHASE_DEADLINE[phase]
      expect(deadline, phase).toBeDefined()
      expect(deadline.maxMs, phase).toBeGreaterThan(0)
      expect(['recoverable', 'fail-uncharged', 'fail-maybe-charged'], phase).toContain(deadline.onExpiry)
    }
  })

  it('「正在存到你电脑上」的时限不短于主进程一次合法下载的最长时间——渲染层绝不比主进程先放弃', () => {
    expect(GENERATION_PHASE_DEADLINE.finalizing.maxMs).toBeGreaterThan(PROVIDER_MEDIA_RETRIEVAL_MAX_MS)
    expect(MEDIA_TRANSFER_STEP_MAX_MS).toBe(GENERATION_PHASE_DEADLINE.finalizing.maxMs)
  })

  it('落「可找回」的只有服务商已受理之后的阶段；受理之前到期只能诚实失败（没有回执就没有免费按钮）', () => {
    const recoverable = (Object.keys(GENERATION_PHASE_DEADLINE) as GenerationProgressPhase[])
      .filter((phase) => GENERATION_PHASE_DEADLINE[phase].onExpiry === 'recoverable')
      .sort()
    expect(recoverable).toEqual(['comfyui-node', 'comfyui-queued', 'finalizing', 'generating', 'still-generating', 'waiting'])
    expect(GENERATION_PHASE_DEADLINE.requesting.onExpiry).toBe('fail-maybe-charged')
  })

  it('重试间隔那一格的时限盖得住最长的一次退避', () => {
    const longestRetryWait = normalizeBaseDelayMs(Number.MAX_SAFE_INTEGER) * 2 ** (normalizeRetryAttempts(Number.MAX_SAFE_INTEGER) - 2)
    expect(GENERATION_PHASE_DEADLINE.retrying.maxMs).toBeGreaterThan(longestRetryWait)
  })
})

describe('awaitWithinPhase：work 落定、时限到、被叫停，三者先到者为准', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const recoverableFor = (message: string) => () => new RecoverableTimeoutError(
    { taskId: 't-1', vendor: 'v', taskKind: 'text_to_video', modelKey: 'm' }, { message },
  )

  it('按时回来就照常返回，不留计时器', async () => {
    const clock = createPhaseClock()
    clock.report('generating')
    await expect(awaitWithinPhase(Promise.resolve('ok'), { clock, recoverable: recoverableFor('x') })).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('到期落回执驱动的「可找回」；还没有回执时同一格改成「可能已扣费」的诚实失败', async () => {
    const clock = createPhaseClock()
    clock.report('generating')
    const withReceipt = awaitWithinPhase(neverAnswers(), { clock, recoverable: recoverableFor('silent') }).catch((error: unknown) => error)
    const withoutReceipt = awaitWithinPhase(neverAnswers(), { clock, recoverable: () => null }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(TICK_MS + SECOND)
    const recovered = await withReceipt
    expect(isRecoverableTimeoutError(recovered)).toBe(true)
    expect((recovered as Error).message).toBe('silent')
    const stalled = await withoutReceipt
    expect(isGenerationPhaseStalledError(stalled)).toBe(true)
    expect((stalled as GenerationPhaseStalledError).expiry).toBe('fail-maybe-charged')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('等的过程中换了格（主进程开始落地），时限随之换成新那一格的', async () => {
    const clock = createPhaseClock()
    clock.report('generating')
    let settled = false
    const waiting = awaitWithinPhase(neverAnswers(), { clock, recoverable: recoverableFor('saving') }).catch((error: unknown) => {
      settled = true
      return error
    })
    await vi.advanceTimersByTimeAsync(TICK_MS - SECOND)
    clock.report('finalizing')
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(GENERATION_PHASE_DEADLINE.finalizing.maxMs)
    expect(isRecoverableTimeoutError(await waiting)).toBe(true)
  })

  it('同一格里的进展（流式文本一段段来）让计时重新起算', async () => {
    const clock = createPhaseClock()
    clock.report('requesting')
    let settled = false
    void awaitWithinPhase(neverAnswers(), { clock, recoverable: () => null }).catch(() => {
      settled = true
    })
    for (let step = 0; step < 3; step += 1) {
      await vi.advanceTimersByTimeAsync(GENERATION_PHASE_DEADLINE.requesting.maxMs - SECOND)
      clock.heartbeat()
    }
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(GENERATION_PHASE_DEADLINE.requesting.maxMs + SECOND)
    expect(settled).toBe(true)
  })

  it('被叫停立刻结束，带回持有取消登记那一方给的错误', async () => {
    const clock = createPhaseClock()
    clock.report('generating')
    let stop: ((error: Error) => void) | undefined
    const waiting = awaitWithinPhase(neverAnswers(), {
      clock,
      recoverable: recoverableFor('x'),
      cancelled: (callback) => {
        stop = callback
        return () => {
          stop = undefined
        }
      },
    }).catch((error: unknown) => error)
    stop?.(new Error('stopped by user'))
    expect(((await waiting) as Error).message).toBe('stopped by user')
    expect(stop).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('到点收场的错误永远不进自动重试（重试 = 重新提交 = 再扣一次钱）', () => {
  it('可找回的文案就是最后一次取回错误的原话——哪怕它恰好写着 Failed to fetch / timeout，也不重试', () => {
    const detail = { taskId: 't', vendor: 'v', taskKind: 'text_to_video' as const, modelKey: 'm' }
    expect(isRetryableGenerationError(new RecoverableTimeoutError(detail, { lastError: new TypeError('Failed to fetch') }))).toBe(false)
    expect(isRetryableGenerationError(new RecoverableTimeoutError(detail, { lastError: new Error('Fetch timed out after 860000ms') }))).toBe(false)
    expect(isRetryableGenerationError(new GenerationPhaseStalledError('requesting', 'fail-maybe-charged', TICK_MS))).toBe(false)
    // 阳性对照：同样的原话在普通错误上照旧重试，说明是按类型排除、不是把重试整个关了。
    expect(isRetryableGenerationError(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('查结果连续失败超过宽限：把最后那次取回错误原样交出去，不一律说「超时」', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const videoNode: GenerationCanvasNode = {
    id: 'grace-video', kind: 'video', title: '', position: { x: 0, y: 0 }, prompt: '一只猫跑过草地',
    meta: { modelKey: 'vid', vendor: 'asyncv' },
  }

  it.each([
    ['状态码拒绝', 'Fetch failed: HTTP 403'],
    ['出站被自家策略拦下（带机器码）', 'NOMI_ERR::outbound-blocked:: 取片被本机网络策略拦下'],
  ])('%s', async (_label, lastMessage) => {
    const run = runCatalogGenerationTask(videoNode, {
      projectTarget: TARGET_FOR_UNIT,
      runTask: async (_vendor: string, request: TaskRequestDto) => ({ id: 'grace-task', kind: request.kind, status: 'queued', assets: [], raw: {} }),
      fetchTaskResult: async () => {
        throw new Error(lastMessage)
      },
      pollIntervalMs: SECOND,
      pollTimeoutMs: 20 * 60 * SECOND,
    }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(PAST_GRACE_MS)
    const error = await run
    expect(isRecoverableTimeoutError(error)).toBe(true)
    expect((error as Error).message).toBe(lastMessage)
    expect((error as RecoverableTimeoutError).lastError).toBeInstanceOf(Error)
  })
})

// ── 节点级：跑的是真控制器 + 真 catalog runner，只把主进程换成「永远不返回」 ──────────────────────────
let projectSession: ProjectSessionTestHarness
let projectTarget: ProjectBinding

function addVideoNode(): string {
  return useGenerationCanvasStore.getState().addNode({
    kind: 'video',
    prompt: '镜头 1',
    meta: { modelVendor: 'asyncv', modelKey: 'vid' },
  }).id
}

function nodeById(id: string): GenerationCanvasNode | undefined {
  return useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
}

function queueEntry(id: string) {
  return useGenerationQueueStore.getState().entries.find((entry) => entry.nodeId === id)
}

/** 付费提交成功（拿到 taskId），之后的查结果由 fetchTaskResult 决定。 */
function runStuckNode(id: string, fetchTaskResult: () => Promise<{ vendor: string; result: TaskResultDto }>, pollIntervalMs = 1) {
  const runTask = vi.fn(async (_vendor: string, request: TaskRequestDto): Promise<TaskResultDto> => (
    { id: 'paid-task-1', kind: request.kind, status: 'queued', assets: [], raw: {} }
  ))
  const settled = runGenerationNodesBatch([id], {
    target: projectTarget,
    assetUploadConsent: 'not-needed',
    retry: { maxAttempts: 3 },
    executor: (node, context) => runCatalogGenerationTask(node, {
      projectTarget: context.projectTarget,
      referenceContext: { nodes: context.nodes, edges: context.edges },
      ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      runTask,
      fetchTaskResult,
      pollIntervalMs,
    }),
  })
  return { settled, runTask }
}

describe('节点存活性：注入一个永不返回的查结果函数', () => {
  beforeEach(async () => {
    projectSession = createProjectSessionTestHarness()
    projectTarget = await projectSession.open('project-test')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    localizationListeners.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    projectSession.dispose()
  })

  it('一轮查结果的时限内还在等；到点落「可找回」，说清等了多久，付费提交只发生一次', async () => {
    const id = addVideoNode()
    const { settled, runTask } = runStuckNode(id, neverAnswers)

    await vi.advanceTimersByTimeAsync(TICK_MS - SECOND)
    expect(nodeById(id)?.status).toBe('running')
    expect(nodeById(id)?.progress?.phase).toBe('generating')

    await vi.advanceTimersByTimeAsync(2 * SECOND)
    await settled
    const node = nodeById(id)
    expect(node?.status).toBe('recoverable')
    expect(node?.runs?.[0]?.taskId).toBe('paid-task-1')
    expect(runTask).toHaveBeenCalledTimes(1)
    // 可找回态的节点不存 error（那一格的面板只给「重新拉取」）；原因落在这次运行的队列记录上。
    expect(queueEntry(id)?.state).toBe('error')
    expect(queueEntry(id)?.error).toBe(silence('resultSilent', TICK_MS))
  })

  it('主进程开始落地后（「正在存到你电脑上」），时限换成落地那一格：不被一轮查结果的时限误杀，到落地时限才收场', async () => {
    const id = addVideoNode()
    const { settled } = runStuckNode(id, () => {
      // 查到成片、主进程开始落地并广播——然后那次取回永远不返回（2026-09-28 的现场）。
      for (const listener of [...localizationListeners]) listener({ projectId: projectTarget.projectId, nodeId: id })
      return neverAnswers()
    })

    await vi.advanceTimersByTimeAsync(TICK_MS + 10 * SECOND)
    expect(nodeById(id)?.status).toBe('running')
    expect(nodeById(id)?.progress?.phase).toBe('finalizing')

    await vi.advanceTimersByTimeAsync(GENERATION_PHASE_DEADLINE.finalizing.maxMs)
    await settled
    expect(nodeById(id)?.status).toBe('recoverable')
    expect(queueEntry(id)?.error).toBe(silence('savingSilent', GENERATION_PHASE_DEADLINE.finalizing.maxMs))
  })

  it('用户点停止：正在等的那次查结果立刻被打断，节点回到空闲、队列记「已取消」，不再多等一秒', async () => {
    const id = addVideoNode()
    const { settled, runTask } = runStuckNode(id, neverAnswers)
    await vi.advanceTimersByTimeAsync(10 * SECOND)
    expect(nodeById(id)?.progress?.phase).toBe('generating')

    requestTaskCancel(nodeById(id)!, () => {})
    await vi.advanceTimersByTimeAsync(0)
    await settled

    expect(nodeById(id)?.status).toBe('idle')
    expect(queueEntry(id)?.state).toBe('cancelled')
    expect(runTask).toHaveBeenCalledTimes(1)
  })

  it('「重新拉取」本身也有时限：那次查询永远不返回时，按钮回来（落回「可找回」），不再永远转圈', async () => {
    const id = addVideoNode()
    const { settled } = runStuckNode(id, async () => {
      throw new Error('Fetch failed: HTTP 403')
    }, SECOND)
    await vi.advanceTimersByTimeAsync(PAST_GRACE_MS)
    await settled
    expect(nodeById(id)?.status).toBe('recoverable')
    // 宽限到期交出去的是那次取回的原话，不是一句「超时」。
    expect(queueEntry(id)?.error).toBe('Fetch failed: HTTP 403')

    vi.mocked(fetchWorkbenchTaskResultByVendor).mockImplementation(neverAnswers)
    let recovered = false
    const recovering = withProjectAction((project) => recoverNodeResult(id, project))?.then(() => {
      recovered = true
    })
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(nodeById(id)?.status).toBe('running')

    await vi.advanceTimersByTimeAsync(MEDIA_TRANSFER_STEP_MAX_MS)
    await recovering
    expect(recovered).toBe(true)
    expect(nodeById(id)?.status).toBe('recoverable')
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).toHaveBeenCalledTimes(1)
  })
})
