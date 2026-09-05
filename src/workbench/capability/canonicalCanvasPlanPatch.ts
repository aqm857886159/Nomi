import { canvasWriteSemanticInputSchema } from '../../../electron/shared/agentCapabilities/canvasWrite'
import { buildCanvasWriteAdmissionForOperation } from '../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { captureCanvasWriteRawEvidence, executeCanvasWriteTarget } from '../generationCanvas/agent/canvasWriteTarget'
import { readGenerationCanvasSnapshot } from '../generationCanvas/agent/generationCanvasTools'

export type CanonicalCanvasPlanPatchRequest = Readonly<{
  projectId: string
  input: unknown
  receiptProposalId: string
  approvalId: string
  actionHash?: string
  readActiveProjectId: () => string | null
}>

/**
 * Renderer owner for the public nomi_canvas_plan patch_shots operation.
 *
 * The main process has already verified the project lease and host transport;
 * this function binds that request to the current renderer snapshot, then
 * enters the normal admission → proposal transaction → receipt path. There is
 * no generic planner fallback for this operation.
 */
export async function executeCanonicalCanvasPlanPatch(
  request: CanonicalCanvasPlanPatchRequest,
): Promise<unknown> {
  if (request.readActiveProjectId() !== request.projectId) {
    throw new SurfacePortWireError('surface_port_stale')
  }

  let input
  try {
    input = canvasWriteSemanticInputSchema.parse(request.input)
  } catch {
    throw new SurfacePortWireError('capability_input_invalid')
  }
  if (input.operation !== 'patch_shots') {
    throw new SurfacePortWireError('capability_input_invalid')
  }

  const readSnapshot = readGenerationCanvasSnapshot
  const rawEvidence = captureCanvasWriteRawEvidence(readSnapshot(), {
    operation: input.operation,
    input,
  })
  const admission = buildCanvasWriteAdmissionForOperation(rawEvidence, input)
  return executeCanvasWriteTarget(
    {
      input,
      target: admission.target,
      preconditions: admission.preconditions,
      receiptProposalId: request.receiptProposalId,
      approvalId: request.approvalId,
      actionHash: request.actionHash,
      signal: new AbortController().signal,
      assertCurrent: () => {
        if (request.readActiveProjectId() !== request.projectId) {
          throw new SurfacePortWireError('surface_port_stale')
        }
      },
    },
    readSnapshot,
  )
}
