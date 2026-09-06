// Agent 面板 v4 · 宿主快照 → 8 个积木的视图模型。**这一层是唯一的 owner。**
//
// 为什么必须是一层而不是散在组件里：v4 的 9 个组件此前一个回调都没有，全部只接拼好的
// view model；接线时那份「拼」的活如果落进组件，就等于把「宿主真相怎么变成一行收据」这件事
// 拆成 9 份，每份只能靠截图证明。放在这里，它是纯函数，可以逐条单测：
//   · 状态映射（含七态 join 的「宿主快照永远赢」）
//   · 缺字段返回 `undefined` 而不是占位数
//   · 队列行 join、用户气泡 chip 的三个来源
//
// **不走 `projectAgentUiProjection.ts`**：那份投影把 8 个宿主状态压成 5 个、把一次 tool 调用
// 压成一个字符串。v4 的一行收据要 7 个状态、要输入/输出两段展开体，从那份压扁的投影里
// 恢复不出来。两份投影各服务各的消费者，不互相覆盖。
import type {
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentTurn,
} from '../../../../electron/shared/projectAgentContracts'
import type { TargetRef } from '../../../../electron/shared/capabilityTargeting'
import { formatResidentToolElapsed, residentToolElapsedMs } from '../resident/residentToolTiming'
import { readableToolName, readableToolPreview, readableToolSummary } from '../resident/residentToolDisplay'
import type { ResidentToolProjection } from '../resident/residentToolProjection'
import { actionFamilyForCapability } from './agentPanelV4ActionFamily'
import type {
  ContextUsage,
  QueueRowData,
  TaskCardData,
  TaskCandidate,
  ToolReceipt,
  V4ActionFamily,
  V4AssistantStatus,
  V4Chip,
  V4FlowItem,
  V4TaskStatus,
  V4ToolStatus,
} from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 渲染层持有的「活的工具调用」。宿主状态里没有这条记录，见本文件底部 §七态。 */
export type V4PendingTool = Readonly<{
  turnId: string
  toolCallId: string
  toolName: string
  args: unknown
  state: 'pending' | 'approved' | 'denied'
}>

/** 任务卡要 join 的 ProductionRun 事实。拿不到就整块不给，不编。 */
export type V4TaskFacts = Readonly<{
  status: V4TaskStatus
  progress?: number
  trailing?: string
  /** 已结算金额（budget ledger 的 `actual`），带币种。 */
  spent?: string
  /** 已预留金额（`reserved`），带币种。 */
  estimated?: string
  error?: string
  errorAction?: string
  candidates?: readonly TaskCandidate[]
}>

export type V4FlowInput = Readonly<{
  items: readonly ProjectAgentItem[]
  turns: readonly ProjectAgentTurn[]
  queue: readonly ProjectAgentQueueItem[]
  pendingTools: readonly V4PendingTool[]
  /** `turnId:toolCallId` → 该次调用的 args（活的那批才有）。 */
  toolArgs: ReadonlyMap<string, unknown>
  /** `turnId:toolCallId` → 会话内缓存的展示投影（终态结果是 ref-only，正文靠它）。 */
  toolProjections: ReadonlyMap<string, ResidentToolProjection>
  /** runId → ProductionRun 域投影出的事实。 */
  taskFacts: ReadonlyMap<string, V4TaskFacts>
  /** clipId → 时间轴上那一段现在叫什么。解不出来的片段不给假名字。 */
  clipLabels: ReadonlyMap<string, string>
  /** skill key → 人话名字。 */
  skillNames: ReadonlyMap<string, string>
  t: Translate
}>

export const toolKey = (turnId: string, toolCallId: string): string => `${turnId}:${toolCallId}`

// ── ② 助手文本 ────────────────────────────────────────────────────────────────

/**
 * 助手三态。`stopped` / `declined` 都是「没说完就停了」，用户看到的是同一件事——
 * 灰字 + 继续。`failed` 不在这里：失败有自己的积木（错误条），混进助手文本会让一段
 * 半截正文看起来像正常回答。
 */
