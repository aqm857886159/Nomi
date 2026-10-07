import { describe, expect, it, vi } from 'vitest'
import type { ProjectBinding } from '../../../electron/shared/projectBinding'
import { openProjectAgentLane } from './projectAgentLaneOpen'

const binding: ProjectBinding = { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }

describe('project Agent lane isolation', () => {
  it('keeps project hydration successful when the optional lane cannot open', async () => {
    const recoverReceipts = vi.fn()
    const reportFailure = vi.fn()
    await expect(
      openProjectAgentLane(binding, {
        open: async () => ({ ok: false, code: 'agent_lane_disposed', diagnostic: 'shutdown marker' }),
        recoverReceipts,
        reportFailure,
      }),
    ).resolves.toBe(false)
    expect(reportFailure).toHaveBeenCalledOnce()
    expect(reportFailure.mock.calls[0][0]).toMatchObject({ laneCode: 'agent_lane_disposed' })
    expect(recoverReceipts).not.toHaveBeenCalled()
  })

  it('recovers lane receipts only after a workspace identity is acknowledged', async () => {
    const recoverReceipts = vi.fn(async () => undefined)
    const reportFailure = vi.fn()
    await expect(
      openProjectAgentLane(binding, {
        open: async () => ({ ok: true, workspaceId: 'workspace-a' }),
        recoverReceipts,
        reportFailure,
      }),
    ).resolves.toBe(true)
    expect(recoverReceipts).toHaveBeenCalledWith('workspace-a')
    expect(reportFailure).not.toHaveBeenCalled()
  })
})
