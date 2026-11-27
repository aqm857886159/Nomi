// 画布事件发射器(harness S5-a 影子日志):action 内部"构造事件→缓冲→批量 append"。
// 影子语义:store 仍是运行真相,事件只旁路记账;CI 属性测试锁 replay(events)≡snapshot,
// 为 S5-b 翻正(日志为唯一真相)铺安全网。
// 纪律(总方案 §4.4):payload 在入口深拷贝成 plain JSON(禁 immer draft 引用)并 freeze;
// 50ms/20 条先到先 flush;bridge 缺失(测试/旧 preload)或 IO 失败一律静默——绝不影响画布。
import { getDesktopBridge } from '../../../desktop/bridge'
import type { CanvasProjection } from './canvasEventReducer'
import { observeCanvasHistoryGesture } from './canvasPatchHistory'
import { getActiveCanvasGestureContext } from './canvasGestureContext'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'

export type CanvasShadowEvent = {
  id: string
  source: 'user' | 'agent' | 'runtime'
  txnId: string
  /** agent 提议事务标注(S6-2):整笔撤销与对账按它过滤。 */
  proposalId?: string
  type: string
  payload: Record<string, unknown>
}

const FLUSH_MS = 50
const FLUSH_COUNT = 20

let projectIdProvider: () => string | null = () => null
let buffer: CanvasShadowEvent[] = []
let bufferProjectId: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let testSink: ((events: readonly CanvasShadowEvent[]) => void) | null = null

/** NomiStudioApp 注入当前项目（在手势发生时取值）。 */
export function setCanvasEventProjectIdProvider(provider: () => string | null): void {
  flushNow()
  projectIdProvider = provider
}

/** 测试用:捕获发射的事件(属性测试的对账输入)。 */
export function setCanvasEventSinkForTests(sink: ((events: readonly CanvasShadowEvent[]) => void) | null): void {
  testSink = sink
}

const mintId = () => `evt_${crypto.randomUUID().slice(0, 12)}`

// 该项目日志的最后已知 seq(append 回执维护)——写进项目快照,hydrate 时重放其后的尾巴。
// 注意:回执异步到达,save 可能读到略旧的值 → 尾部重放会重看几条已在快照里的事件,
// 因此 reducer 的全部 case 必须幂等(canvasEventReducer 已逐 case 保证)。
type CanvasEventSession = { projectId: string; lastSeq: number; genesis: CanvasProjection | null }
let session: CanvasEventSession | null = null

export function getCanvasEventLastSeq(): number {
  return session?.lastSeq ?? 0
}

/** The immutable post-replay snapshot belongs to this opening, even when the same project is reopened. */
export function beginCanvasEventSession(projectId: string, lastSeq: number) {
  flushNow()
  const opened: CanvasEventSession = { projectId, lastSeq: Math.max(0, lastSeq), genesis: null }
  session = opened
  return (replayedSeq: number, snapshot: CanvasProjection): void => {
    opened.lastSeq = Math.max(opened.lastSeq, replayedSeq)
    opened.genesis = snapshot
  }
}

function flushNow(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  const projectId = bufferProjectId
  const owner = session
  const api = getDesktopBridge()?.events
  if (!projectId || !api) return
  void api
    .append(projectId, batch)
    .then((result) => {
      if (result?.lastSeq && owner?.projectId === projectId && session === owner && projectIdProvider() === projectId) {
        owner.lastSeq = Math.max(owner.lastSeq, result.lastSeq)
      }
    })
    .catch(() => {})
}

/**
 * 一次用户手势 = 一个 txnId(undo 的最小单位,§1.1)。
 * 一个 action 调用产生的全部事件经一次 emitCanvasGesture 发出,共享 txnId。
 * S6-2:agent 提议事务经 withCanvasGestureContext 设环境上下文——途经的 action 不传
 * opts 也能统一拿到 source:'agent' + 事务级 txnId/proposalId(显式 opts 仍优先)。
 */
export function emitCanvasGesture(
  events: readonly { type: string; payload: Record<string, unknown> }[],
  opts: { source?: 'user' | 'agent' | 'runtime'; txnId?: string } = {},
): void {
  if (events.length === 0) return
  const ctx = getActiveCanvasGestureContext()
  // A synchronous store observer may have handed ownership to a new edit
  // after the old set. Never append that old action's now-obsolete event.
  if (ctx?.canWrite) assertTurnCanWrite(ctx.canWrite)
  const txnId = opts.txnId ?? ctx?.txnId ?? `txn_${crypto.randomUUID().slice(0, 10)}`
  const source = opts.source ?? ctx?.source ?? 'user'
  const proposalId = ctx?.proposalId
  const out = events.map((event) =>
    Object.freeze({
      id: mintId(),
      source,
      txnId,
      ...(proposalId ? { proposalId } : {}),
      type: event.type,
      // 深拷贝成 plain JSON:杜绝 immer draft/共享引用混进日志(§4.4 纪律)。
      payload: JSON.parse(JSON.stringify(event.payload)) as Record<string, unknown>,
    }),
  )
  const projectId = projectIdProvider()
  observeCanvasHistoryGesture(out)
  // Genesis is a replay checkpoint, outside the editable gesture and its Agent transaction.
  const batch: CanvasShadowEvent[] = out
  if (session && session.projectId === projectId && session.genesis) {
    batch.unshift(Object.freeze({
      id: mintId(), txnId: `txn_${crypto.randomUUID().slice(0, 10)}`, source: 'runtime',
      type: 'canvas.snapshot.restored', payload: { snapshot: JSON.parse(JSON.stringify(session.genesis)) as CanvasProjection },
    }))
    session.genesis = null
  }
  testSink?.(batch)
  if (projectId) {
    if (projectId !== bufferProjectId) flushNow()
    bufferProjectId = projectId
    buffer.push(...batch)
    if (buffer.length >= FLUSH_COUNT) flushNow()
    else if (!timer) timer = setTimeout(flushNow, FLUSH_MS)
  }
  for (const hook of afterGestureHooks) hook()
}

const afterGestureHooks = new Set<() => void>()

/**
 * 一笔手势的事件记进撤销日志**之后**才做的派生写。store 订阅在 set() 里同步触发，比 action 打撤销点、发事件都早——
 * 在那里直接写，派生那笔会落在撤销点前面，⌘Z 撤了手势却撤不回它（2026-11-12 连线后撤销，方式偏好没回来）。
 * 订阅只记「有活要做」，真正的写挂在这里，落在这笔手势之后、下一个撤销点之前，撤销时一起回去。
 */
export function onAfterCanvasGesture(hook: () => void): () => void {
  afterGestureHooks.add(hook)
  return () => afterGestureHooks.delete(hook)
}