export function assistantStatusOf(status: ProjectAgentStatus): V4AssistantStatus {
  if (status === 'done') return 'complete'
  if (status === 'stopped' || status === 'declined') return 'interrupted'
  return 'streaming'
}

// ── ③ 一行收据：七态 join ──────────────────────────────────────────────────────

/**
 * §七态：宿主快照永远赢。
 *
 * 一次工具调用的真相分布在三处，而且**只有终态那处是持久的**：
 *   1. 终态 tool item（宿主状态，回合结束时一次性写入）——权威
 *   2. 渲染层的待决登记表（`pending / approved / denied`）——只活在这一次运行里
 *   3. `tool-call` 事件已到但两者都没有——「参数齐了，正在跑」
 * 所以判定顺序就是 1 → 2 → 3，而不是反过来：冷重启后登记表是空的，只剩宿主快照，
 * 那时收据必须仍然显示正确的终态。这条顺序有单测钉死。
 *
 * `input-streaming` **不使用**：`tool-call` 事件里的 args 是整包到达的，没有流式片段。
 * 渲染一个永远不出现的状态等于在词表里留一个谎，它退化成 `input-available`。
 */
export function toolStatusOf(
  hostStatus: ProjectAgentStatus | undefined,
  pending: V4PendingTool['state'] | undefined,
): V4ToolStatus {
  if (hostStatus === 'done') return 'output-available'
  if (hostStatus === 'declined') return 'output-denied'
  // `stopped` = 整个回合被打断，不是用户对这一条说「不要」，也不是它自己坏了。
  // 七态里没有「已取消」，硬塞进 `output-denied` 会让行尾写「已拒绝」——那是在替用户
  // 承认一个他没做过的决定。落在 `output-error` 上，行尾的字由调用方用真实原因覆盖。
  if (hostStatus === 'stopped') return 'output-error'
  if (hostStatus === 'failed') return 'output-error'
  if (pending === 'pending') return 'approval-requested'
  if (pending === 'approved' || pending === 'denied') return 'approval-responded'
  return 'input-available'
}

function receiptFor(input: {
  capabilityId: string
  args: unknown
  status: V4ToolStatus
  hostStatus?: ProjectAgentStatus
  projection?: ResidentToolProjection
  text?: string
  elapsedMs?: number
  undoable?: boolean
  t: Translate
}): ToolReceipt {
  const { t, capabilityId, args, projection } = input
  const summary = projection?.effect || readableToolSummary(t, capabilityId, args) || input.text || ''
  const output = projection?.technicalDetails || ''
  const inputText = readableToolPreview(t, capabilityId, args)
  const elapsed = formatResidentToolElapsed(input.elapsedMs)
  // 行尾的字：停止有自己的说法，其余交给状态词表（组件侧的 `statusLabel`）。
  const trailing = input.hostStatus === 'stopped'
    ? t('agentPanelV4.toolStopped')
    : elapsed || undefined
  return Object.freeze({
    label: readableToolName(t, capabilityId, args),
    action: actionFamilyForCapability(capabilityId, args),
    status: input.status,
    ...(summary ? { summary } : {}),
    ...(trailing ? { trailing } : {}),
    ...(inputText ? { input: inputText } : {}),
    ...(output ? { output } : {}),
    ...(input.undoable ? { undoable: true } : {}),
  })
}

// ── ① 用户气泡的 chip：三个来源，都已持久化 ──────────────────────────────────

/**
 * chip 的三种 kind 各有各的家，而且**都是已经落盘的记录**，不是发送那一刻的界面状态：
 *   file  ← `queueItem.attachmentRefs[].display`
 *   skill ← `turn.skillVersions[]`
 *   clip  ← `queueItem.target`（`kind: 'timeline'` 时的 `clipIds`）
 *
 * 第三条值得说明：时间轴片段**不是附件**。它没有 assetId、没有 contentHash，模型也取不到
 * 一个 URL。把它塞进 `attachmentRefs` 会直接流进 `AgentChatAttachment` 交给供应商，
 * 那是个取不到的链接。而 `target` 本来就是这条回合「对谁做」的权威记录，也一直落盘——
 * 片段 chip 读它，零新增契约、零假数据。
 * 片段现在叫什么名字要问时间轴；问不到（比如那一段已经被删了）就只显示编号，不编名字。
 */
