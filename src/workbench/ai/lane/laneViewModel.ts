import { capabilitySupportsUndo } from '../../../../electron/shared/agentCapabilities/registry'
import { redactToolArguments, redactResidentSensitiveText } from '../resident/residentToolText'
// Agent lane · 视图投影（纯函数，唯一 owner）
//
// **这一层最重要的一句话是「它不排序」。**
// 今天 `agentPanelV4Projection.sortedItems()` 拿 `createdAt` 加数组下标排一遍，因为宿主
// 那边的记录本来就没有可信顺序（实核：同回合 8 条工具的 `createdAt` 去重后只有 1 个值，
// 助手条目比它们早 107 秒——按它重排会**造出一个假顺序**）。新通路里顺序是 pi 转录记下来的，
// 主进程按走序赋 `sequence`，这里只按 `sequence` 走一遍（方案 §2.2 不变量 I1）。
//
// 三条硬规则，逐条对应一个今天存在的毛病：
//   · **不排序** → 删掉 `sortedItems()` 那把假尺子。
//   · **不 join 第二真相** → 删掉 `agentPanelV4PendingTools`（它自陈存在理由 = 宿主没有
//     运行中工具记录）；运行中状态直接来自 `LanePart.running`。
//   · **不缓存正文** → 删掉 `residentToolProjection` 往 localStorage 写工具正文那条路
//     （清浏览器存储 = 历史收据正文静默清空）。
//
// 输出是**现有的** `V4FlowItem[]` 与 `ContextUsage`——v4 的 8 个积木一行不改，它们只是
// 终于按发生顺序出现。
import type {
  LaneApprovalNote,
  LaneMetric,
  LanePart,
  LanePendingApproval,
  LaneProjection,
  LaneQueuedMessage,
} from '../../../../electron/shared/agentLane/laneContracts'
import {
  LANE_APPROVAL_NOTE_TYPE,
  isLaneApprovalNote,
  laneApprovalWasRefused,
} from '../../../../electron/shared/agentLane/laneContracts'
import type { V4InterventionSource } from '../v4/agentPanelV4Intervention'
import { resolveModelToolCapabilityId } from '../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { actionFamilyForCapability } from '../v4/agentPanelV4ActionFamily'
import type {
  ContextUsage,
  TaskCardData,
  ToolReceipt,
  V4ActionFamily,
  V4Chip,
  V4FlowItem,
  V4ToolStatus,
} from '../v4/agentPanelV4Types'

/**
 * 可见文字**全部**由调用方给（R15：不许在这一层长出硬编码 UI 文案）。
 * 这不只是合规——工具的人话名字本来就该和收据、任务卡、介入槽共用同一份词表
 * （`agentPanelV4Labels.ts`），在这里另起一份就是 R14.1 要横扫的「同一语义两份定义」。
 */
