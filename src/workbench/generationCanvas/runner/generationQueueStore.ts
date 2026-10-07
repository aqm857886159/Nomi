import { declareStoreLifetime } from '../../project/storeLifetime'
// 生成任务队列（调度真相源）。方案：docs/plan/2026-08-02-task-center-queue.md
//
// 存在的理由：在此之前「队列」只是 runGenerationNodesBatch 里的闭包变量（const queue + let cursor），
// 跑完即蒸发 —— 于是「谁在排队」没有对象可读、「取消」没有对象可拦、后续波次的节点在 store 里还是 idle
// （看着像压根没被选中）。本 store 把调度状态外化成常驻对象，任务中心面板是它的视图。
//
// ⚠️ 与 node.status 零重叠（P1，别让它们表达同一件事）：
//   本 store  = 「已调度但还没跑起来」：queued / cancelled / 波次 / 刹车
//   node.status = 「跑起来之后」：running / success / error / recoverable
// 特别地**不**给排队节点写 node.status='queued'——setNodeStatus 会把非终态的 runs[0] 一并 merge
// （canvasRunActions.ts:44-45），而 'recoverable' 不在终态白名单里，取消动作会把一条「可找回」的旧 run
// clobber 成 cancelled、丢掉续查用的 taskId。零重叠连这个 edge case 都不存在。
//
// 内存态不持久化：进行中的调度天然瞬态（重启本就在终态收敛，见 canvasRunActions.ts 头注释），
// 历史留痕已在 node.runs[] 里持久化 —— 不另立第二份历史真相源。
import { create } from 'zustand'
import { withdrawCanvasShots } from '../../api/taskApi'
import { notify, revealNotificationTarget } from '../../../ui/notificationPolicy'
import i18n from '../../../i18n'

export type QueueEntryState = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

export type GenerationQueueEntry = {
  /** 复合主键：同一节点可跨批次出现（重试/变体），单靠 nodeId 会撞。 */
  id: string
  batchId: string
  nodeId: string
  /** 0-based 波次序号，驱动「第 2 波 · 等上游参考」文案。 */
  waveIndex: number
  state: QueueEntryState
  enqueuedAt: number
  /** 真正开跑的时刻。排队时长 = startedAt - enqueuedAt（此前全仓算不出来）。 */
  startedAt?: number
  endedAt?: number
  error?: string
}

export type GenerationQueueBatch = {
  id: string
  projectId: string
  createdAt: number
  total: number
  /** 用户点了「取消排队」：worker 取任务前据此跳出，已提交的不动。 */
  cancelRequested: boolean
  /** 连续失败刹车：暂停后等用户决定继续 / 全部取消。 */
  paused: boolean
  consecutiveFailures: number
  finishedAt?: number
  /**
   * 批量卡上点了确认之后主进程为要花钱的节点开好的出价（节点 → 运行记录号）。排队的那一镜被取消 / 整批取消时
   * 把它的出价收回——主进程那一侧从此拒交，不只是这里不交。
   */
  canvasRunRecordIds?: Readonly<Record<string, string>>
}

function clearBrakeNotification(batch: GenerationQueueBatch | undefined): void {
  if (!batch) return
  notify({ identity: `queue:${batch.projectId}:${batch.id}`, reason: 'consecutive-failures', level: 'status', message: '' })
}

/** 连续失败几个就刹车。用户 2026-08-02 拍板：3 个。 */
export const QUEUE_BRAKE_THRESHOLD = 3

/** 已结算条目的保留上限（内存有界；进行中/排队中的永不丢）。 */
const SETTLED_KEEP = 60

const SETTLED_STATES: readonly QueueEntryState[] = ['success', 'error', 'cancelled']

export function isSettledState(state: QueueEntryState): boolean {
  return SETTLED_STATES.includes(state)
}

function entryId(batchId: string, nodeId: string): string {
  return `${batchId}:${nodeId}`
}

let batchSeq = 0

function createBatchId(): string {
  batchSeq += 1
  return `batch-${Date.now().toString(36)}-${batchSeq}`
}

type GenerationQueueState = {
  entries: GenerationQueueEntry[]
  batches: Record<string, GenerationQueueBatch>
  /** 登记整个计划（含后续波次）→ 这就是「排队可见」的全部秘密。返回 batchId。 */
  /** projectId：这批运行所属的项目（提交那一刻签发），不在登记时去读「当前项目」。 */
  enqueueBatch: (waves: readonly (readonly string[])[], projectId: string) => string
  markRunning: (batchId: string, nodeId: string) => void
  /** countsTowardBrake=false 用于「上游本批失败 → 下游连带失败」：那不是模型挂了，不该触发刹车。 */
  markSettled: (
    batchId: string,
    nodeId: string,
    state: Extract<QueueEntryState, 'success' | 'error' | 'cancelled'>,
    options?: { error?: string; countsTowardBrake?: boolean },
  ) => void
  /** 记下这一批要花钱的节点在主进程开好的出价（批量卡确认之后、开跑之前）。 */
  attachCanvasConsent: (batchId: string, runRecordIds: ReadonlyMap<string, string>) => void
  /** 取消单个排队条目（只对 queued 生效；running 的不碰——已提交的停不下来）。 */
  cancelEntry: (batchId: string, nodeId: string) => void
  /** 取消该批次所有还没提交的；返回真正被取消的个数。 */
  cancelBatchRemaining: (batchId: string) => number
  resumeBatch: (batchId: string) => void
  finishBatch: (batchId: string) => void
  clearSettled: () => void
}

