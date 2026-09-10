import { describe, expect, it } from 'vitest'
import type { LaneSnapshot } from '@earendil-works/pi-agent-core'
import { projectLaneSnapshot } from './laneProjection'

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

describe('lane provider failure visibility', () => {
  it('retains a settled provider error even when the assistant produced no content', () => {
    const snapshot: LaneSnapshot = {
      lane: 'main', tipId: 'failed', operation: null, queues: [], faulted: false,
      configuration: { model: { provider: 'fixture', modelId: 'fixture' }, thinkingLevel: 'off', activeToolNames: [] },
      stats: { messageCount: 1, usage },
      transcript: [{ id: 'failed', parentId: null, seq: 1, timestamp: 1, type: 'message', message: {
        role: 'assistant', content: [], api: 'openai-completions', provider: 'fixture', model: 'fixture',
        usage, stopReason: 'error', errorMessage: 'Connection closed before a response.', timestamp: 1,
      } }],
    }
    const projection = projectLaneSnapshot(snapshot, { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts).toEqual([{
      kind: 'error', text: 'Connection closed before a response.', sequence: 0, entrySeq: 1, contentIndex: 0,
    }])
    expect(projection.running).toBe(false)
  })
})

describe('lane skill provenance', () => {
  /**
   * 技能是「这一轮按哪套方法做」的唯一开关，而它**已经**随消息落盘
   * （`LaneInputMessage.context.skillKey`，pi 的自定义消息扩展）。这条钉的是「投影不许把它丢掉」：
   * 丢掉之后面板只能靠「当前选中的技能」去猜，而那会把今天选的技能追认到昨天那句话上。
   */
  function laneWith(messages: LaneSnapshot['transcript']): LaneSnapshot {
    return {
      lane: 'main', tipId: 'tip', operation: null, queues: [], faulted: false,
      configuration: { model: { provider: 'fixture', modelId: 'fixture' }, thinkingLevel: 'off', activeToolNames: [] },
      stats: { messageCount: messages.length, usage },
      transcript: messages,
    }
  }

  // pi 的自定义消息（`role: 'nomi.input'`）在 `AgentMessage` 的公开 union 里没有分支，
  // 所以这里整条 entry 一次性断言成 transcript 的元素类型——按字段去索引那个 union 取不到 `message`。
  const input = (seq: number, content: string, context: Record<string, unknown>): LaneSnapshot['transcript'][number] => ({
    id: `e${seq}`, parentId: null, seq, timestamp: seq, type: 'message',
    message: { role: 'nomi.input', content, timestamp: seq, context },
  } as unknown as LaneSnapshot['transcript'][number])

  it('carries the skill recorded on that very message, and nothing when it had none', () => {
    const projection = projectLaneSnapshot(laneWith([
      input(1, '拆分镜。', { approvalPolicy: { mode: 'step', spend: 'confirm' }, skillKey: 'workbench.storyboard.planner' }),
      input(2, '再来一句。', { approvalPolicy: { mode: 'step', spend: 'confirm' } }),
    ]), { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts.map((part) => part.kind === 'user' ? part.skillKey : 'not-user'))
      .toEqual(['workbench.storyboard.planner', undefined])
  })
})