export function chipsForTurn(
  turn: ProjectAgentTurn | undefined,
  queueItem: ProjectAgentQueueItem | undefined,
  clipLabels: ReadonlyMap<string, string>,
  skillNames: ReadonlyMap<string, string>,
  t: Translate,
): readonly V4Chip[] {
  const chips: V4Chip[] = []
  for (const ref of queueItem?.attachmentRefs ?? []) {
    if (ref.display?.fileName) chips.push({ kind: 'file', label: ref.display.fileName })
  }
  for (const skill of turn?.skillVersions ?? []) {
    const label = skillNames.get(skill.id)
    if (label) chips.push({ kind: 'skill', label })
  }
  for (const clipId of timelineClipIds(queueItem?.target)) {
    chips.push({ kind: 'clip', label: clipLabels.get(clipId) ?? t('agentPanelV4.clipFallback', { id: shortId(clipId) }) })
  }
  return Object.freeze(chips)
}

function timelineClipIds(target: TargetRef | undefined): readonly string[] {
  return target && target.kind === 'timeline' ? target.clipIds : []
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(-6)
}

// ── ④ 任务卡 ─────────────────────────────────────────────────────────────────

/**
 * task item 是 **ref-only**：整包 payload 只有 `{kind, runId, …}`，`status` 在契约里硬钉
 * `'done'`（意思是「这张卡建好了」，不是「那个任务完成了」）。所以状态、进度、金额全部要拿
 * `runId` 去 ProductionRun 域投影里 join。
 * join 不到（比如面板里有三个 runId 而 run store 一次只装得下一个）就**只渲染标题**，
 * 不给一个假的「排队中」——那会让用户以为有东西在跑。
 */
function taskCardFor(
  runId: string,
  title: string,
  action: V4ActionFamily,
  facts: V4TaskFacts | undefined,
  t: Translate,
): TaskCardData {
  if (!facts) {
    return Object.freeze({ title, action, status: 'queued' as const, footnote: t('agentPanelV4.taskUnknown') })
  }
  return Object.freeze({
    title,
    action,
    status: facts.status,
    ...(facts.trailing ? { trailing: facts.trailing } : {}),
    ...(facts.progress !== undefined ? { progress: facts.progress } : {}),
    ...(facts.candidates?.length ? { candidates: facts.candidates } : {}),
    ...(facts.estimated ? { cost: facts.estimated } : {}),
    ...(facts.spent ? { footnoteTrailing: facts.spent } : {}),
    ...(facts.error ? { error: facts.error } : {}),
    ...(facts.errorAction ? { errorAction: facts.errorAction } : {}),
  })
}

// ── 对话流装配 ────────────────────────────────────────────────────────────────

function sortedItems(items: readonly ProjectAgentItem[]): readonly ProjectAgentItem[] {
  // `createdAt` 同毫秒的项在同一次 reduce 里很常见（一个回合的 tool + task 一起写入），
  // 所以第二键是 itemId：稳定顺序比「哪个真的更早」重要——顺序抖动会让基线随机翻红。
  return [...items].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.itemId.localeCompare(right.itemId)
      : left.createdAt.localeCompare(right.createdAt),
  )
}