export const useGenerationQueueStore = create<GenerationQueueState>()((set, get) => ({
  entries: [],
  batches: {},

  enqueueBatch: (waves, projectId) => {
    const id = createBatchId()
    const now = Date.now()
    const fresh: GenerationQueueEntry[] = []
    waves.forEach((wave, waveIndex) => {
      wave.forEach((nodeId) => {
        const trimmed = String(nodeId || '').trim()
        if (!trimmed) return
        fresh.push({
          id: entryId(id, trimmed),
          batchId: id,
          nodeId: trimmed,
          waveIndex,
          state: 'queued',
          enqueuedAt: now,
        })
      })
    })
    if (fresh.length === 0) return id
    set((state) => ({
      entries: [...state.entries, ...fresh],
      batches: {
        ...state.batches,
        [id]: { id, projectId, createdAt: now, total: fresh.length, cancelRequested: false, paused: false, consecutiveFailures: 0 },
      },
    }))
    return id
  },

  markRunning: (batchId, nodeId) => {
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === entryId(batchId, nodeId) && entry.state === 'queued'
          ? { ...entry, state: 'running', startedAt: Date.now() }
          : entry,
      ),
    }))
  },

  markSettled: (batchId, nodeId, nextState, options) => {
    const countsTowardBrake = options?.countsTowardBrake !== false && nextState === 'error'
    const wasPaused = get().batches[batchId]?.paused === true
    set((state) => {
      const target = entryId(batchId, nodeId)
      const entries = state.entries.map((entry) =>
        entry.id === target && !isSettledState(entry.state)
          ? { ...entry, state: nextState, endedAt: Date.now(), ...(options?.error ? { error: options.error } : {}) }
          : entry,
      )
      const batch = state.batches[batchId]
      if (!batch) return { entries }
      // 刹车计数只认「真执行失败」：任一成功清零，达阈值即暂停（剩下的不再提交）。
      const consecutiveFailures = nextState === 'success' ? 0 : countsTowardBrake ? batch.consecutiveFailures + 1 : batch.consecutiveFailures
      const paused = batch.paused || consecutiveFailures >= QUEUE_BRAKE_THRESHOLD
      return { entries, batches: { ...state.batches, [batchId]: { ...batch, consecutiveFailures, paused } } }
    })
    // 刹车刚刚踩下 → 必须主动喊一声。否则 worker 静静挂起等用户决定，而用户没开面板压根不知道要去点，
    // 只会觉得「卡住了」。这条 toast 是那个悬停状态的唯一出口。
    if (!wasPaused && get().batches[batchId]?.paused) {
      const projectId = get().batches[batchId].projectId
      notify({ identity: `queue:${projectId}:${batchId}`, reason: 'consecutive-failures', level: 'background', type: 'warning', message: i18n.t('taskCenter.brake.toast'), actionLabel: i18n.t('taskCenter.title'), onAction: () => { void revealNotificationTarget({ projectId, taskCenter: true }) } })
    }
  },

  attachCanvasConsent: (batchId, runRecordIds) => {
    set((state) => {
      const batch = state.batches[batchId]
      return batch ? { batches: { ...state.batches, [batchId]: { ...batch, canvasRunRecordIds: Object.fromEntries(runRecordIds) } } } : {}
    })
  },

  cancelEntry: (batchId, nodeId) => {
    const queued = get().entries.some((entry) => entry.id === entryId(batchId, nodeId) && entry.state === 'queued')
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === entryId(batchId, nodeId) && entry.state === 'queued'
          ? { ...entry, state: 'cancelled', endedAt: Date.now() }
          : entry,
      ),
    }))
    // 卡上点过确认的这一镜还没交：收回它的出价（「去掉的不生成」由主进程那一侧守住）。
    const batch = get().batches[batchId]
    const runRecordId = batch?.canvasRunRecordIds?.[nodeId]
    if (queued && batch && runRecordId) withdrawCanvasShots({ projectId: batch.projectId, runRecordIds: [runRecordId], by: 'removed' })
  },

  cancelBatchRemaining: (batchId) => {
    clearBrakeNotification(get().batches[batchId])
    const pending = get().entries.filter((entry) => entry.batchId === batchId && entry.state === 'queued')
    // 整批 ×：还没交的那几镜收回出价；已经交了的照常跑完（中途点 × 只发出已经发出去的那几镜）。
    const consented = get().batches[batchId]
    if (consented?.canvasRunRecordIds) {
      const runRecordIds = pending.map((entry) => consented.canvasRunRecordIds![entry.nodeId]).filter((value): value is string => Boolean(value))
      withdrawCanvasShots({ projectId: consented.projectId, runRecordIds, by: 'user_closed' })
    }
    if (pending.length === 0) {
      // 没有待取消条目也要落 cancelRequested：被刹车挂起的 worker 靠它跳出。
      set((state) => {
        const batch = state.batches[batchId]
        return batch ? { batches: { ...state.batches, [batchId]: { ...batch, cancelRequested: true, paused: false } } } : {}
      })
      return 0
    }
    const now = Date.now()
    const cancelled = new Set(pending.map((entry) => entry.id))
    set((state) => {
      const batch = state.batches[batchId]
      return {
        entries: state.entries.map((entry) =>
          cancelled.has(entry.id) ? { ...entry, state: 'cancelled', endedAt: now } : entry,
        ),
        ...(batch
          ? { batches: { ...state.batches, [batchId]: { ...batch, cancelRequested: true, paused: false } } }
          : {}),
      }
    })
    return pending.length
  },

  resumeBatch: (batchId) => {
    clearBrakeNotification(get().batches[batchId])
    set((state) => {
      const batch = state.batches[batchId]
      if (!batch) return {}
      return { batches: { ...state.batches, [batchId]: { ...batch, paused: false, consecutiveFailures: 0 } } }
    })
  },

  finishBatch: (batchId) => {
    clearBrakeNotification(get().batches[batchId])
    set((state) => {
      const batch = state.batches[batchId]
      if (!batch) return {}
      // 结算完成后修剪历史条目，内存有界；进行中/排队中的一律留着。
      const live = state.entries.filter((entry) => !isSettledState(entry.state))
      const settled = state.entries.filter((entry) => isSettledState(entry.state)).slice(-SETTLED_KEEP)
      return {
        entries: [...settled, ...live],
        batches: { ...state.batches, [batchId]: { ...batch, finishedAt: Date.now(), paused: false } },
      }
    })
  },

  clearSettled: () => {
    set((state) => ({ entries: state.entries.filter((entry) => !isSettledState(entry.state)) }))
  },
}))

