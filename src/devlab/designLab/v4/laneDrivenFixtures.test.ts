// 探针 P6 的结构那一半：把三份 `LaneSnapshot`（空态 / 单工具 / 审批被拒）过两层真投影，
// 钉住「今天的投影离拍板过的收据差什么」。像素那一半在设计实验室（`01-vocabulary.tsx` 的
// `LaneReceiptCell`）；这里钉的是接不上去的那一格**为什么**接不上——缺口清单一变就红。
import { describe, expect, it } from 'vitest'

import { projectLaneSnapshot } from '../../../../electron/shared/agentLane/laneProjection'
import { laneViewModel, type LaneViewModelLabels } from '../../../workbench/ai/lane/laneViewModel'
import {
  laneDrivenReceipt,
  laneSnapshotToolDenied,
  laneSnapshotToolDone,
  laneSnapshotToolRunning,
  LAB_MODEL_FACTS,
} from './laneDrivenFixtures'

const labels: LaneViewModelLabels = {
  toolLabel: () => '读取时间轴',
  toolSummary: () => undefined,
  toolFailure: () => undefined,
  thinkingLabel: '正在想…',
  formatTokens: (value) => String(value),
  formatCost: (usd) => `$${usd.toFixed(2)}`,
  retryLabel: (attempt, maxAttempts) => `[retry ${attempt}/${maxAttempts}]`,
  unknown: '—',
  free: '免费',
  taskTitle: '生成任务',
  formatStages: (done, total) => `${done} / ${total} 阶段`,
  formatMoney: (currency, amount) => `${currency} ${amount.toFixed(2)}`,
  taskUnknown: '任务详情在任务中心',
  skillLabel: (key) => `[skill:${key}]`,
}

describe('design-lab fixtures driven by a LaneSnapshot (probe P6)', () => {
  it('empty: an empty transcript projects to no items, not running, and no invented ceiling/cost', () => {
    const empty = { ...laneSnapshotToolRunning(), transcript: [], tipId: null, operation: null }
    const model = laneViewModel(projectLaneSnapshot(empty, LAB_MODEL_FACTS), labels)
    expect(model.items).toEqual([])
    expect(model.running).toBe(false)
    expect(model.usage.max).toBeUndefined()
    // 3b 三态：没登记价目的模型 → 花费「不可知」→ 渲染占位符，不是 0、也不是整行消失（那会像「这项不存在」）。
    expect(model.usage.cost).toBe(labels.unknown)
    // `AgentPanelV4Panel` renders `V4EmptyState` on `flow.length === 0`; the surface-derived
    // starter chips are the shell's, so the pixel half of this cell waits for a lane-driven shell (stage 4).
  })

  it('single tool, in flight: matches the approved input-streaming cell field for field', () => {
    const receipt = laneDrivenReceipt(laneSnapshotToolRunning(), labels)
    expect(receipt).toEqual({ toolCallId: 'call-timeline-1', label: '读取时间轴', action: 'timeline', status: 'input-available', input: undefined })
  })

  it('approval denied: only the status word, no trailing reason, no expandable body', () => {
    const receipt = laneDrivenReceipt(laneSnapshotToolDenied('这次先不删'), labels)
    expect(receipt.status).toBe('output-denied')
    expect(receipt.trailing).toBeUndefined()
    expect(receipt.output).toBeUndefined()
    expect(receipt.summary).toBeUndefined()
  })

  it('single tool, done: pins the two fields the projection cannot derive yet (why that cell stays hand-written)', () => {
    const receipt = laneDrivenReceipt(laneSnapshotToolDone(), labels)
    expect(receipt.status).toBe('output-available')
    expect(receipt.output).toBe('clips: 3 · duration: 9.0s · selected: clip-2 (0:03–0:06)')
    // 拍板的格子有「3 段 · 9.0s」（按能力渲染的摘要）与「0.4s」（调用→结果的时间戳差）。
    // 前者要一个按能力的摘要渲染点，后者要 `LanePart` 带时间戳过桥——两者都还没有。
    expect(receipt.summary).toBeUndefined()
    expect(receipt.trailing).toBeUndefined()
  })
})
