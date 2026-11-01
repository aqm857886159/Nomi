// 「用户主动交出去的东西，必须最终送达」的落盘队列。反馈与轨迹两个调用方共用。
//
// 与 `telemetryOutbox.ts` 的分工（**为什么是两个模块而不是一个**，别来合并）：
//   · telemetryOutbox 的契约是「攒一批匿名计数，并把待发/已发条数给设置页看」。
//     它的日期截断（反指纹）、25 条一批、pending/sent 双列表都是那个契约的一部分。
//   · 这一份的契约是「一件用户点过「发送」的东西，别丢」。它没有已发列表（用户拿到编号
//     就是回执），一条一发（反馈要立刻拿到编号），而且**反馈那一路不过 enabled 闸**。
// 把两者合成一个，`enabled` 那道闸就得长出例外分支——而闸子一有例外就迟早漏。
// 真正的单一 owner 落在**传输**那一层（`intakeClient.ts`），不在队列这一层。
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { logWarn } from '../logging/logger'
import { getSettingsRoot } from '../settings/settingsRoot'
import { intakeConfigured, IntakeHttpError, postIntake, type IntakeResult } from './intakeClient'

/** 队列按货物分文件：清掉轨迹不该连带清掉用户已经点过发送的反馈。 */
export type IntakeQueueKind = 'trajectories' | 'feedback'

const MAX_PENDING = 50
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/**
 * 第一次重试等多久，之后每次翻倍，封顶一小时，成功一次就归位。
 * 一份反馈几百 KB，对着挂掉的端点每分钟传一遍不划算；同时不能指望用户重开：线上有报告晚到七天。
 */
const RETRY_BASE_MS = 60_000
const RETRY_MAX_MS = 60 * 60 * 1000
/**
 * 接收端明确说这份字节它不收，重发同一份也不会变，留着只会堵住后面的。
 * 其余（401/403/404/429/5xx/断网/超时）都留在队列：令牌随版本轮换，更新 App 或过一会儿就可能好。
 */
const REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 413])

export type IntakeQueueItem = {
  id: string
  queuedAt: string
  payload: unknown
  /** 413 之后已经换成了更小的那份。只缩一次，还是 413 就放弃。 */
  shrunk?: boolean
}

type QueueStore = { schemaVersion: 1; pending: IntakeQueueItem[] }

/** 一件货发一次的结果。`failed` = 这次没发成，还留在队列里。 */
export type IntakeDelivery =
  | { status: 'delivered'; result: IntakeResult; shrunk: boolean }
  | { status: 'rejected' }
  | { status: 'failed' }

/**
 * 交一件货给队列的结果。
 * `pending` = 已落盘，界面等不到回答但后台还在发；`lost` = 存不下来也没能确认发出去，只有这时候货可能真没了。
 */
export type IntakeSubmission = Exclude<IntakeDelivery, { status: 'failed' }> | { status: 'pending' | 'lost' }

function queuePath(kind: IntakeQueueKind): string {
  return path.join(getSettingsRoot(), `intake-queue-${kind}.json`)
}

function validItem(value: unknown): value is IntakeQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.queuedAt === 'string' && 'payload' in item
}

function readStore(kind: IntakeQueueKind): QueueStore {
  try {
    const raw = readJsonFile(queuePath(kind)) as Partial<QueueStore>
    const pending = Array.isArray(raw.pending) ? raw.pending.filter(validItem) : []
    return { schemaVersion: 1, pending }
  } catch {
    // 队列文件坏了不该让用户下一次反馈也发不出去。丢掉坏文件，从空开始。
    return { schemaVersion: 1, pending: [] }
  }
}

/** 裁掉过期和超量的，回裁掉了几条。 */
function prune(store: QueueStore, now = Date.now()): number {
  const before = store.pending.length
  store.pending = store.pending
    .filter((item) => {
      const queued = Date.parse(item.queuedAt)
      return !Number.isFinite(queued) || now - queued <= MAX_AGE_MS
    })
    .slice(-MAX_PENDING)
  return before - store.pending.length
}

