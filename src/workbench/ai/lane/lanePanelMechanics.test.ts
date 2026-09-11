import { describe, expect, it } from 'vitest'
import type { LaneMetric, LaneMetricUnknownReason, LanePart, LaneProjection, LaneUsage } from '../../../../electron/shared/agentLane/laneContracts'
import { laneInterventionSource, laneViewModel, type LaneViewModelLabels } from './laneViewModel'
import { projectV4Intervention, type V4InterventionLabels } from '../v4/agentPanelV4Intervention'
import { formatV4Tokens } from '../v4/agentPanelV4UsageFormat'

const labels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  toolSummary: () => undefined,
  toolFailure: () => undefined,
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
  retryLabel: (attempt, maxAttempts) => `[retry ${attempt}/${maxAttempts}]`,
  // 这两句在生产里是 i18n 的 `contextUnknown` / `contextCostFree`。测试里写成醒目的假串，
  // 是为了让「本层自己编了一个字」当场露馅——占位符长什么样是调用方的事，不是这一层的。
  unknown: '[unknown]',
  free: '[free]',
  taskTitle: '[task]',
  formatStages: (done, total) => `${done}/${total} stages`,
  formatMoney: (currency, amount) => `${currency} ${amount.toFixed(2)}`,
  taskUnknown: '[task-unknown]',
  skillLabel: (key) => `[skill:${key}]`,
}

/** 三态的常用取值。写成构件是因为下面几乎每条都要摆一次。 */
const UNKNOWN = (reason: LaneMetricUnknownReason): LaneMetric => ({ state: 'unknown', reason })
const KNOWN = (value: number): LaneMetric => ({ state: 'known', value })

/** 一份「什么都还没量到」的用量：三行全是 `unknown`，token 那几列是真实累计。 */
const usageOf = (overrides: Partial<LaneUsage> = {}): LaneUsage => ({
  inputTokens: 120, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 160,
  cost: UNKNOWN('no-settled-turn'),
  contextTokens: UNKNOWN('no-settled-turn'),
  reasoningTokens: UNKNOWN('no-settled-turn'),
  ...overrides,
})

const THINKING: LaneProjection['thinking'] = { supportedLevels: ['off'], level: 'off', canTurnOff: true }

let next = 0
const part = (input: Omit<LanePart, 'sequence' | 'entrySeq' | 'contentIndex'> & Partial<LanePart>): LanePart =>
  ({ sequence: next++, entrySeq: next, contentIndex: 0, ...input }) as LanePart

function projection(parts: LanePart[], overrides: Partial<LaneProjection> = {}): LaneProjection {
  return { lane: 'main', parts, running: false, usage: usageOf(), thinking: THINKING, queues: [], ...overrides }
}


describe('lane panel mechanics migrated from the retired V4 projection', () => {
  it('formats cumulative and reasoning tokens on the shared compact scale', () => {
    const model = laneViewModel(projection([], { usage: usageOf({ inputTokens: 4000, outputTokens: 1_200_000,
      reasoningTokens: KNOWN(500) }) }), { ...labels, formatTokens: formatV4Tokens })
    expect(model.usage).toMatchObject({ input: '4K', output: '1.2M', reasoning: '500' })
  })

  it.each(['nomi_document_read', 'unknown_tool'])('never advertises undo for unsupported %s even with a receipt id', (toolName) => {
    const model = laneViewModel(projection([
      part({ kind: 'tool-call', toolCallId: 'one', toolName, args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'one', toolName, text: 'Done', isError: false }),
    ]), labels, 'one')
    expect(model.items[0]).toMatchObject({ kind: 'tool', receipt: { status: 'output-available' } })
    expect(JSON.stringify(model.items)).not.toContain('undoable')
  })

  it.each(['shots', 'nodes'])('projects %s from lane pending approval into semantic titles and visible parameters', (field) => {
    const args = { operation: 'create_canvas_nodes', [field]: [{ kind: 'video', prompt: '小禾走到河边旧街。她举起相机。',
      modelKey: 'MiniMax-H3', params: { resolution: '768P', duration: 8, aspect_ratio: '16:9' } }] }
    const source = laneInterventionSource({ toolName: 'nomi_canvas_write', args, effectClass: 'reversible_local', pendingCount: 1 } as Parameters<typeof laneInterventionSource>[0])
    const slot = projectV4Intervention(source, { planTitle: '计划' } as V4InterventionLabels, key => key)
    expect(slot?.plan?.[0]).toEqual({ label: '小禾走到河边旧街', detail: 'MiniMax-H3 · 768P · 8s · 16:9', checked: true })
  })
})