export function projectV4Flow(input: V4FlowInput): readonly V4FlowItem[] {
  const { t } = input
  const turnById = new Map(input.turns.map((turn) => [turn.turnId, turn]))
  const queueByTurnId = new Map(input.queue.map((item) => [item.turnId, item]))
  // artifact 不是第九个积木：一个 run 产出的若干 artifact 就是那张任务卡的候选缩略图
  // （定稿「多候选 = 完成态结果区多张缩略图，点一张即采用」）。先按 runId 归堆。
  const artifactsByRunId = new Map<string, string[]>()
  for (const item of input.items) {
    if (item.kind !== 'artifact') continue
    const bucket = artifactsByRunId.get(item.artifact.runId) ?? []
    bucket.push(item.artifact.artifactId)
    artifactsByRunId.set(item.artifact.runId, bucket)
  }
  const renderedRunIds = new Set<string>()
  const flow: V4FlowItem[] = []
  for (const item of sortedItems(input.items)) {
    if (item.kind === 'user') {
      const chips = chipsForTurn(turnById.get(item.turnId), queueByTurnId.get(item.turnId), input.clipLabels, input.skillNames, t)
      flow.push({ kind: 'user', text: item.text, ...(chips.length ? { chips } : {}) })
      continue
    }
    if (item.kind === 'assistant') {
      // 空的助手条目是「回合刚开始、第一个 delta 还没到」。渲染一个空气泡等于在流里
      // 留一块跳动的空白；这一刻真正该出现的是思考行，由调用方按运行中的回合补。
      if (!item.text.trim()) continue
      flow.push({ kind: 'assistant', text: item.text, status: assistantStatusOf(item.status) })
      continue
    }
    if (item.kind === 'tool') {
      const key = toolKey(item.turnId, item.toolCallId)
      const pending = input.pendingTools.find((entry) => toolKey(entry.turnId, entry.toolCallId) === key)
      const args = input.toolArgs.get(key) ?? pending?.args
      flow.push({
        kind: 'tool',
        receipt: receiptFor({
          capabilityId: item.capability.id,
          args,
          status: toolStatusOf(item.status, pending?.state),
          hostStatus: item.status,
          projection: input.toolProjections.get(key),
          ...(item.text ? { text: item.text } : {}),
          elapsedMs: residentToolElapsedMs(item.status, item.createdAt, item.updatedAt),
          t,
        }),
      })
      continue
    }
    if (item.kind === 'task') {
      const runId = item.task.kind === 'production-run' ? item.task.runId : undefined
      if (!runId) continue
      renderedRunIds.add(runId)
      const facts = input.taskFacts.get(runId)
      const artifacts = artifactsByRunId.get(runId) ?? []
      const withCandidates: V4TaskFacts | undefined = facts
        ? Object.freeze({
            ...facts,
            ...(facts.candidates?.length || !artifacts.length
              ? {}
              : { candidates: artifacts.map((id, index) => ({ tag: String(index + 1) })) }),
          })
        : undefined
      flow.push({
        kind: 'task',
        task: taskCardFor(runId, t('agentPanelV4.taskRun'), 'video', withCandidates, t),
      })
      continue
    }
    if (item.kind === 'failure') {
      flow.push({
        kind: 'error',
        reason: item.message,
        ...(item.nextAction ? { action: item.nextAction } : {}),
      })
      continue
    }
    // proposal / artifact：前者是审批账本的引用（它的用户可见面是介入槽），
    // 后者已折进上面的任务卡。都不在对话流里单独出现。
  }
  // 还没写进宿主状态的活工具（`tool-call` 事件已到、回合还没结束）接在最后。
  for (const pending of input.pendingTools) {
    const key = toolKey(pending.turnId, pending.toolCallId)
    if (input.items.some((item) => item.kind === 'tool' && toolKey(item.turnId, item.toolCallId) === key)) continue
    flow.push({
      kind: 'tool',
      receipt: receiptFor({
        capabilityId: pending.toolName,
        args: pending.args,
        status: toolStatusOf(undefined, pending.state),
        projection: input.toolProjections.get(key),
        t,
      }),
    })
  }
  return Object.freeze(flow)
}

// ── ⑥ 队列行 ─────────────────────────────────────────────────────────────────