function newItem(payload: unknown): IntakeQueueItem {
  return { id: crypto.randomUUID(), queuedAt: new Date().toISOString(), payload }
}

export function enqueueIntake(kind: IntakeQueueKind, payload: unknown): IntakeQueueItem {
  const item = newItem(payload)
  const store = readStore(kind)
  store.pending.push(item)
  const dropped = prune(store)
  writeJsonFileAtomic(queuePath(kind), store)
  if (dropped > 0) logWarn('diagnostics', 'intake-queue-pruned', { kind, dropped })
  return item
}

export function readIntakeQueue(kind: IntakeQueueKind): IntakeQueueItem[] {
  const store = readStore(kind)
  prune(store)
  return store.pending
}

/** 关掉「帮 Nomi 变好」时清轨迹队列。**不清反馈队列**——见 `feedbackReport.ts` 的说明。 */
export function clearIntakeQueue(kind: IntakeQueueKind): { deletedCount: number } {
  const deletedCount = readStore(kind).pending.length
  try {
    fs.rmSync(queuePath(kind), { force: true })
  } catch {
    /* 删本机缓存是尽力而为 */
  }
  return { deletedCount }
}

/** 改队列文件失败只记一笔：货已经送到或已被拒收，这时候抛出去没有人接得住。 */
function updateStore(kind: IntakeQueueKind, change: (store: QueueStore) => void): void {
  try {
    const store = readStore(kind)
    change(store)
    writeJsonFileAtomic(queuePath(kind), store)
  } catch (error) {
    logWarn('diagnostics', 'intake-queue-write-failed', { kind }, error)
  }
}

function removeItem(kind: IntakeQueueKind, id: string): void {
  updateStore(kind, (store) => {
    store.pending = store.pending.filter((pending) => pending.id !== id)
  })
}

type TooLargeHandler = (payload: unknown) => unknown | null

const tooLargeHandlers = new Map<IntakeQueueKind, TooLargeHandler>()

/** 这种货被回 413 时怎么缩。回 null 表示缩不了。在启动补发之前注册，排队的旧货也要走得到。 */
export function setIntakeTooLargeHandler(kind: IntakeQueueKind, handler: TooLargeHandler): void {
  tooLargeHandlers.set(kind, handler)
}

function shrunkItem(kind: IntakeQueueKind, item: IntakeQueueItem): IntakeQueueItem | null {
  if (item.shrunk) return null
  try {
    const payload = tooLargeHandlers.get(kind)?.(item.payload) ?? null
    return payload === null ? null : { ...item, payload, shrunk: true }
  } catch (error) {
    logWarn('diagnostics', 'intake-shrink-failed', { kind }, error)
    return null
  }
}

const retryTimers = new Map<IntakeQueueKind, ReturnType<typeof setTimeout>>()
const retryDelays = new Map<IntakeQueueKind, number>()

function scheduleRetry(kind: IntakeQueueKind): void {
  if (retryTimers.has(kind)) return
  const delay = retryDelays.get(kind) ?? RETRY_BASE_MS
  retryDelays.set(kind, Math.min(delay * 2, RETRY_MAX_MS))
  const timer = setTimeout(() => {
    retryTimers.delete(kind)
    void flushIntakeQueue(kind)
  }, delay)
  // 不让重试定时器拖住进程退出：这是尽力投递，不是必须完成的事务。
  timer.unref?.()
  retryTimers.set(kind, timer)
}

async function sendItem(kind: IntakeQueueKind, first: IntakeQueueItem): Promise<IntakeDelivery> {
  let item = first
  for (;;) {
    try {
      const result = await postIntake(`/v1/${kind}`, item.payload)
      retryDelays.delete(kind)
      removeItem(kind, item.id)
      return { status: 'delivered', result, shrunk: item.shrunk === true }
    } catch (error) {
      const status = error instanceof IntakeHttpError ? error.status : undefined
      if (status === undefined || !REJECTED_STATUSES.has(status)) {
        logWarn('diagnostics', 'intake-send-failed', { kind, status }, error)
        return { status: 'failed' }
      }
      const smaller = status === 413 ? shrunkItem(kind, item) : null
      if (!smaller) {
        logWarn('diagnostics', 'intake-item-rejected', { kind, status })
        removeItem(kind, item.id)
        return { status: 'rejected' }
      }
      item = smaller
      const shrunk = smaller
      updateStore(kind, (store) => {
        store.pending = store.pending.map((pending) => (pending.id === shrunk.id ? shrunk : pending))
      })
    }
  }
}

