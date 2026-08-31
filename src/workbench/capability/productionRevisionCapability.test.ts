import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendWorkbenchAiMessage = vi.fn()
const clearWorkbenchAgentSession = vi.fn().mockResolvedValue(undefined)

vi.mock('../ai/workbenchAiClient', () => ({
  sendWorkbenchAiMessage: (...args: unknown[]) => sendWorkbenchAiMessage(...args),
}))
vi.mock('../../api/desktopClient', () => ({
  clearWorkbenchAgentSession: (...args: unknown[]) => clearWorkbenchAgentSession(...args),
}))
vi.mock('../ai/assistantModelPref', () => ({ getAssistantModelPref: () => undefined }))
vi.mock('../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: () => 'project-1' }))
vi.mock('../generationCanvas/agent/runDirectionPlanner', () => ({ runDirectionPlanner: vi.fn() }))
vi.mock('../generationCanvas/agent/runStoryboardPlanner', () => ({ runStoryboardPlanner: vi.fn() }))
vi.mock('../generationCanvas/runner/generationRunController', () => ({ runGenerationNode: vi.fn() }))
vi.mock('../api/taskApi', () => ({ mintSpendGrant: vi.fn().mockResolvedValue('grant-1') }))

import { handleCapabilityApply } from './capabilityApplyHandler'
import { RecoverableTimeoutError } from '../generationCanvas/runner/recoverableTimeout'
import { runGenerationNode } from '../generationCanvas/runner/generationRunController'

const VALID_PLAN = {
  title: '雨夜找猫',
  anchors: [],
  shots: [{ index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 3, anchorIds: [], prompt: '雨夜巷口，主角抬头' }],
}

describe('production.revise-storyboard renderer seam', () => {
  beforeEach(() => {
    sendWorkbenchAiMessage.mockReset()
    clearWorkbenchAgentSession.mockClear()
  })

  it('asks the real planner for schema-shaped JSON and validates the returned plan', async () => {
    sendWorkbenchAiMessage.mockResolvedValue({ text: JSON.stringify(VALID_PLAN) })

    const result = await handleCapabilityApply('production.revise-storyboard', {
      projectId: 'project-1',
      runId: 'run-1',
      sourceContent: JSON.stringify(VALID_PLAN),
      instruction: '把第一镜改成更近的中景',
    }) as { plan?: unknown }

    expect(result.plan).toEqual(VALID_PLAN)
    const request = sendWorkbenchAiMessage.mock.calls[0][0] as Record<string, unknown>
    expect(String(request.prompt)).toContain('只输出 JSON')
    expect(String(request.prompt)).toContain('transition')
    expect(request.skillKey).toBe('workbench.production.script-planner')
  })

  it('rejects prose instead of turning an unstructured model answer into a candidate', async () => {
    sendWorkbenchAiMessage.mockResolvedValue({ text: '我建议把第一镜拍得更近一些。' })

    await expect(handleCapabilityApply('production.revise-storyboard', {
      projectId: 'project-1',
      runId: 'run-1',
      sourceContent: JSON.stringify(VALID_PLAN),
      instruction: '改近景',
    })).rejects.toThrow()
  })
})

describe('production.generate-node recoverable renderer seam', () => {
  it('returns the provider receipt instead of throwing away the task id', async () => {
    vi.mocked(runGenerationNode).mockRejectedValueOnce(new RecoverableTimeoutError({
      taskId: 'provider-task-poll-1', vendor: 'apimart', taskKind: 'text_to_video', modelKey: 'doubao-seedance-2.0',
    }))

    const result = await handleCapabilityApply('production.generate-node', { nodeId: 'shot-1', maxAttemptsPerJob: 1 }) as Record<string, unknown>
    expect(result).toMatchObject({
      nodeId: 'shot-1', status: 'recoverable', providerTaskId: 'provider-task-poll-1',
      taskKind: 'text_to_video', modelKey: 'doubao-seedance-2.0', errorCode: 'provider_poll_recoverable',
    })
  })
})
