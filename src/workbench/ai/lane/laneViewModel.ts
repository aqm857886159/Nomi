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
  LanePart,
  LaneProjection,
} from '../../../../electron/shared/agentLane/laneContracts'
import {
  LANE_APPROVAL_NOTE_TYPE,
  isLaneApprovalNote,
} from '../../../../electron/shared/agentLane/laneContracts'
import { resolveCapabilityAlias } from '../../../../electron/shared/agentCapabilities/registry'
import { actionFamilyForCapability } from '../v4/agentPanelV4ActionFamily'
import type {
  ContextUsage,
  ToolReceipt,
  V4ActionFamily,
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
  toolLabel(toolName: string): string
  /** 思考行左侧那个词。 */
  thinkingLabel: string
  /** 数字格式化：token 数、金额。缺省不印，不是印 0。 */
  formatTokens(value: number): string
  formatCost(usd: number): string
}

export interface LaneViewModel {
  items: readonly V4FlowItem[]
  usage: ContextUsage
  running: boolean
}

/** 一次工具调用在流里的落点，用来把结果并回它的那一行（按 id join，不复制正文）。 */
interface ToolSlot {
  index: number
  toolName: string
  args: unknown
}

function familyFor(toolName: string, args: unknown): V4ActionFamily {
  const resolved = resolveCapabilityAlias(toolName)
  // 认不出来的别名走 `write`：它是「动了什么东西」里最不宣称具体对象的那个。
  // 猜一个具体 icon（比如看名字里有没有 "image"）会在收据上印一个我们没量过的断言。
  return resolved ? actionFamilyForCapability(resolved.contract.id, args) : 'write'
}

function stringifyArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined
  if (typeof args === 'string') return args || undefined
  try {
    const text = JSON.stringify(args)
    return text && text !== '{}' ? text : undefined
  } catch {
    return undefined
  }
}

function receiptFor(part: Extract<LanePart, { kind: 'tool-call' }>, labels: LaneViewModelLabels): ToolReceipt {
  return {
    label: labels.toolLabel(part.toolName),
    action: familyFor(part.toolName, part.args),
    // 「跑着呢」和「填参数呢」是两件事：`input-available` 说的是参数已经齐了。
    // 结果落定之前不许写 `output-available`——那是在替一件还没发生的事下结论。
    status: part.running ? 'input-available' : 'input-streaming',
    input: stringifyArgs(part.args),
  }
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
export function laneViewModel(projection: LaneProjection, labels: LaneViewModelLabels): LaneViewModel {
  const items: V4FlowItem[] = []
  const slots = new Map<string, ToolSlot>()
  const denials = new Map<string, LaneApprovalNote>()

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
      if (part.noteType === LANE_APPROVAL_NOTE_TYPE && isLaneApprovalNote(part.data) && part.data.decision === 'denied') {
        denials.set(part.data.toolCallId, part.data)
      }
      continue
    }
    if (part.kind === 'user') {
      items.push({ kind: 'user', text: part.text })
      continue
    }
    if (part.kind === 'assistant-text') {
      items.push({ kind: 'assistant', text: part.text, status: part.streaming ? 'streaming' : 'complete' })
      continue
    }
    if (part.kind === 'thinking') {
      items.push({ kind: 'thinking', label: labels.thinkingLabel, meta: part.text })
      continue
    }
    if (part.kind === 'tool-call') {
      slots.set(part.toolCallId, { index: items.length, toolName: part.toolName, args: part.args })
      items.push({ kind: 'tool', receipt: receiptFor(part, labels) })
      continue
    }
    // tool-result：并回**它自己那一行**。找不到对应的调用不新开一行——那会让用户看到一条
    // 没有起因的结果；找不到本身是上游 bug，安静地多画一行只会把它藏起来。
    const slot = slots.get(part.toolCallId)
    if (!slot) continue
    const denial = denials.get(part.toolCallId)
    const existing = items[slot.index]
    if (existing.kind !== 'tool') continue
    items[slot.index] = {
      kind: 'tool',
      receipt: {
        ...existing.receipt,
        status: settledStatus(part.isError, denial !== undefined),
        output: part.text || undefined,
        ...(denial?.reason ? { trailing: denial.reason } : {}),
      },
    }
  }

  return {
    items,
    running: projection.running,
    usage: {
      used: projection.usage.totalTokens,
      input: labels.formatTokens(projection.usage.inputTokens),
      output: labels.formatTokens(projection.usage.outputTokens),
      // `max` / `cost` 缺就是缺。`?? 0` 会在环上画一个我们没量过的百分比，
      // 在花费那一行印一个我们没资格下的 ¥0.00（`agentPanelV4Types.ContextUsage` 的注释
      // 已经把这条钉死，这里只是遵守它）。
      ...(projection.usage.costUsd === undefined ? {} : { cost: labels.formatCost(projection.usage.costUsd) }),
    },
  }
}