export interface LaneViewModelLabels {
  /** 工具别名 → 人话动词 + 对象（「读取文稿」）。 */
  toolLabel(toolName: string, args: unknown): string
  toolSummary(toolName: string, args: unknown): string | undefined
  toolFailure(text: string): string | undefined
  /** 思考行左侧那个词。 */
  thinkingLabel: string
  /** 数字格式化：token 数、金额。缺省不印，不是印 0。 */
  formatTokens(value: number): string
  formatCost(usd: number): string
  /**
   * 「正在重试 2/4」。**两个数都由调用方填**（R15）——它是这一族里唯一带变量的可见文字，
   * 而 zh-CN 与 en 的语序不同，在这一层拼字符串就等于把语序钉死成中文的。
   *
   * 词条**故意还没进 `src/i18n/locales/agentPanelV4.ts`**：影子期这一族标签一个生产调用方
   * 都还没有（`useAgentPanelV4Data.ts` 喂的是旧那份投影），先落一个 `agentPanelV4.retrying`
   * 就是一个到不了的死键，`check:i18n-dead-keys` 会当场红——它红得对。词条和它的消费者
   * 同一个 commit 出现，就在把面板接到 lane 的那次切换 PR 里。
   */
  retryLabel(attempt: number, maxAttempts: number): string
  /**
   * 「这个数我们没有」的占位（面板上那个 `—`）。三态里的 `unknown` 走它——
   * **整行留着、数字位写占位符**，让用户看见「这一项存在但拿不到」，而不是看见一个 0，
   * 也不是让整行凭空消失（消失会让人以为这一项不存在）。
   */
  unknown: string
  /**
   * 「这个模型不按 token 计费」那句话。三态里的 `not-applicable` 走它（花费行）。
   *
   * **本层不给它默认值，也不在 i18n 里预先放一条词条。** 影子期没有任何生产调用方接到
   * `laneViewModel`（`laneShadowStructure.test.ts` 正是在钉这件事），所以此刻往
   * `agentPanelV4.*` 里写一条 `contextCostFree` 就是一个谁也到不了的死键——
   * `check:i18n` 的死键门会直接拦下来，而它拦得对：预先摆一条没人能用的词条，
   * 和预先摆一段没人调用的代码是同一件事（P1）。接线那一刻由调用方从 i18n 取词传进来，
   * 与旁边的 `unknown`（今天已经是活的 `agentPanelV4.contextUnknown`）走同一条路。
   */
  free: string
  /** 任务卡的标题（「生成任务」）。卡上其余文字全是数字，所以只需要这一句。 */
  taskTitle: string
  /** 「{done} / {total} 阶段」。两个数分开传，是因为不同语言的量词位置不同。 */
  formatStages(done: number, total: number): string
  /**
   * 金额。**币种由领域给**（`ProductionRun.budget.currency`），不是这一层猜的——
   * 同一个项目里用 APIMart 和用 kie 结算的币种可以不同，印错的那个数看起来完全正常。
   */
  formatMoney(currency: string, amount: number): string
  /** join 不到领域事实时卡上那句脚注（「任务详情在任务中心」）。 */
  taskUnknown: string
  /**
   * 技能 key → 用户在技能库里看到的那个名字。
   *
   * **不给默认值、也不在这一层猜**：技能叫什么由技能库单点持有（`skillDisplayTitle`，
   * `/` 菜单与技能库画廊读的也是它），这一层没有那份目录。查不到时说什么由调用方决定
   * （今天是原样印 key——「有这么个技能、但它现在不在这台机器上」是真话，
   * 凭空隐藏那颗 chip 才是把用户做过的操作抹掉）。
   */
  skillLabel(skillKey: string): string
  /**
   * 技能 key → 它的封面 / 预览。和 `skillLabel` 同一份目录、同一个查不到的处置：
   * 没有就不给，chip 落到 `SkillMedia` 自己的图标占位，**不画一个假的色块**。
   * 这一层同样不持有技能目录，所以由调用方喂。缺席（设计实验室、单测）= 没有封面。
   */
  skillMedia?(skillKey: string): { cover?: string; preview?: { url: string; type: 'image' | 'video' } } | undefined
}

/**
 * 三态 → 一个字符串或「整行不要」。**这里是「绝不画 0」那条规则唯一的执行点。**
 *
 * · `known`          → 格式化那个数（真是 0 就印 0 —— 那是量到的，不是编的）
 * · `unknown`        → 占位符（`—`）
 * · `not-applicable` → `undefined`，调用方整行不渲染；花费行例外，它有一句更好的话（「免费」）
 */
function metricText(metric: LaneMetric, format: (value: number) => string, unknown: string): string | undefined {
  if (metric.state === 'known') return format(metric.value)
  if (metric.state === 'unknown') return unknown
  return undefined
}

