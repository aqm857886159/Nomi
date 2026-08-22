import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestConfirm = vi.fn()

vi.mock('../generationCanvas/spend/spendConfirm', () => ({
  useSpendConfirmStore: { getState: () => ({ requestConfirm }) },
}))
vi.mock('../project/workbenchProjectSession', () => ({ getActiveWorkbenchProjectId: () => 'project-1' }))

import { handleCapabilityApply } from './capabilityApplyHandler'

describe('renderer generation gate confirmation', () => {
  beforeEach(() => {
    requestConfirm.mockReset().mockResolvedValue(true)
  })

  it('shows one plain-language confirmation with model, cost, project, references and expiry', async () => {
    const result = await handleCapabilityApply('generation.gate.confirm', {
      challengeId: 'challenge-1',
      projectName: '短片 A',
      shotSummary: '生成这一镜',
      model: 'model-x',
      referenceCount: 2,
      maximumCost: 5,
      currency: '¥',
      expiresAt: '2026-08-23T01:00:00.000Z',
    })

    expect(result).toEqual({ confirmed: true, challengeId: 'challenge-1' })
    expect(requestConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.any(String),
      message: expect.stringContaining('model-x'),
      source: 'agent',
      kind: 'generation',
      details: expect.arrayContaining([
        { label: expect.any(String), value: '短片 A' },
        { label: expect.any(String), value: 'model-x' },
        { label: expect.any(String), value: '2' },
        { label: expect.any(String), value: '¥5' },
      ]),
    }))
  })

  it('returns a decline without minting anything in the renderer', async () => {
    requestConfirm.mockResolvedValue(false)
    await expect(handleCapabilityApply('generation.gate.confirm', { challengeId: 'challenge-1', model: 'model-x', maximumCost: 5, expiresAt: '2026-08-23T01:00:00.000Z' }))
      .resolves.toEqual({ confirmed: false, challengeId: 'challenge-1' })
  })
})
