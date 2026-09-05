import { afterEach, describe, expect, it, vi } from 'vitest'

const runWorkbenchAgent = vi.fn(async (..._args: unknown[]) => ({
  id: 'turn-a',
  status: 'finished' as const,
  text: 'ok',
  toolCalls: [],
  artifacts: [],
  usage: { promptTokens: 0, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 1 },
  finishReason: 'stop' as const,
}))

vi.mock('./workbenchAgentRunner', () => ({
  runWorkbenchAgent: (...args: unknown[]) => runWorkbenchAgent(...args),
}))

import { runSingleShotAgent, AGENT_LOOP_MODE } from './agentLoopMode'

afterEach(() => vi.clearAllMocks())

describe('runSingleShotAgent', () => {
  it('declares both loop modes', () => {
    expect(AGENT_LOOP_MODE).toEqual({ singleShot: 'single-shot', multiTurn: 'multi-turn' })
  })

  it('routes one zero-tool ephemeral turn through ProjectAgentHost', async () => {
    await runSingleShotAgent({
      featureKey: 'nomi:production-directions:p1',
      prompt: 'hi',
      displayPrompt: 'plan direction',
      projectId: 'p1',
      skillKey: 'workbench.production.direction-planner',
      skillName: 'direction planner',
    })
    expect(runWorkbenchAgent).toHaveBeenCalledExactlyOnceWith({
      prompt: 'hi',
      displayPrompt: 'plan direction',
      featureKey: 'nomi:production-directions:p1',
      capability: 'single-shot',
      projectId: 'p1',
      skillKey: 'workbench.production.direction-planner',
      skillName: 'direction planner',
      mode: 'chat',
    })
  })

  it('omits an absent project id and forwards attachments', async () => {
    const attachments = [{
      url: 'nomi-local://x.png',
      contentType: 'image/png',
      fileName: 'shot-frame.png',
      kind: 'image' as const,
    }]
    await runSingleShotAgent({
      featureKey: 'nomi:shot-verify',
      prompt: 'judge',
      displayPrompt: 'judge',
      skillKey: 'workbench.shot-verify',
      skillName: 'shot verify',
      attachments,
    })
    const input = runWorkbenchAgent.mock.calls[0]?.[0] as Record<string, unknown>
    expect(input).not.toHaveProperty('projectId')
    expect(input.attachments).toEqual(attachments)
  })

  it('returns the Host runner response unchanged', async () => {
    runWorkbenchAgent.mockResolvedValueOnce({
      id: 'turn-b', status: 'finished', text: 'candidate json', toolCalls: [], artifacts: [],
      usage: { promptTokens: 2, completionTokens: 3, cachedPromptTokens: 0, totalTokens: 5 }, finishReason: 'stop',
    })
    const result = await runSingleShotAgent({
      featureKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn',
    })
    expect(result).toMatchObject({ id: 'turn-b', text: 'candidate json', usage: { totalTokens: 5 } })
  })
})
