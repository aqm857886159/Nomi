// NF-0928-0003 类边界：判据从动词声明派生——只有读动词、只有成功的、只有同一资源（语义入参归一后相同）才通过 SessionManager 原生 appendContextEdit 互相取代。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ModelFacingToolSpec } from '../shared/agentCapabilities/modelFacingTools'
import { LANE_MODEL_TOOL_CATALOG } from './laneToolCatalog'
import { recordSupersededReadEdits, supersededReadNote } from './laneContextBudget.mjs'
import { openLaneSession } from './laneSession.mjs'

const call = (id: string, name: string, args: unknown) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: args }],
  api: 'openai-completions',
  provider: 'f',
  model: 'f',
  stopReason: 'toolUse',
  timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
}) as unknown as AgentMessage

const result = (id: string, name: string, text: string, isError = false) =>
  ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 0 }) as AgentMessage

const texts = (messages: readonly AgentMessage[]) => messages.flatMap((message) => message.role === 'toolResult'
  ? [(message.content[0] as { text: string }).text]
  : [])

async function projectAfterRecording(messages: readonly AgentMessage[], specs: readonly ModelFacingToolSpec[]) {
  const projectDir = await mkdtemp(join(tmpdir(), 'nomi-superseded-'))
  const handle = await openLaneSession({ projectDir })
  try {
    const { session } = handle
    for (const message of messages) {
      const id = await session.appendMessage(message)
      if (message.role === 'toolResult') {
        await recordSupersededReadEdits(session, specs, id)
      }
    }
    return {
      projected: session.buildSessionContext().messages,
      rawBranch: session.branchEntries().flatMap((entry) => entry.type === 'message' ? [entry.message] : []),
    }
  } finally {
    await handle.release()
    await rm(projectDir, { recursive: true, force: true })
  }
}

describe('recordSupersededReadEdits via SessionManager.appendContextEdit', () => {
  it('a later read of the same resource replaces the earlier copy in SessionManager projection while preserving raw transcript; {} and {scope:"full"} are the same resource', async () => {
    const { projected, rawBranch } = await projectAfterRecording([
      call('a', 'read_script', {}),
      result('a', 'read_script', 'OLD'),
      call('b', 'read_script', { scope: 'full' }),
      result('b', 'read_script', 'NEW'),
    ], LANE_MODEL_TOOL_CATALOG)
    expect(texts(projected)).toEqual([supersededReadNote('read_script', 'b'), 'NEW'])
    expect(texts(rawBranch)).toEqual(['OLD', 'NEW'])
  })

  it('a different resource, a failed later read, a failed earlier read and a write are all kept as they are', async () => {
    const input = [
      call('a', 'read_script', {}), result('a', 'read_script', 'FULL'),
      call('b', 'read_script', { scope: 'selection' }), result('b', 'read_script', 'SELECTION'),
      call('c', 'read_script', {}), result('c', 'read_script', 'refused', true),
      call('d', 'write_script', { where: 'append', content: 'x' }), result('d', 'write_script', 'WRITTEN'),
      call('e', 'write_script', { where: 'append', content: 'y' }), result('e', 'write_script', 'WRITTEN AGAIN'),
    ]
    const { projected } = await projectAfterRecording(input, LANE_MODEL_TOOL_CATALOG)
    expect(texts(projected)).toEqual(['FULL', 'SELECTION', 'refused', 'WRITTEN', 'WRITTEN AGAIN'])
  })

  it('every read verb in the catalog takes part, and no write verb does (derived, not a hand list)', async () => {
    for (const spec of LANE_MODEL_TOOL_CATALOG) {
      const { projected } = await projectAfterRecording([
        call('a', spec.name, {}),
        result('a', spec.name, 'OLD'),
        call('b', spec.name, {}),
        result('b', spec.name, 'NEW'),
      ], [spec])
      expect(texts(projected)[0], spec.name).toBe(spec.effect === 'read' ? supersededReadNote(spec.name, 'b') : 'OLD')
    }
  })
})
