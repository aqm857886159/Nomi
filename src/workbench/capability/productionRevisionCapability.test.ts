import { beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-09-05：single-shot 改走 Host 临时执行路（不产生持久化回合），请求形状在 runEphemeral 上验。
const runEphemeral = vi.fn()

vi.mock('../ai/projectAgentClient', () => ({
  projectAgentClient: { runEphemeral: (...args: unknown[]) => runEphemeral(...args) },
}))
vi.mock('../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: () => 'project-1' }))
vi.mock('../ai/projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: { getState: () => ({ snapshot: { binding: { projectId: 'project-1' } }, subscriptionId: 'subscription-test' }) },
}))
vi.mock('../ai/assistantModelPref', () => ({ getAssistantModelPref: () => null }))
vi.mock('../generationCanvas/agent/runDirectionPlanner', () => ({ runDirectionPlanner: vi.fn() }))
vi.mock('../generationCanvas/agent/runStoryboardPlanner', () => ({ runStoryboardPlanner: vi.fn() }))

import { handleCapabilityApply } from './capabilityApplyHandler'

const VALID_PLAN = {
  title: '雨夜找猫',
  anchors: [],
  shots: [{ index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 3, anchorIds: [], prompt: '雨夜巷口，主角抬头' }],
}

describe('production.revise-storyboard renderer seam', () => {
  beforeEach(() => {
    runEphemeral.mockReset()
  })

  it('asks the real planner for schema-shaped JSON and validates the returned plan', async () => {
    runEphemeral.mockResolvedValue({ text: JSON.stringify(VALID_PLAN) })

    const result = await handleCapabilityApply('production.revise-storyboard', {
      projectId: 'project-1',
      runId: 'run-1',
      sourceContent: JSON.stringify(VALID_PLAN),
      instruction: '把第一镜改成更近的中景',
    }) as { plan?: unknown }

    expect(result.plan).toEqual(VALID_PLAN)
    const request = runEphemeral.mock.calls[0][1] as Record<string, unknown>
    expect(String(request.prompt)).toContain('只输出 JSON')
    expect(String(request.prompt)).toContain('transition')
    expect(request.skillKey).toBe('workbench.production.script-planner')
    expect(request.capability).toBe('single-shot')
    expect(request.history).toEqual({ kind: 'ephemeral' })
    expect(request.featureKey).toBe('nomi:production-script:project-1')
  })

  it('rejects prose instead of turning an unstructured model answer into a candidate', async () => {
    runEphemeral.mockResolvedValue({ text: '我建议把第一镜拍得更近一些。' })

    await expect(handleCapabilityApply('production.revise-storyboard', {
      projectId: 'project-1',
      runId: 'run-1',
      sourceContent: JSON.stringify(VALID_PLAN),
      instruction: '改近景',
    })).rejects.toThrow()
  })
})