export interface LaneViewModel {
  items: readonly V4FlowItem[]
  usage: ContextUsage
  running: boolean
  /**
   * 排着队还没被送出去的插话（v4 的积木⑥「队列行」）。
   *
   * **它不进 `items`**：`items` 是已经发生的事，队列是**还没发生**的事。混进去的话，
   * 用户会在时间线里看到一句他刚打的话排在模型的回答后面，像是模型已经读过它了——
   * 而 `one-at-a-time` 下它要等到下一次请求才被吃进去。
   *
   * 原样带出 `entryId`：撤回那一条要靠它，而「队里最后一条」是猜（队列随时会被消费）。
   */
  queues: readonly LaneQueuedMessage[]
  /**
   * 只在真的在退避时存在。**缺失 = 没在重试**，不是重试了 0 次——面板据此决定画不画那一行，
   * 而一个恒存在的「重试 0/4」会把「一切正常」说成「它在挣扎」。
   */
  retry?: string
  /**
   * 有一张审批卡在等用户。**它不是流里的一行**——它住在 composer 上方那个介入槽里
   * （v4 定稿的积木 ⑤），所以它不进 `items`；进了就会在滚上去之后消失，而用户正等着答它。
   */
  pending?: LanePendingApproval
}

/**
 * 待决的卡 → 现役介入槽要的那份数据源。
 *
 * 槽的**投影**（kind / 徽标 / 摘要 / 范围那一行）已经有唯一 owner
 * （`agentPanelV4Intervention.ts`），这里只做「把 lane 的词表换成它的词表」这一步——
 * 再写一份 kind 判定就是 R14.1 要横扫的「同一语义两份定义」。
 */
export function laneInterventionSource(pending: LanePendingApproval): V4InterventionSource {
  return {
    toolName: pending.toolName,
    args: pending.args,
    ...(pending.effectClass ? { effectClass: pending.effectClass } : { effectClass: undefined }),
    pendingCount: pending.pendingCount,
  }
}

/** 一次工具调用在流里的落点，用来把结果并回它的那一行（按 id join，不复制正文）。 */
interface ToolSlot {
  index: number
  toolName: string
  args: unknown
}

function familyFor(toolName: string, args: unknown): V4ActionFamily {
  const resolved = resolveModelToolCapabilityId(toolName, args)
  // 认不出来的别名走 `write`：它是「动了什么东西」里最不宣称具体对象的那个。
  // 猜一个具体 icon（比如看名字里有没有 "image"）会在收据上印一个我们没量过的断言。
  return resolved ? actionFamilyForCapability(resolved, args) : 'write'
}


function receiptFor(part: Extract<LanePart, { kind: 'tool-call' }>, labels: LaneViewModelLabels): ToolReceipt {
  const summary = labels.toolSummary(part.toolName, part.args)
  return {
    toolCallId: part.toolCallId,
    label: labels.toolLabel(part.toolName, part.args),
    ...(summary ? { summary: redactResidentSensitiveText(summary) } : {}),
    action: familyFor(part.toolName, part.args),
    // 「跑着呢」和「填参数呢」是两件事：`input-available` 说的是参数已经齐了。
    // 结果落定之前不许写 `output-available`——那是在替一件还没发生的事下结论。
    status: part.running ? 'input-available' : 'input-streaming',
    input: part.args && typeof part.args === 'object' && Object.keys(part.args).length === 0
      ? undefined : redactToolArguments(part.args) || undefined,
  }
}

/**
 * 一张任务卡（方案 §2.2 G13）。
 *
 * **`facts` 缺席 = 只画标题 + 一句「详情在任务中心」**，与今天 `taskCardFor` 的裁决逐字相同：
 * join 不到就不给状态，而不是给一个「排队中」——那会让用户以为有东西在跑，
 * 而实际上我们只是没读到那条 run。
 */
