// NF-0928-0003 类边界：判据从动词声明派生——只有读动词、只有成功的、只有同一资源（语义入参归一后相同）才互相取代。
import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { LANE_MODEL_TOOL_CATALOG } from './laneToolCatalog'
import { omitSupersededReads, supersededReadNote } from './laneSupersededReads.mjs'

const call = (id: string, name: string, args: unknown) => ({ role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }],
  api: 'openai-completions', provider: 'f', model: 'f', stopReason: 'toolUse', timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) as unknown as AgentMessage
const result = (id: string, name: string, text: string, isError = false) =>
  ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 0 }) as AgentMessage
const texts = (messages: AgentMessage[]) => messages.flatMap((message) => message.role === 'toolResult'
  ? [(message.content[0] as { text: string }).text] : [])

describe('omitSupersededReads', () => {
  it('a later read of the same resource replaces the earlier copy; {} and {scope:"full"} are the same resource', () => {
    const out = omitSupersededReads([call('a', 'read_script', {}), result('a', 'read_script', 'OLD'),
      call('b', 'read_script', { scope: 'full' }), result('b', 'read_script', 'NEW')], LANE_MODEL_TOOL_CATALOG)
    expect(texts(out)).toEqual([supersededReadNote('read_script', 'b'), 'NEW'])
  })

  it('a different resource, a failed later read, a failed earlier read and a write are all kept as they are', () => {
    const input = [
      call('a', 'read_script', {}), result('a', 'read_script', 'FULL'),
      call('b', 'read_script', { scope: 'selection' }), result('b', 'read_script', 'SELECTION'),
      call('c', 'read_script', {}), result('c', 'read_script', 'refused', true),
      call('d', 'write_script', { where: 'append', content: 'x' }), result('d', 'write_script', 'WRITTEN'),
      call('e', 'write_script', { where: 'append', content: 'y' }), result('e', 'write_script', 'WRITTEN AGAIN'),
    ]
    expect(texts(omitSupersededReads(input, LANE_MODEL_TOOL_CATALOG))).toEqual(['FULL', 'SELECTION', 'refused', 'WRITTEN', 'WRITTEN AGAIN'])
  })

  it('every read verb in the catalog takes part, and no write verb does (derived, not a hand list)', () => {
    for (const spec of LANE_MODEL_TOOL_CATALOG) {
      const out = omitSupersededReads([call('a', spec.name, {}), result('a', spec.name, 'OLD'), call('b', spec.name, {}), result('b', spec.name, 'NEW')], [spec])
      expect(texts(out)[0], spec.name).toBe(spec.effect === 'read' ? supersededReadNote(spec.name, 'b') : 'OLD')
    }
  })
})