/**
 * 队列项上**没有文本**——它只有 turnId。行标题要 join 同 turnId 的 user item，
 * 现役面板也是这么做的。join 不到就退回一句「未命名任务」，不显示 turnId（那是内部标识）。
 *
 * 宿主另有 `paused?`，v4 三态里没有「暂停」。暂停的项仍然是排队中的项，只是不会被取走执行；
 * 把它单独画成第四态需要改外观，所以这里让它留在 `queued`，暂停这件事由行尾动作表达。
 */
export function projectV4Queue(input: {
  queue: readonly ProjectAgentQueueItem[]
  items: readonly ProjectAgentItem[]
  labels: Readonly<{ jumpAhead: string; remove: string; interrupt: string; untitled: string }>
}): readonly QueueRowData[] {
  const rows: QueueRowData[] = []
  for (const entry of input.queue) {
    const user = input.items.find((item) => item.kind === 'user' && item.turnId === entry.turnId)
    const title = user?.kind === 'user' && user.text.trim() ? user.text : input.labels.untitled
    if (entry.status === 'running') {
      rows.push({ title, status: 'running', destructiveAction: input.labels.interrupt })
      continue
    }
    if (entry.status === 'queued' || entry.status === 'proposed') {
      rows.push({ title, status: 'queued', actions: [input.labels.jumpAhead, input.labels.remove] })
      continue
    }
    rows.push({ title, status: 'complete' })
  }
  return Object.freeze(rows)
}

// ── ⑧ Context 环 ─────────────────────────────────────────────────────────────

/**
 * 环上那个百分比。**两个数都真实存在、且 `max > 0`** 才成立——否则 `undefined`，
 * 组件据此把环画灰、钮上写「—」。`0%` 是一个断言（「你几乎没用上下文」），
 * 而缺 max 那一刻我们其实是「不知道这个模型多大」，两件事不能用同一个数表示。
 */
export function contextPercent(usage: ContextUsage): number | undefined {
  if (usage.used === undefined || usage.max === undefined || usage.max <= 0) return undefined
  return Math.min(100, Math.round((usage.used / usage.max) * 100))
}

const kilo = (value: number): string => `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`

/**
 * 本**线程**的用量，不是 App 会话累计。
 *
 * ⚠️ 别接 `agentUsageStore`：它自陈是「App 会话累计、跨线程、跨项目」，而且在入口就把
 * `cachedPromptTokens` 丢了。环画的是这一条线程，接它数字是错的。
 * 逐 turn 的 `usage` 已经随终态回合持久化，按 threadId 汇总即可——今天没人这么做，
 * 所以面板上才只好印那句写死的「还能聊 ~40 轮」。
 *
 * `used` 取**末次回合的 promptTokens**（那就是「现在上下文里装了多少」），不是累加：
 * 累加会随聊天次数一路涨到超过窗口，画出一个 300% 的环。
 */
export function projectV4Context(input: {
  turns: readonly ProjectAgentTurn[]
  contextWindow?: number
  formatCost: (amountUsd: number) => string
}): ContextUsage {
  const settled = input.turns.filter((turn) => turn.usage)
  const last = settled[settled.length - 1]?.usage
  let inputTokens = 0
  let outputTokens = 0
  let cacheTokens = 0
  let reasoningTokens: number | undefined
  let cost: number | undefined
  for (const turn of settled) {
    const usage = turn.usage!
    inputTokens += usage.promptTokens
    outputTokens += usage.completionTokens
    cacheTokens += usage.cachedPromptTokens
    if (usage.reasoningTokens !== undefined) reasoningTokens = (reasoningTokens ?? 0) + usage.reasoningTokens
    if (usage.costUsd !== undefined) cost = (cost ?? 0) + usage.costUsd
  }
  return Object.freeze({
    ...(last ? { used: last.promptTokens } : {}),
    ...(input.contextWindow !== undefined ? { max: input.contextWindow } : {}),
    ...(settled.length ? { input: kilo(inputTokens), output: kilo(outputTokens), cache: kilo(cacheTokens) } : {}),
    ...(reasoningTokens !== undefined ? { reasoning: kilo(reasoningTokens) } : {}),
    ...(cost !== undefined ? { cost: input.formatCost(cost) } : {}),
  })
}
