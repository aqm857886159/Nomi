import { describe, expect, it, vi } from 'vitest'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { nodeIdOfJob, releaseUnknownSubmission } from './releaseUnknownSubmission'

const run = (revision: number, status: string) => ({ runId: 'run-1', projectId: 'p1', revision, jobs: [{ jobId: 'job-1', status }] }) as unknown as ProductionRun

describe('releaseUnknownSubmission', () => {
  it('sends exactly one user_checked_abandon command and syncs the renderer run cache to the released run', async () => {
    useProductionCanvasLandingStore.getState().setRuns('p1', { 'run-1': run(3, 'submission_unknown') })
    const released = run(4, 'needs_attention')
    const command = vi.fn(async () => ({ run: released, events: [] }))
    const read = vi.fn(async () => run(3, 'submission_unknown'))

    await releaseUnknownSubmission('p1', 'run-1', 'job-1', { read, command } as never)

    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]).toMatchObject(['p1', 'run-1', { type: 'job.reconcile', expectedRevision: 3, payload: { jobId: 'job-1', outcome: 'user_checked_abandon' } }])
    // 组合框与紧接着的重新生成读的缓存：必须立刻是放行后的版本，不然会一直灰着 / 被旧缓存拦下。
    expect(useProductionCanvasLandingStore.getState().runs['run-1']).toBe(released)
  })

  it('finds the canvas node of a batch job through the plan shots', () => {
    expect(nodeIdOfJob({ generationPlan: { shots: [{ shotId: 's1', nodeId: 'n1' }] } }, { metadata: { shotId: 's1' } })).toBe('n1')
    expect(nodeIdOfJob({ generationPlan: { nodeId: 'single' } }, {})).toBe('single')
  })
})


it('C4: canvas runs find their node through origin, retaining production and legacy mappings', () => {
  expect(nodeIdOfJob({ origin: { nodeId: 'canvas-node' } } as never, {})).toBe('canvas-node')
  expect(nodeIdOfJob({ generationPlan: { nodeId: 'production-node' } }, {})).toBe('production-node')
  expect(nodeIdOfJob({}, { nodeId: 'legacy-node' })).toBe('legacy-node')
})