function taskCardFor(part: Extract<LanePart, { kind: 'task' }>, labels: LaneViewModelLabels): TaskCardData {
  const { facts } = part
  if (!facts) return { title: labels.taskTitle, action: 'video', status: 'queued', footnote: labels.taskUnknown }
  const money = (amount: number | undefined): string | undefined =>
    amount !== undefined && facts.currency !== undefined ? labels.formatMoney(facts.currency, amount) : undefined
  const spent = money(facts.spent)
  const estimated = money(facts.estimated)
  return {
    title: labels.taskTitle,
    action: 'video',
    status: facts.status,
    ...(facts.stagesTotal ? { trailing: labels.formatStages(facts.stagesDone ?? 0, facts.stagesTotal) } : {}),
    ...(facts.progress === undefined ? {} : { progress: facts.progress }),
    // Keep the verified artifact identity and image; numbering is display-only.
    ...(facts.candidates?.length
      ? { candidates: facts.candidates.map((candidate, index) => ({ ...candidate, tag: String(index + 1) })) } : {}),
    ...(estimated === undefined ? {} : { cost: estimated }),
    ...(spent === undefined ? {} : { footnoteTrailing: spent }),
  }
}

/**
 * 同一回合里被工具行隔开的助手文本 → **一个气泡**。
 *
 * 为什么这不是「排版偏好」：模型一轮回复在传输上本来就是**一条消息里的若干块**
 * （text / tool-call / text …，pi 的 `content` 数组、AI SDK 的 `UIMessage.parts` 都是这个形状）。
 * 一块一个气泡，等于把「一个人说的一段话」切成三个人说的三句话——用户看到的是
 * 「好，我先看看…」「好的，用 Seedream 4.5…」「已经提交生成了…」三块各自带边距地摊着，
 * 读起来像模型自言自语了三次（2026-09-10 用户反馈 #7）。
 *
 * 合并规则只有两条，都以**转录记下来的事实**为准，不猜：
 *   · 回合边界 = 用户消息。回合是用户说一句、模型答一轮，这是转录里唯一硬的分界。
 *   · 落点 = 这一回合**最后**一段文本的位置。留在第一段那里，流式生长的字就跑到
 *     已经发生的工具行**上面**去了——那是在时间线里倒着写。
 *
 * 段与段之间用空行接：Markdown 里空行才是段落分隔，直接拼会把两段粘成一段。
 * 工具行一个都不动——它们仍按 `sequence` 内联在流里（2026-09-06 拍板「工具调用内联不置顶」）。
 */
function mergeAssistantTextPerTurn(
  items: readonly V4FlowItem[],
  turnOf: readonly number[],
  /**
   * 这一回合用了哪个技能（人话名字）。**凭据盖在合并出来的那个气泡上，不新开一行**：
   * v4 只有 8 个积木，「已使用技能」是助手文本的一个**状态**，不是第九种东西（定稿 Vocabulary 板）。
   * 用户气泡上那颗 chip 说的是「我挂了它」，气泡头这一行说的是「它真的进了这一轮」——
   * 两句话不一样，所以两处都要有（用户反馈 #6：选了技能，对话里一个字都看不到它）。
   */
  skillOfTurn: (turn: number) => string | undefined,
): V4FlowItem[] {
  const texts = new Map<number, string[]>()
  const last = new Map<number, number>()
  items.forEach((item, index) => {
    if (item.kind !== 'assistant') return
    const turn = turnOf[index]!
    const bucket = texts.get(turn)
    if (bucket) bucket.push(item.text)
    else texts.set(turn, [item.text])
    last.set(turn, index)
  })
  const merged: V4FlowItem[] = []
  items.forEach((item, index) => {
    if (item.kind !== 'assistant') { merged.push(item); return }
    const turn = turnOf[index]!
    // 不是这一回合最后一段就整条不出：它的正文已经进了那一段的气泡里。
    if (last.get(turn) !== index) return
    const skill = skillOfTurn(turn)
    // 三态与「继续」的落点取**最后一段**：还在流的是它，被打断的也是它。
    merged.push({ ...item, text: texts.get(turn)!.filter(Boolean).join('\n\n'), ...(skill ? { skill } : {}) })
  })
  return merged
}

