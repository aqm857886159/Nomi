import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { executeCanonicalCanvasPlanPatch } from './canonicalCanvasPlanPatch'
import { buildCanvasWriteAdmissionForOperation } from '../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import { captureCanvasWriteRawEvidence, executeCanvasWriteTarget } from '../generationCanvas/agent/canvasWriteTarget'
import { readGenerationCanvasSnapshot } from '../generationCanvas/agent/generationCanvasTools'
import { persistActiveWorkbenchProjectNow, waitForActiveWorkbenchProjectSaveTarget } from '../project/workbenchProjectSession'

vi.mock('../../../electron/shared/agentCapabilities/canvasWriteEvidence', () => ({
  buildCanvasWriteAdmissionForOperation: vi.fn(),
}))

vi.mock('../generationCanvas/agent/canvasWriteTarget', () => ({
  captureCanvasWriteRawEvidence: vi.fn(),
  executeCanvasWriteTarget: vi.fn(),
}))

vi.mock('../generationCanvas/agent/generationCanvasTools', () => ({
  readGenerationCanvasSnapshot: vi.fn(),
}))

vi.mock('../project/workbenchProjectSession', () => ({
  persistActiveWorkbenchProjectNow: vi.fn(),
  waitForActiveWorkbenchProjectSaveTarget: vi.fn(),
}))

const snapshot = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const patchInput = {
  operation: 'patch_shots' as const,
  select: { kind: 'indexes' as const, indexes: [2] },
  patch: { promptAppend: '雨天' },
}

function request(readActiveProjectId: () => string | null, input: unknown = patchInput) {
  return {
    projectId: 'project-a',
    input,
    receiptProposalId: 'receipt-a',
    approvalId: 'approval-a',
    actionHash: 'a'.repeat(64),
    readActiveProjectId,
  }
}

