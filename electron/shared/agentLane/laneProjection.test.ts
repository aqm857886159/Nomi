import { describe, expect, it } from 'vitest'
import type { LaneSnapshot } from '@earendil-works/pi-agent-core'
import { isRetryableAssistantError } from '@earendil-works/pi-ai'
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
      kind: 'error', text: 'Connection closed before a response.', entryId: 'failed', sequence: 0, entrySeq: 1, contentIndex: 0,
    }])
    expect(projection.running).toBe(false)
  })
})

describe('lane provider failure: transient / recovered', () => {
  const facts = { pricing: 'unpriced' as const, supportedThinkingLevels: ['off' as const], isTransientError: isRetryableAssistantError }
  type Entry = LaneSnapshot['transcript'][number]
  const assistant = (id: string, seq: number, extra: Record<string, unknown>): Entry => ({ id, parentId: null, seq, timestamp: seq, type: 'message' as const, message: {
    role: 'assistant' as const, content: [], api: 'openai-completions', provider: 'fixture', model: 'fixture', usage, timestamp: seq, ...extra } } as unknown as Entry)
  const user = (id: string, seq: number): Entry => ({ id, parentId: null, seq, timestamp: seq, type: 'message' as const, message: { role: 'user' as const, content: 'hi', timestamp: seq } } as Entry)
  const lane = (transcript: LaneSnapshot['transcript']): LaneSnapshot => ({
    lane: 'main', tipId: 'tip', operation: null, queues: [], faulted: false,
    configuration: { model: { provider: 'fixture', modelId: 'fixture' }, thinkingLevel: 'off', activeToolNames: [] },
    stats: { messageCount: transcript.length, usage }, transcript })
  const errors = (transcript: LaneSnapshot['transcript']) => projectLaneSnapshot(lane(transcript), facts).parts.filter((part) => part.kind === 'error')

  it('marks a dropped connection transient via pi, and a plain failure not', () => {
    const [connection] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' })])
    expect(connection).toMatchObject({ kind: 'error', transient: true })
    const [plain] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Invalid schema for tool x' })])
    expect(plain).not.toHaveProperty('transient')
  })

  it('an error followed by a settled assistant reply in the same turn is recovered', () => {
    const [failure] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' }),
      assistant('ok', 3, { stopReason: 'stop', content: [{ type: 'text', text: 'done' }] })])
    expect(failure).toMatchObject({ kind: 'error', recovered: true })
  })

  it('two errors in a row followed by success: both are recovered', () => {
    const found = errors([user('u', 1), assistant('e1', 2, { stopReason: 'error', errorMessage: 'Connection error.' }),
      assistant('e2', 3, { stopReason: 'error', errorMessage: 'Request timed out.' }), assistant('ok', 4, { stopReason: 'stop' })])
    expect(found).toHaveLength(2)
    for (const failure of found) expect(failure).toMatchObject({ recovered: true })
  })

  it('an error with nothing after it stays an error, and a reply in the NEXT turn does not heal it', () => {
    const [last] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' })])
    expect(last).not.toHaveProperty('recovered')
    const [old] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' }),
      user('u2', 3), assistant('ok', 4, { stopReason: 'stop' })])
    expect(old).not.toHaveProperty('recovered')
  })

  it('a user stop (aborted) after the error is not a recovery', () => {
    const [failure] = errors([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' }),
      assistant('stopped', 3, { stopReason: 'aborted' })])
    expect(failure).not.toHaveProperty('recovered')
  })

  it('a streaming retry in flight counts as recovered', () => {
    const snapshot = lane([user('u', 1), assistant('e', 2, { stopReason: 'error', errorMessage: 'Connection error.' })])
    const streaming = { ...snapshot, operation: { status: 'open', runningTools: [], streamingMessage: (assistant('s', 3, { stopReason: 'stop' }) as { message: unknown }).message } } as unknown as LaneSnapshot
    const [failure] = projectLaneSnapshot(streaming, facts).parts.filter((part) => part.kind === 'error')
    expect(failure).toMatchObject({ recovered: true })
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

  it('keeps queued targets out of the active transcript projection', () => {
    const storyboardTarget = { projectId: 'p', sourceDocumentId: 'a', sourceDocumentRevision: 3,
      sourceDocumentContentHash: 'h', targetKind: 'storyboard', requestId: 'request-a', plans: [] }
    const lane = laneWith([input(1, 'A', { storyboardTarget })])
    lane.queues = [{ entryId: 'queued-b', kind: 'followUp', message: { role: 'nomi.input', content: 'B', timestamp: 2,
      context: { approvalPolicy: { mode: 'step', spend: 'confirm' }, storyboardTarget: { ...storyboardTarget, sourceDocumentId: 'b' } } } }] as unknown as LaneSnapshot['queues']
    const projection = projectLaneSnapshot(lane, { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts).toHaveLength(1)
    expect(projection.parts[0]).toMatchObject({ kind: 'user', storyboardTarget })
    expect(projection.queues[0].intent?.storyboardTarget?.sourceDocumentId).toBe('b')
  })

  it('carries the skill recorded on that very message, and nothing when it had none', () => {
    const projection = projectLaneSnapshot(laneWith([
      input(1, '拆分镜。', { approvalPolicy: { mode: 'step', spend: 'confirm' }, skillKey: 'workbench.storyboard.planner' }),
      input(2, '再来一句。', { approvalPolicy: { mode: 'step', spend: 'confirm' } }),
    ]), { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts.map((part) => part.kind === 'user' ? part.skillKey : 'not-user'))
      .toEqual(['workbench.storyboard.planner', undefined])
  })
})

describe('lane user attachments', () => {
  const laneWith = (messages: LaneSnapshot['transcript']): LaneSnapshot => ({
    lane: 'main', tipId: 'tip', operation: null, queues: [], faulted: false,
    configuration: { model: { provider: 'fixture', modelId: 'fixture' }, thinkingLevel: 'off', activeToolNames: [] },
    stats: { messageCount: messages.length, usage }, transcript: messages,
  })
  const input = (seq: number, content: string, context: Record<string, unknown>): LaneSnapshot['transcript'][number] => ({
    id: `e${seq}`, parentId: null, seq, timestamp: seq, type: 'message',
    message: { role: 'nomi.input', content, timestamp: seq, context },
  } as unknown as LaneSnapshot['transcript'][number])
  const policy = { mode: 'step', spend: 'confirm' }
  const facts = { pricing: 'unpriced' as const, supportedThinkingLevels: ['off' as const] }
  const display = { url: 'nomi-local://a', fileName: '剧本.txt', contentType: 'text/plain', sizeBytes: 12, kind: 'file' as const }

  it('an attached file stays on the user segment that carried it — and only that one', () => {
    const projection = projectLaneSnapshot(laneWith([
      input(1, '总结这个文件', { approvalPolicy: policy, attachments: [{ assetId: 'asset-1', version: 1 }] }),
      input(2, '再来一句', { approvalPolicy: policy }),
    ]), facts, undefined, undefined, undefined, undefined,
    (claims) => claims.map(claim => ({ ...claim, display })))
    const users = projection.parts.filter(part => part.kind === 'user')
    expect(users.map(part => part.kind === 'user' ? part.attachments : 'x')).toEqual([[{ assetId: 'asset-1', version: 1, display }], undefined])
  })

  it('a claim the host cannot resolve is still shown as attached (no silent disappearance)', () => {
    const projection = projectLaneSnapshot(laneWith([input(1, 'x', { approvalPolicy: policy, attachments: [{ assetId: 'gone', version: 2 }] })]), facts)
    expect(projection.parts[0]).toMatchObject({ kind: 'user', attachments: [{ assetId: 'gone', version: 2 }] })
    expect((projection.parts[0] as unknown as { attachments: Array<{ display?: unknown }> }).attachments[0].display).toBeUndefined()
  })
})

describe('lane stop visibility', () => {
  /**
   * 用户点「停止」时模型还一个字都没吐出来是**常态**（真实会话 2026-09-12 的 5 次停止全是这个形状：
   * `stopReason:'aborted'` + `content: []`）。从前 `pushAssistantParts` 只按 `content` 逐项发段，
   * 空内容就一段都没有——面板上停止**不留任何痕迹**，用户只能判断成「没停下来」。
   * 停止的回执不是正文的一个属性，是这一回合本身的终局。
   */
  function abortedLane(content: unknown[]): LaneSnapshot {
    return {
      lane: 'main', tipId: 'stopped', operation: null, queues: [], faulted: false,
      configuration: { model: { provider: 'fixture', modelId: 'fixture' }, thinkingLevel: 'off', activeToolNames: [] },
      stats: { messageCount: 1, usage },
      transcript: [{ id: 'stopped', parentId: null, seq: 1, timestamp: 1, type: 'message', message: {
        role: 'assistant', content, api: 'openai-completions', provider: 'fixture', model: 'fixture',
        usage, stopReason: 'aborted', timestamp: 1,
      } }],
    } as unknown as LaneSnapshot
  }

  it('leaves an interrupted receipt when the stopped turn produced no text at all', () => {
    const projection = projectLaneSnapshot(abortedLane([]), { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts).toEqual([{
      kind: 'assistant-text', text: '', interrupted: true, streaming: false,
      sequence: 0, entryId: 'stopped', entrySeq: 1, contentIndex: 0,
    }])
  })

  it('carries no continuation entry for an empty stop, because there is nothing to continue from', () => {
    const projection = projectLaneSnapshot(abortedLane([]), { pricing: 'unpriced', supportedThinkingLevels: ['off'] })
    expect(projection.parts.every((part) => !('continuationEntryId' in part))).toBe(true)
  })

  it('still leaves one interrupted receipt when the stop happened after a tool call and before any prose', () => {
    const projection = projectLaneSnapshot(
      abortedLane([{ type: 'toolCall', id: 'call-1', name: 'look_at_canvas', arguments: {} }]),
      { pricing: 'unpriced', supportedThinkingLevels: ['off'] },
    )
    expect(projection.parts.map((part) => part.kind)).toEqual(['tool-call', 'assistant-text'])
    expect(projection.parts.at(-1)).toMatchObject({ kind: 'assistant-text', text: '', interrupted: true })
  })

  it('does not add a second receipt when the stopped turn already streamed prose', () => {
    const projection = projectLaneSnapshot(
      abortedLane([{ type: 'text', text: '开场先留一秒环境声。' }]),
      { pricing: 'unpriced', supportedThinkingLevels: ['off'] },
    )
    expect(projection.parts.filter((part) => part.kind === 'assistant-text')).toHaveLength(1)
    expect(projection.parts[0]).toMatchObject({ interrupted: true, continuationEntryId: 'stopped' })
  })
})
