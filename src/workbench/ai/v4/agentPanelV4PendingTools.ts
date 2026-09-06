// Agent 面板 v4 · 「活的工具调用」登记表。
//
// 为什么必须有这么一份，而且必须在**组件树之外**：
// 宿主状态里根本没有「正在跑的工具调用」这条记录。`ProjectAgentToolItem` 只在回合**结束**时
// 从 `response.toolCalls` 一次性生成；跑的过程中唯一的活记录是执行协调器内存里的
// `PendingToolDecision`，而它从不进 `ProjectAgentHostState`。所以从 `tool-call` 事件到达、
// 到用户点确认、到终态 item 落盘这段时间里，界面要显示什么，只有渲染层自己知道。
//
// 放在模块级而不是组件 state：`runWorkbenchAgent` 的 `onToolCall` 回调在一次 `await` 链里
// 触发，那时组件可能正好因为面板宽度变化而重挂载。挂在组件上就会连同待决一起丢——
// 用户看到的是审批卡凭空消失、回合永远卡住。它跟着 binding 走，不跟着渲染走。
//
// 它**不是**第二份真相：终态一到，`toolStatusOf` 就以宿主快照为准（见 projection §七态），
// 这里的记录只在「宿主还没有话说」的那段时间里说话。
import type { ToolCallEvent } from '../workbenchAgentRunner'
import type { V4PendingTool } from './agentPanelV4Projection'

export type V4PendingToolRecord = Readonly<{
  call: ToolCallEvent
  bindingKey: string
  state: V4PendingTool['state']
}>

const records = new Map<string, V4PendingToolRecord>()
/** 已经发出决定、还没等到宿主回话的那些。防止双击把同一个决定发两次。 */
const resolving = new Set<string>()
const listeners = new Set<() => void>()

/**
 * `listFor` 的**缓存**，以及它为什么必须存在。
 *
 * 这张表是 `useSyncExternalStore` 的数据源，而 React 用 `Object.is` 比较相邻两次
 * `getSnapshot()` 的返回值。每次都 `[...records.values()].filter(...)` 会返回一个新数组，
 * 于是「变了」永远成立——组件进入无限重渲染，被错误边界兜住，整个工作台变成
 * 「工作台加载失败」。空态共用一个冻结数组只挡住了一半：**有待决的时候**才是它真正
 * 出现的时刻，也正是审批卡该浮出来的那一刻。
 *
 * 所以缓存按 (version, bindingKey) 记：任何一次改动 bump version，同一版本同一绑定
 * 反复问只算一次。2026-09-06 由 `agent-v4-short-film.walk.mjs` 抓到。
 */
let version = 0
let cache: { version: number; bindingKey: string | null; value: readonly V4PendingToolRecord[] } | null = null

export const pendingToolKey = (call: Pick<ToolCallEvent, 'turnId' | 'toolCallId'>): string =>
  `${call.turnId}:${call.toolCallId}`

export const projectBindingKey = (binding: { immutableProjectUuid: string; projectGeneration: number }): string =>
  `${binding.immutableProjectUuid}:${binding.projectGeneration}`

function emit(): void {
  version += 1
  cache = null
  for (const listener of listeners) listener()
}

export const agentPanelV4PendingTools = Object.freeze({
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** `tool-call` 事件到达：登记为待决。 */
  register(call: ToolCallEvent, bindingKey: string): void {
    records.set(pendingToolKey(call), { call, bindingKey, state: 'pending' })
    emit()
  },
  /**
   * 决定已被宿主接受：留下 approved/denied，让收据显示「已确认」直到终态到达。
   * 参数类型是「待决三态里除去 pending 的那两个」——**derive 出来的，不重列**。
   * 重列一遍就是第二份词表：以后加一个态时，这里会安静地漏掉它。
   */
  settle(key: string, state: Exclude<V4PendingTool['state'], 'pending'>): void {
    const current = records.get(key)
    if (!current || current.state !== 'pending') return
    records.set(key, { ...current, state })
    emit()
  },
  beginResolving(key: string): boolean {
    if (resolving.has(key)) return false
    resolving.add(key)
    return true
  },
  endResolving(key: string): void {
    resolving.delete(key)
  },
  get(key: string): V4PendingToolRecord | undefined {
    return records.get(key)
  },
  /** 回合结束：这一回合的活记录全部作废，往后由宿主快照说话。 */
  clearTurn(turnId: string): void {
    let changed = false
    for (const key of [...records.keys()]) {
      if (!key.startsWith(`${turnId}:`)) continue
      records.delete(key)
      resolving.delete(key)
      changed = true
    }
    if (changed) emit()
  },
  /**
   * 当前项目绑定下的待决，按登记顺序。介入槽取其中第一条 `pending`。
   * 返回值**必须**在两次改动之间保持同一个引用——见上面 `cache` 那段注释。
   */
  listFor(bindingKey: string | null): readonly V4PendingToolRecord[] {
    if (!bindingKey) return EMPTY
    if (cache && cache.version === version && cache.bindingKey === bindingKey) return cache.value
    const out = [...records.values()].filter((record) => record.bindingKey === bindingKey)
    const value = out.length ? Object.freeze(out) : EMPTY
    cache = { version, bindingKey, value }
    return value
  },
  /** 测试用：清空一切。生产路径永远只清某个回合。 */
  reset(): void {
    records.clear()
    resolving.clear()
    emit()
  },
})

// `listFor` 每次返回新数组会让 `useSyncExternalStore` 判定「变了」并无限重渲染。
// 空态共用同一个冻结数组，是这条订阅链能停下来的原因。
const EMPTY: readonly V4PendingToolRecord[] = Object.freeze([])

/** 投影层要的是纯数据形态，不是带 `confirm()` 的事件对象。 */
export function toProjectionPendingTools(records: readonly V4PendingToolRecord[]): readonly V4PendingTool[] {
  return Object.freeze(
    records.map((record) => ({
      turnId: record.call.turnId,
      toolCallId: record.call.toolCallId,
      toolName: record.call.toolName,
      args: record.call.args,
      state: record.state,
    })),
  )
}
