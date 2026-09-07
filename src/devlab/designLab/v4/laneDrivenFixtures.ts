// 设计实验室 · Agent 面板 v4 · **由 `LaneSnapshot` 驱动**的收据夹具（阶段 3 前置探针 P6）。
//
// 这一屏其余格子的收据都是手写的 `ToolReceipt`（「给积木喂 view model，看它长什么样」）。
// 那证明的是组件契约，证明不了投影：宿主快照怎么变成这些 props 那一层完全没被跑到。
// 阶段 4 切换后，快照的形状是 pi 的 `LaneSnapshot`，中间两层是
//   `projectLaneSnapshot`（主进程，纯函数）→ `laneViewModel`（渲染层，纯函数）。
// 这里把这两层**真的跑一遍**：手写的是 pi 转录里的 entry，而不是收据。
// 于是同一格的基线一旦红，红的就是「投影产出的收据 ≠ 拍板过的收据」——那是投影的错，
// 修投影，不动基线（方案 §4.3 P6）。
//
// 三个可从快照推出的态各一格：单工具进行中 / 单工具完成 / 审批被拒。
// **审批等待中（approval-requested）刻意不在这里**：停在 `before_tool` 里的调用在 pi 快照里
// 不可见（`runningTools` 为空，探针 P1 ① 实核），那一态只能由宿主内存投影，等阶段 3 的
// `LaneProjection.pending` 落地才有数据源可驱动。
import type { LaneSnapshot } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { LANE_APPROVAL_NOTE_TYPE } from '../../../../electron/shared/agentLane/laneContracts'
import { projectLaneSnapshot, type LaneModelFacts } from '../../../../electron/agentLane/laneProjection.mjs'
import { laneViewModel, type LaneViewModelLabels } from '../../../workbench/ai/lane/laneViewModel'
import type { ToolReceipt } from '../../../workbench/ai/v4/agentPanelV4Types'

/** 冻结时间戳（基线不能随钟走）。 */
const AT = 1_757_154_000_000
const TOOL = 'nomi_timeline_read'
const CALL = 'call-timeline-1'

const usage = { input: 62_400, output: 9_800, cacheRead: 2_400, cacheWrite: 0, totalTokens: 74_600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

function assistantCall(): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: CALL, name: TOOL, arguments: {} }],
    api: 'openai-completions', provider: 'nomi-lane', model: 'chosen-model',
    usage, stopReason: 'toolUse', timestamp: AT,
  }
}

type Transcript = LaneSnapshot['transcript']

function snapshot(transcript: Transcript, operation: LaneSnapshot['operation'] = null): LaneSnapshot {
  return {
    lane: 'main',
    transcript,
    tipId: transcript.at(-1)?.id ?? null,
    configuration: { model: { provider: 'nomi-lane', modelId: 'chosen-model' }, thinkingLevel: 'off', activeToolNames: [TOOL] },
    stats: { messageCount: transcript.length, usage },
    operation,
    queues: [],
    faulted: false,
  }
}

const userEntry = { id: 'e1', parentId: null, seq: 1, timestamp: AT, type: 'message' as const, message: { role: 'user' as const, content: [{ type: 'text' as const, text: '看看时间轴上现在有什么。' }], timestamp: AT } }
const callEntry = { id: 'e2', parentId: 'e1', seq: 2, timestamp: AT, type: 'message' as const, message: assistantCall() }

/** 单工具 · 进行中：调用已发布、结果未落。pi 眼里它在 `runningTools`。 */
export function laneSnapshotToolRunning(): LaneSnapshot {
  return snapshot([userEntry, callEntry], {
    id: 'op-1', kind: 'run', startedAt: AT, fromTipId: 'e1', status: 'running',
    runningTools: [{ status: 'running', toolCallId: CALL, toolName: TOOL, args: {} }],
  })
}

/** 单工具 · 完成：toolResult 落盘。 */
export function laneSnapshotToolDone(): LaneSnapshot {
  return snapshot([userEntry, callEntry, {
    id: 'e3', parentId: 'e2', seq: 3, timestamp: AT + 400, type: 'message',
    message: { role: 'toolResult', toolCallId: CALL, toolName: TOOL, content: [{ type: 'text', text: 'clips: 3 · duration: 9.0s · selected: clip-2 (0:03–0:06)' }], isError: false, timestamp: AT + 400 },
  }])
}

/** 审批被拒：宿主的审批记录骑在同一条转录上、排在被拒的调用之前（`lane-slice.test.mts` 实核的顺序）。 */
export function laneSnapshotToolDenied(reason: string): LaneSnapshot {
  return snapshot([
    userEntry,
    { id: 'n1', parentId: 'e1', seq: 2, timestamp: AT, type: 'custom', customType: LANE_APPROVAL_NOTE_TYPE, data: { toolCallId: CALL, toolName: TOOL, decision: 'denied', reason } },
    { ...callEntry, parentId: 'n1', seq: 3 },
    {
      id: 'e3', parentId: 'e2', seq: 4, timestamp: AT, type: 'message',
      message: { role: 'toolResult', toolCallId: CALL, toolName: TOOL, content: [{ type: 'text', text: reason }], isError: true, timestamp: AT },
    },
  ])
}

/** 两层投影真的跑一遍，取出那一行收据。 */
/**
 * 三行（阶段 3b）要的模型侧事实。收据格只看工具那一行，花费/上下文/推理都不进画面，
 * 所以价目给 `'unpriced'`（花费=「不可知」）、不给 contextWindow——和真实「没登记价目的模型」一个形状。
 */
export const LAB_MODEL_FACTS: LaneModelFacts = {
  model: {
    provider: 'nomi-lane', id: 'lab-model', name: 'lab-model', api: 'openai-completions', baseUrl: 'http://127.0.0.1/v1',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 0, maxTokens: 0,
  },
  pricing: 'unpriced',
}

export function laneDrivenReceipt(lane: LaneSnapshot, labels: LaneViewModelLabels): ToolReceipt {
  const model = laneViewModel(projectLaneSnapshot(lane, LAB_MODEL_FACTS), labels)
  const tool = model.items.find((item) => item.kind === 'tool')
  if (!tool || tool.kind !== 'tool') throw new Error('the lane snapshot projected no tool receipt')
  return tool.receipt
}
