import { describe, expect, it, vi } from 'vitest'

import type { ProductionRun, RunCommand } from '../../../electron/productionRun/productionRunTypes'
import { executeProductionRunCommand } from './productionRunCommands'

function run(revision: number, gateStatus: 'waiting' | 'approved' = 'waiting'): ProductionRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    projectId: 'project-1',
    revision,
    status: 'awaiting_contract',
    stageId: 'build',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'nomi' },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: revision,
    stages: [],
    gates: [
      {
        gateId: 'gate-contract-v1',
        scope: 'budget_envelope',
        status: gateStatus,
        title: 'contract',
        summary: 'contract',
        createdAt: '',
        expiresAt: '',
      },
    ],
    jobs: [],
    artifacts: [],
    createdAt: '',
    updatedAt: '',
  }
}

const command: RunCommand = {
  commandId: 'command-1',
  expectedRevision: 4,
  type: 'gate.decide',
  payload: { gateId: 'gate-contract-v1', status: 'approved' },
  issuedAt: '',
}

describe('executeProductionRunCommand', () => {
  it('retries a revision conflict with the latest revision and preserves the command id', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('ProductionRunRevisionConflictError: expected 4, actual 5'))
      .mockResolvedValueOnce({ run: run(6, 'approved'), events: [] })
    const read = vi.fn().mockResolvedValue(run(5))

    await executeProductionRunCommand('project-1', 'run-1', command, { read, execute })

    expect(read).toHaveBeenCalledWith('project-1', 'run-1')
    expect(execute).toHaveBeenNthCalledWith(2, 'project-1', 'run-1', { ...command, expectedRevision: 5 })
  })

  it('treats an already-decided gate as success without issuing another command', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('revision conflict'))
    const read = vi.fn().mockResolvedValue(run(5, 'approved'))

    const result = await executeProductionRunCommand('project-1', 'run-1', command, { read, execute })

    expect(result.run.revision).toBe(5)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-conflict errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('invalid gate'))
    const read = vi.fn()

    await expect(executeProductionRunCommand('project-1', 'run-1', command, { read, execute })).rejects.toThrow(
      'invalid gate',
    )
    expect(read).not.toHaveBeenCalled()
  })
})
