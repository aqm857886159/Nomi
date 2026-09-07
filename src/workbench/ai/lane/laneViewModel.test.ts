// 视图投影：一份有序段 → v4 的 8 个积木。**组件一行不改**，它们只是终于按发生顺序出现。
//
// 这一族测试守的是三条「不做什么」——不排序、不 join 第二真相、不缓存正文。
// 「不做什么」很难用正面断言证，所以每条都配一个会暴露它的场景。
import { describe, expect, it } from 'vitest'

import type { LanePart, LaneProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { LANE_APPROVAL_NOTE_TYPE } from '../../../../electron/shared/agentLane/laneContracts'
import { laneViewModel, type LaneViewModelLabels } from './laneViewModel'

const labels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
}

let next = 0
const part = (input: Omit<LanePart, 'sequence' | 'entrySeq' | 'contentIndex'> & Partial<LanePart>): LanePart =>
  ({ sequence: next++, entrySeq: next, contentIndex: 0, ...input }) as LanePart

function projection(parts: LanePart[], overrides: Partial<LaneProjection> = {}): LaneProjection {
  return {
    lane: 'main', parts, running: false,
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
    ...overrides,
  }
}

describe('laneViewModel', () => {
  it('emits one flow item per part, in the order the transcript recorded', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'user', text: 'Append a closing line.' }),
      part({ kind: 'thinking', text: 'The document ends abruptly.', streaming: false }),
      part({ kind: 'assistant-text', text: 'Reading it first.', streaming: false }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'read_full_text', text: 'The opening scene.', isError: false }),
      part({ kind: 'assistant-text', text: 'Done.', streaming: false }),
    ]), labels)

    expect(model.items.map((item) => item.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'assistant'])
    // 工具结果**并回它自己那一行**，不新开一行——收据是一行，不是两行（v4 定稿）。
    const tool = model.items[3]
    expect(tool.kind === 'tool' && tool.receipt.status).toBe('output-available')
    expect(tool.kind === 'tool' && tool.receipt.output).toBe('The opening scene.')
  })

  it('refuses a projection whose parts are out of order instead of quietly sorting them', () => {
    // 悄悄排序是今天那把假尺子（`sortedItems()`）的做法。面板上「先做了、后说要做」
    // 在截图里非常像「模型自己顺序乱」，所以这里必须**炸**，不许自己修好。
    const bad = projection([
      { sequence: 1, entrySeq: 1, contentIndex: 0, kind: 'user', text: 'second' },
      { sequence: 0, entrySeq: 0, contentIndex: 0, kind: 'user', text: 'first' },
    ])
    expect(() => laneViewModel(bad, labels)).toThrow(/out of order/)
  })

  it('marks a running tool as running, without a second registry to ask', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: { content: 'x' }, running: true }),
    ], { running: true }), labels)
    const tool = model.items[0]
    expect(tool.kind === 'tool' && tool.receipt.status).toBe('input-available')
    expect(model.running).toBe(true)
    // 今天这件事要靠 `agentPanelV4PendingTools` 那张易失登记表，冷重启就空。
    // 这里它来自投影本身，所以重启后依然对。
  })

  it('separates a policy denial from a broken tool — they are two different sentences', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'host-note', noteType: LANE_APPROVAL_NOTE_TYPE,
        data: { toolCallId: 'c1', toolName: 'append_to_end', decision: 'denied', reason: 'The document is locked.' } }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: { content: 'x' }, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'append_to_end', text: 'The document is locked.', isError: true }),
      part({ kind: 'tool-call', toolCallId: 'c2', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c2', toolName: 'read_full_text', text: 'boom', isError: true }),
    ]), labels)

    // 「点了不要」显示成「已确认」是真机上出过的 bug（G6 判据④）。denied 与 error
    // 折进同一态，用户就分不出「我拒绝了」和「它坏了」。
    const denied = model.items[0]
    const broken = model.items[1]
    expect(denied.kind === 'tool' && denied.receipt.status).toBe('output-denied')
    expect(broken.kind === 'tool' && broken.receipt.status).toBe('output-error')
  })

  it('does not turn a host note into a second bubble saying the same thing twice', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'host-note', noteType: LANE_APPROVAL_NOTE_TYPE,
        data: { toolCallId: 'c1', toolName: 'append_to_end', decision: 'denied', reason: 'Locked.' } }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'append_to_end', text: 'Locked.', isError: true }),
    ]), labels)
    expect(model.items).toHaveLength(1)
    expect(JSON.stringify(model.items).split('Locked.').length - 1).toBe(2) // trailing + output，不是三处
  })

  it('never invents a bubble for a result whose call it cannot see', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-result', toolCallId: 'orphan', toolName: 'read_full_text', text: 'x', isError: false }),
    ]), labels)
    // 一条没有起因的结果会让用户以为漏看了什么。安静地多画一行只会把上游的 bug 藏起来。
    expect(model.items).toEqual([])
  })

  it('leaves cost and context ceiling absent when nobody measured them', () => {
    next = 0
    const withoutCost = laneViewModel(projection([]), labels)
    expect(withoutCost.usage.cost).toBeUndefined()
    expect(withoutCost.usage.max).toBeUndefined()
    expect(withoutCost.usage.input).toBe('120t')

    next = 0
    const withCost = laneViewModel(projection([], {
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160, costUsd: 0.0123 },
    }), labels)
    expect(withCost.usage.cost).toBe('$0.0123')
  })

  it('maps a known capability alias to its icon family, and refuses to guess for an unknown one', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-call', toolCallId: 'c2', toolName: 'not_a_registered_alias', args: {}, running: false }),
    ]), labels)
    expect(model.items[0].kind === 'tool' && model.items[0].receipt.action).toBe('document')
    // 猜一个具体 icon 会在收据上印一个我们没量过的断言。
    expect(model.items[1].kind === 'tool' && model.items[1].receipt.action).toBe('write')
  })

  it('takes every visible word from the caller, so no UI string is born in this layer', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'thinking', text: 'hm', streaming: true }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
    ]), labels)
    expect(model.items[0].kind === 'thinking' && model.items[0].label).toBe('[thinking]')
    expect(model.items[1].kind === 'tool' && model.items[1].receipt.label).toBe('[read_full_text]')
  })

  it('reports a streaming assistant part as streaming, so the cursor is real and not a timer', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'assistant-text', text: 'Half a sen', streaming: true }),
    ], { running: true }), labels)
    expect(model.items[0].kind === 'assistant' && model.items[0].status).toBe('streaming')
  })
})