/** 该条目是否已被用户取消（worker 取任务前查一次，命中即零 vendor 调用）。 */
export function isEntryCancelled(batchId: string | undefined, nodeId: string): boolean {
  if (!batchId) return false
  const entry = useGenerationQueueStore.getState().entries.find((candidate) => candidate.id === entryId(batchId, nodeId))
  return entry?.state === 'cancelled'
}

export type QueueGate = 'go' | 'stop'

/**
 * worker 取下一个任务前的闸：批次被整体取消 → 'stop'（跳出循环）；被刹车暂停 → 挂起直到
 * 用户点「继续」或「全部取消」。不传 batchId（单发/测试路径）恒 'go'，退化回接队列前的行为。
 */
export async function waitForQueueGate(batchId?: string): Promise<QueueGate> {
  if (!batchId) return 'go'
  const read = (): QueueGate | null => {
    const batch = useGenerationQueueStore.getState().batches[batchId]
    if (!batch) return 'go'
    if (batch.cancelRequested) return 'stop'
    return batch.paused ? null : 'go'
  }
  const immediate = read()
  if (immediate) return immediate
  return new Promise<QueueGate>((resolve) => {
    const unsubscribe = useGenerationQueueStore.subscribe(() => {
      const next = read()
      if (!next) return
      unsubscribe()
      resolve(next)
    })
  })
}

/** 单发生成（非批量）也进面板：自建 1 个节点的批次，否则面板对单发是瞎的。 */
export function beginSingletonBatch(nodeId: string, projectId: string): string {
  return useGenerationQueueStore.getState().enqueueBatch([[nodeId]], projectId)
}

/** 该节点当前是否「已排队但还没开跑」——画布节点据此显示「排队中」。 */
export function selectIsNodeQueued(state: GenerationQueueState, nodeId: string): boolean {
  return state.entries.some((entry) => entry.nodeId === nodeId && entry.state === 'queued')
}

/**
 * C1 寿命声明。**刻意 `process`**：每条 entry 在提交那一刻就签了 `projectId`
 * （审计 §1.1 把它列为「身份随创建签发」的正例），读侧按 id 自校，所以它不串项目。
 *
 * 而且切项目**不能**清它：用户离开项目 A 去项目 B 的时候，A 那边在途的生成还在跑——
 * 清空队列等于把它们从界面上抹掉，任务却还在花钱。身份轴已经解决了串扰，
 * 寿命轴在这里的正确答案就是「活到进程结束」。
 */
export const generationQueueStoreLifetime = declareStoreLifetime({
  store: 'useGenerationQueueStore',
  fields: { entries: 'process', batches: 'process' },
})
