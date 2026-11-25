import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import type { ShotVerifyReport } from '../generationCanvas/agent/shotVerifyRunner'
import { handleCapabilityApply } from './capabilityApplyHandler'

const mocks = vi.hoisted(() => ({
  verifyShotsAndReport: vi.fn(),
  isShotVerifyEnabled: vi.fn(() => true),
}))

vi.mock('../generationCanvas/agent/shotVerifyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generationCanvas/agent/shotVerifyStore')>()
  return {
    ...actual,
    verifyShotsAndReport: mocks.verifyShotsAndReport,
    isShotVerifyEnabled: mocks.isShotVerifyEnabled,
  }
})

let session: ProjectSessionTestHarness

beforeEach(async () => {
  session = createProjectSessionTestHarness()
  await session.open('project-qa')
  mocks.verifyShotsAndReport.mockReset()
  mocks.isShotVerifyEnabled.mockReturnValue(true)
  useGenerationCanvasStore.setState({
    nodes: [
      { id: 'shot-1', kind: 'image', title: '镜 1', x: 0, y: 0, width: 300, height: 200, status: 'success', prompt: 'a' } as never,
      { id: 'shot-2', kind: 'image', title: '镜 2', x: 350, y: 0, width: 300, height: 200, status: 'success', prompt: 'b' } as never,
    ],
    edges: [],
  })
})

afterEach(() => {
  session.dispose()
})

describe('production.verify-shots 三态判决映射', () => {
  it('视觉模型不可用 / 审片抛错返回 unverified → 绝不映射为 passed: true', async () => {
    const report: ShotVerifyReport = {
      deviations: [],
      unverified: [
        { shotNodeId: 'shot-1', shotTitle: '镜 1', reason: 'vision_unavailable' },
        { shotNodeId: 'shot-2', shotTitle: '镜 2', reason: 'judge_failed' },
      ],
      shotOutcomes: [
        { shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'unverified', reason: 'vision_unavailable' },
        { shotNodeId: 'shot-2', shotTitle: '镜 2', status: 'unverified', reason: 'judge_failed' },
      ],
    }
    mocks.verifyShotsAndReport.mockResolvedValue(report)

    const res = await handleCapabilityApply('production.verify-shots', {
      projectId: 'project-qa',
      shotNodeIds: ['shot-1', 'shot-2'],
    }) as { reviewedShotIds: string[]; verdicts: Array<Record<string, unknown>> }

    expect(res.reviewedShotIds).toEqual(['shot-1', 'shot-2'])
    expect(res.verdicts).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'unverified', passed: false, unverifiedReason: 'vision_unavailable' },
      { shotNodeId: 'shot-2', shotTitle: '镜 2', status: 'unverified', passed: false, unverifiedReason: 'judge_failed' },
    ])
  })

  it('镜头未进 shotOutcomes（如缺生成画面地址）→ 诚实标 unverified(missing_frame_source)', async () => {
    const report: ShotVerifyReport = {
      deviations: [],
      unverified: [],
      shotOutcomes: [{ shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'passed' }],
    }
    mocks.verifyShotsAndReport.mockResolvedValue(report)

    const res = await handleCapabilityApply('production.verify-shots', {
      projectId: 'project-qa',
      shotNodeIds: ['shot-1', 'shot-2'],
    }) as { verdicts: Array<Record<string, unknown>> }

    expect(res.verdicts).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'passed', passed: true },
      { shotNodeId: 'shot-2', shotTitle: '镜 2', status: 'unverified', passed: false, unverifiedReason: 'missing_frame_source' },
    ])
  })

  it('反例 D：两镜均真实过检 → 两镜均 status=passed, passed=true', async () => {
    const report: ShotVerifyReport = {
      deviations: [],
      unverified: [],
      shotOutcomes: [
        { shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'passed' },
        { shotNodeId: 'shot-2', shotTitle: '镜 2', status: 'passed' },
      ],
    }
    mocks.verifyShotsAndReport.mockResolvedValue(report)

    const res = await handleCapabilityApply('production.verify-shots', {
      projectId: 'project-qa',
      shotNodeIds: ['shot-1', 'shot-2'],
    }) as { verdicts: Array<Record<string, unknown>> }

    expect(res.verdicts).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜 1', status: 'passed', passed: true },
      { shotNodeId: 'shot-2', shotTitle: '镜 2', status: 'passed', passed: true },
    ])
  })
})