const delivering = new Map<string, Promise<IntakeDelivery>>()

/** 同一件货同一时刻只有一个请求在飞：用户那次发送和后台补发可能同时碰到它。 */
function deliver(kind: IntakeQueueKind, item: IntakeQueueItem): Promise<IntakeDelivery> {
  const inflight = delivering.get(item.id)
  if (inflight) return inflight
  const run = sendItem(kind, item).finally(() => {
    delivering.delete(item.id)
  })
  delivering.set(item.id, run)
  return run
}

/**
 * 用户交来一件货：**先落盘，再发**，界面最多等 `waitMs`。
 *
 * 先落盘是因为「发」这一步可能很久（弱网上传）甚至等不到头，而用户随时会关窗。
 * 等不到回答不算失败：货在盘上，后台接着发，下次启动也会补。永不抛。
 */
export async function submitIntake(
  kind: IntakeQueueKind,
  payload: unknown,
  options: { waitMs: number },
): Promise<IntakeSubmission> {
  let saved = true
  let item: IntakeQueueItem
  try {
    item = enqueueIntake(kind, payload)
  } catch (error) {
    // 盘写不了也要试着发：这时只有这一次机会，发不成要明着告诉用户。
    saved = false
    item = newItem(payload)
    logWarn('diagnostics', 'intake-save-failed', { kind }, error)
  }
  const delivery = deliver(kind, item).then((outcome) => {
    // 顺手把上次没发出去的也带走——用户这次联网了。
    if (outcome.status === 'delivered') void flushIntakeQueue(kind)
    if (outcome.status === 'failed') scheduleRetry(kind)
    return outcome
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), options.waitMs)
    timer.unref?.()
  })
  const outcome = await Promise.race([delivery, waited])
  clearTimeout(timer)
  if (outcome && outcome.status !== 'failed') return outcome
  return { status: saved ? 'pending' : 'lost' }
}

const flushing = new Map<IntakeQueueKind, Promise<void>>()

/**
 * 把队列里的东西发出去。**永不抛、永不阻塞 UI**：失败就留在队列里，排一次重试。
 *
 * 一条一发而不是攒批：反馈那一路要拿到每一条自己的编号，攒批就拿不到了。
 */
export function flushIntakeQueue(kind: IntakeQueueKind): Promise<void> {
  const inflight = flushing.get(kind)
  if (inflight) return inflight
  const run = (async () => {
    if (!intakeConfigured()) return
    const store = readStore(kind)
    const dropped = prune(store)
    if (dropped > 0) {
      logWarn('diagnostics', 'intake-queue-pruned', { kind, dropped })
      updateStore(kind, (latest) => void prune(latest))
    }
    for (const item of store.pending) {
      // 一条发不出去，后面的多半也发不出去（同一个端点）。留着，下一轮再来。
      if ((await deliver(kind, item)).status === 'failed') break
    }
    if (readStore(kind).pending.length > 0) {
      scheduleRetry(kind)
    } else {
      // clearTimeout(undefined) 是 no-op，所以不用先取再判。
      clearTimeout(retryTimers.get(kind))
      retryTimers.delete(kind)
      retryDelays.delete(kind)
    }
  })().finally(() => {
    flushing.delete(kind)
  })
  flushing.set(kind, run)
  return run
}

/** 测试用：清掉进程内的重试定时器与在飞标记。 */
export function resetIntakeQueueTimers(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer)
  retryTimers.clear()
  retryDelays.clear()
  flushing.clear()
  delivering.clear()
}