describe('canonicalCanvasPlanPatch changed-function coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readGenerationCanvasSnapshot).mockReturnValue(snapshot)
    vi.mocked(captureCanvasWriteRawEvidence).mockReturnValue({ node: { id: 'live', kind: 'shot', title: 'live', prompt: 'live', locked: false, categoryId: null, groupId: null, model: { modelKey: null, vendorKey: null, archetypeId: null, modeId: null, variantId: null }, currentResult: null }, groups: [] } as never)
    vi.mocked(buildCanvasWriteAdmissionForOperation).mockReturnValue({ target: { kind: 'canvas', nodeIds: [] }, preconditions: { edges: [] } })
    vi.mocked(executeCanvasWriteTarget).mockImplementation(async (targetRequest) => {
      targetRequest.assertCurrent()
      return { applied: true, operation: 'patch_shots', proposalId: 'receipt-a', changedShotIndexes: [2], changedFields: ['prompt'], result: {}, reconciliation: { ok: true, deviationCount: 0 } } as never
    })
    vi.mocked(waitForActiveWorkbenchProjectSaveTarget).mockReturnValue(true)
    vi.mocked(persistActiveWorkbenchProjectNow).mockResolvedValue({ id: 'project-a', revision: 2, version: 1 } as never)
  })

  it('fails closed for a stale active project before parsing or capturing', async () => {
    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-b'))).rejects.toMatchObject({ code: 'surface_port_stale' } satisfies Partial<SurfacePortWireError>)
    expect(captureCanvasWriteRawEvidence).not.toHaveBeenCalled()
  })

  it('fails closed for invalid input and for a valid non-patch operation', async () => {
    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-a', { operation: 'not-real' }))).rejects.toMatchObject({ code: 'capability_input_invalid' } satisfies Partial<SurfacePortWireError>)
    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-a', { operation: 'set_node_prompt', nodeId: 'node-a', prompt: 'new' }))).rejects.toMatchObject({ code: 'capability_input_invalid' } satisfies Partial<SurfacePortWireError>)
    expect(captureCanvasWriteRawEvidence).not.toHaveBeenCalled()
  })

  it('captures live evidence, builds admission, delegates, and rechecks the active project', async () => {
    const result = await executeCanonicalCanvasPlanPatch(request(() => 'project-a'))
    expect(result).toMatchObject({ applied: true, operation: 'patch_shots', changedShotIndexes: [2] })
    expect(captureCanvasWriteRawEvidence).toHaveBeenCalledWith(snapshot, { operation: 'patch_shots', input: patchInput })
    expect(buildCanvasWriteAdmissionForOperation).toHaveBeenCalledWith(expect.anything(), patchInput)
    expect(executeCanvasWriteTarget).toHaveBeenCalledWith(expect.objectContaining({
      input: patchInput,
      target: { kind: 'canvas', nodeIds: [] },
      preconditions: { edges: [] },
      receiptProposalId: 'receipt-a',
      approvalId: 'approval-a',
    }), readGenerationCanvasSnapshot)
    expect(persistActiveWorkbenchProjectNow).toHaveBeenCalledOnce()
  })

  it('fails closed when the committed receipt has no durable project save', async () => {
    vi.mocked(persistActiveWorkbenchProjectNow).mockResolvedValueOnce(null)

    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-a'))).rejects.toMatchObject({
      code: 'capability_receipt_unresolved',
    } satisfies Partial<SurfacePortWireError>)
  })

  it('waits for the active persistence owner before attempting the durable barrier', async () => {
    let releaseOwner!: () => void
    vi.mocked(waitForActiveWorkbenchProjectSaveTarget).mockReturnValueOnce(new Promise((resolve) => {
      releaseOwner = () => resolve(true)
    }))
    const pending = executeCanonicalCanvasPlanPatch(request(() => 'project-a'))
    await Promise.resolve()
    expect(persistActiveWorkbenchProjectNow).not.toHaveBeenCalled()
    expect(executeCanvasWriteTarget).not.toHaveBeenCalled()
    releaseOwner()
    await expect(pending).resolves.toMatchObject({ applied: true, operation: 'patch_shots' })
    expect(persistActiveWorkbenchProjectNow).toHaveBeenCalledOnce()
  })

  it('fails before mutation when the owner readiness window expires', async () => {
    vi.mocked(waitForActiveWorkbenchProjectSaveTarget).mockReturnValueOnce(false)
    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-a'))).rejects.toMatchObject({
      code: 'capability_receipt_unresolved',
    } satisfies Partial<SurfacePortWireError>)
    expect(executeCanvasWriteTarget).not.toHaveBeenCalled()
  })

  it('fails closed when the save owner acknowledges a different project', async () => {
    vi.mocked(persistActiveWorkbenchProjectNow).mockResolvedValueOnce({ id: 'project-b', revision: 2, version: 1 } as never)

    await expect(executeCanonicalCanvasPlanPatch(request(() => 'project-a'))).rejects.toMatchObject({
      code: 'capability_receipt_unresolved',
    } satisfies Partial<SurfacePortWireError>)
  })

  it('does not return a receipt until the durable save resolves', async () => {
    let resolveSave!: (value: unknown) => void
    vi.mocked(persistActiveWorkbenchProjectNow).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
    const pending = executeCanonicalCanvasPlanPatch(request(() => 'project-a'))
    await Promise.resolve()
    expect(vi.mocked(persistActiveWorkbenchProjectNow)).toHaveBeenCalledOnce()
    resolveSave({ id: 'project-a', revision: 2, version: 1 })
    await expect(pending).resolves.toMatchObject({ applied: true, operation: 'patch_shots' })
  })

  it('fails closed if the active project changes after admission', async () => {
    let reads = 0
    const activeProject = () => (reads++ === 0 ? 'project-a' : 'project-b')
    await expect(executeCanonicalCanvasPlanPatch(request(activeProject))).rejects.toMatchObject({ code: 'surface_port_stale' } satisfies Partial<SurfacePortWireError>)
  })
})