/** 收据七态里，「结果回来了」只有三种可能：成了 / 被闸拒了 / 坏了。 */
function settledStatus(isError: boolean, denied: boolean): V4ToolStatus {
  if (!isError) return 'output-available'
  return denied ? 'output-denied' : 'output-error'
}

/**
 * 把一份有序投影摊成 v4 的流。
 *
 * 走的是 `parts` 的自然顺序——它已经是 `sequence` 递增的（主进程按 pi 转录走序赋值）。
 * 这里**断言**这件事而不是相信它：顺序一旦在某一层被悄悄打乱，面板上看到的就是
 * 「它先做了、后说要做」，而那种错在截图里非常像「模型自己顺序乱」。
 */
export function laneViewModel(projection: LaneProjection, labels: LaneViewModelLabels, undoableToolCallId?: string): LaneViewModel {
  const items: V4FlowItem[] = []
  /**
   * 每一条流项属于第几回合。**它不是第二份顺序真相**——顺序仍然只有 `sequence` 一个来源；
   * 这里记的是「用户上一次说话之后」这件事，而合并气泡与技能凭据都以回合为单位。
   */
  const turnOf: number[] = []
  const slots = new Map<string, ToolSlot>()
  const denials = new Map<string, LaneApprovalNote>()
  /** 这一回合挂着的技能（来自开启这一回合的那条用户消息）。缺席 = 这一轮没挂技能。 */
  const skillOfTurn = new Map<number, string>()
  let turn = 0
  const push = (item: V4FlowItem): void => { turnOf.push(turn); items.push(item) }

  let previous = -1
  for (const part of projection.parts) {
    if (part.sequence <= previous) {
      throw new Error(`Lane projection is out of order at sequence ${part.sequence} (previous ${previous})`)
    }
    previous = part.sequence

    if (part.kind === 'host-note') {
      // 宿主记录不占流里的一行。审批拒收的那句话 pi 已经一字不改地做成了那次调用的
      // tool result（探针 §4.2 臂 B），所以这里只用它把那一行的状态从「坏了」改成
      // 「被拒了」——同一句话说两遍是在骗用户，让他以为发生了两件事。
      if (part.noteType === LANE_APPROVAL_NOTE_TYPE && isLaneApprovalNote(part.data) && laneApprovalWasRefused(part.data)) {
        denials.set(part.data.toolCallId, part.data)
      }
      continue
    }
    if (part.kind === 'error') {
      push({ kind: 'error', reason: part.text })
      continue
    }
    if (part.kind === 'task') {
      push({ kind: 'task', task: taskCardFor(part, labels) })
      continue
    }
    if (part.kind === 'user') {
      // 用户说话 = 新回合开始。这是转录里唯一硬的回合分界（模型一轮回复内部没有分界可言）。
      turn += 1
      if (part.skillKey) skillOfTurn.set(turn, part.skillKey)
      const chip: V4Chip | undefined = part.skillKey
        ? { kind: 'skill', label: labels.skillLabel(part.skillKey), ...labels.skillMedia?.(part.skillKey) } : undefined
      push({ kind: 'user', text: part.text, ...(chip ? { chips: [chip] } : {}) })
      continue
    }
    if (part.kind === 'assistant-text') {
      push({ kind: 'assistant', text: part.text, status: part.interrupted ? 'interrupted' : part.streaming ? 'streaming' : 'complete',
        ...(part.continuationEntryId ? { continuationEntryId: part.continuationEntryId } : {}) })
      continue
    }
    if (part.kind === 'thinking') {
      push({ kind: 'thinking', label: labels.thinkingLabel, meta: '', text: part.text, streaming: part.streaming })
      continue
    }
    if (part.kind === 'tool-call') {
      slots.set(part.toolCallId, { index: items.length, toolName: part.toolName, args: part.args })
      push({ kind: 'tool', receipt: receiptFor(part, labels) })
      continue
    }
    // tool-result：并回**它自己那一行**。找不到对应的调用不新开一行——那会让用户看到一条
    // 没有起因的结果；找不到本身是上游 bug，安静地多画一行只会把它藏起来。
    const slot = slots.get(part.toolCallId)
    if (!slot) continue
    const denial = denials.get(part.toolCallId)
    const existing = items[slot.index]
    if (existing.kind !== 'tool') continue
    // 被拒的那一行只说「已拒绝」（拍板过的 Vocabulary 板 `v4-tool-output-denied`：行尾是状态词，
    // 没有摘要、没有展开体）。理由住在用户自己填它的那张介入槽里；再把它印到行尾、又塞进
    // 展开体，同一句话就在面板上出现三次——设计实验室 P6 探针把这一格接上真投影时当场红了。
    const { summary: _summary, ...withoutSummary } = existing.receipt
    const failure = part.isError ? labels.toolFailure(part.text) : undefined
    items[slot.index] = {
      kind: 'tool',
      receipt: denial !== undefined
        ? { ...withoutSummary, status: 'output-denied' }
        : { ...(part.isError ? withoutSummary : existing.receipt), status: settledStatus(part.isError, false),
          ...(failure ? { summary: redactResidentSensitiveText(failure) } : {}),
          ...(!part.isError && part.toolCallId === undoableToolCallId
            && capabilitySupportsUndo(resolveModelToolCapabilityId(slot.toolName, slot.args) ?? slot.toolName, slot.args) ? { undoable: true } : {}),
          output: redactResidentSensitiveText(part.text) || undefined },
    }
  }

  const { usage } = projection
  // 花费的 `not-applicable` 有一句比「不渲染」更有用的话：这个模型免费。其余两行没有。
  const cost = usage.cost.state === 'not-applicable'
    ? labels.free : metricText(usage.cost, labels.formatCost, labels.unknown)
  const reasoning = metricText(usage.reasoningTokens, labels.formatTokens, labels.unknown)
  return {
    items: mergeAssistantTextPerTurn(items, turnOf, (at) => {
      const skillKey = skillOfTurn.get(at)
      return skillKey ? labels.skillLabel(skillKey) : undefined
    }),
    running: projection.running,
    // 队列原样带出去：这一层不合并、不去重、不改顺序——pi 的 FIFO 就是用户打字的顺序。
    queues: projection.queues,
    ...(projection.retry
      ? { retry: labels.retryLabel(projection.retry.attempt, projection.retry.maxAttempts) }
      : {}),
    ...(projection.pending ? { pending: projection.pending } : {}),
    usage: {
      // 环的分子是「现在上下文里装了多少」，不是累计用量——累计会画出一个 300% 的环。
      // 三态里只有 `known` 能当分子；`unknown` 时**连 `used` 都不给**，钮上退回 `—`。
      ...(usage.contextTokens.state === 'known' ? { used: usage.contextTokens.value } : {}),
      // 分母缺就是缺。`?? 0` 会在环上画一个我们没量过的百分比
      //（`agentPanelV4Types.ContextUsage` 的注释已经把这条钉死，这里只是遵守它）。
      ...(usage.contextWindow === undefined ? {} : { max: usage.contextWindow }),
      input: labels.formatTokens(usage.inputTokens),
      output: labels.formatTokens(usage.outputTokens),
      // 缓存命中那一列。它不是装饰：前缀合同（工具定义顺序 + 系统提示词）一旦被自己抖坏，
      // 症状就是这个数塌到 0 而 `input` 猛涨——不单独印出来就只能等账单来告诉我们。
      // 写入那一列留在契约里不上屏：一条 lane 的第一轮几乎全是写入，印出来只会误导。
      cache: labels.formatTokens(usage.cacheReadTokens),
      // 推理：模型不会思考就整行不渲染（`not-applicable`）；会思考但供应商没报，
      // 印占位符——那一行存在，只是这一轮没数。
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(cost === undefined ? {} : { cost }),
    },
  }
}
