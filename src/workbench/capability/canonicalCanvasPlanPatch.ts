import { canvasWriteSemanticInputSchema, isCanvasWriteLiveRendererOperation } from '../../../electron/shared/agentCapabilities/canvasWrite'
import { buildCanvasWriteAdmissionForOperation } from '../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import { captureCanvasWriteRawEvidence, executeCanvasWriteTarget } from '../generationCanvas/agent/canvasWriteTarget'
import { readGenerationCanvasSnapshot } from '../generationCanvas/agent/generationCanvasTools'
import {
  persistActiveWorkbenchProjectNow,
  waitForActiveWorkbenchProjectSaveTarget,
} from '../project/workbenchProjectSession'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'

type CanonicalCanvasPlanPatchRequest = Readonly<{
  projectId: string
  input: unknown
  receiptProposalId: string
  approvalId: string
  actionHash?: string
  /** 处理这条宿主写请求那一刻签发的已打开项目（没有打开的项目 = null）。 */
  loaded: ProjectExecutionContext | null
}>

/**
 * Renderer owner for the canvas.write operations the main process routes to the live renderer
 * (CANVAS_WRITE_LIVE_RENDERER_OPERATIONS): nomi_canvas_plan patch_shots and nomi_canvas_edit
 * create_staging_reference / create_camera_move (they land director nodes).
 *
 * The main process has already verified the project lease and host transport;
 * this function binds that request to the current renderer snapshot, then
 * enters the normal admission → proposal transaction → receipt path. There is
 * no generic planner fallback for this operation.
 */
export async function executeCanonicalCanvasPlanPatch(
  request: CanonicalCanvasPlanPatchRequest,
): Promise<unknown> {
  const { loaded } = request
  // 宿主写入只作用于签发时就打开着、且此刻仍有效的那个项目（A→B→A 不复活）。
  const assertLoaded = (): void => {
    if (!loaded || loaded.binding.projectId !== request.projectId || !isProjectExecutionContextCurrent(loaded)) {
      throw new SurfacePortWireError('surface_port_stale')
    }
  }
  assertLoaded()

  let input
  try {
    input = canvasWriteSemanticInputSchema.parse(request.input)
  } catch {
    throw new SurfacePortWireError('capability_input_invalid')
  }
  // 只收主进程路由到渲染端的那几个操作（同一份名单），别的画布写不从这扇门进。
  if (!isCanvasWriteLiveRendererOperation(input.operation)) {
    throw new SurfacePortWireError('capability_input_invalid')
  }

  // Ensure the durable owner exists before preparing/committing the proposal
  // receipt.  Waiting only after executeCanvasWriteTarget would allow an
  // in-memory mutation and receipt to become orphaned if hydration never
  // installs the save target.
  const ownerReadyBeforeWrite = waitForActiveWorkbenchProjectSaveTarget(request.projectId)
  if (ownerReadyBeforeWrite !== true && !(await ownerReadyBeforeWrite)) {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }

  const readSnapshot = readGenerationCanvasSnapshot
  const rawEvidence = captureCanvasWriteRawEvidence(readSnapshot(), {
    operation: input.operation,
    input,
  })
  const admission = buildCanvasWriteAdmissionForOperation(rawEvidence, input)
  const result = await executeCanvasWriteTarget(
    {
      input,
      target: admission.target,
      preconditions: admission.preconditions,
      receiptProposalId: request.receiptProposalId,
      approvalId: request.approvalId,
      actionHash: request.actionHash,
      signal: new AbortController().signal,
      assertCurrent: assertLoaded,
    },
    readSnapshot,
  )

  // The proposal receipt is an audit of the user-visible write, so it must
  // never get ahead of the durable project owner.  Normal store persistence
  // is debounced for editing ergonomics; canonical Host writes cross a
  // process boundary and therefore flush the active project before returning
  // the committed result to MCP.  A missing/mismatched save target is an
  // unresolved receipt, not a successful in-memory mutation.
  assertLoaded()
  // React can rebind the owner while the renderer mutation crosses IPC.  The
  // second readiness check closes that cutover window before the durable save.
  const ownerReady = waitForActiveWorkbenchProjectSaveTarget(request.projectId)
  if (ownerReady !== true && !(await ownerReady)) {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  let saved
  try {
    saved = await persistActiveWorkbenchProjectNow()
  } catch {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  if (!saved || saved.id !== request.projectId || !Number.isInteger(saved.revision)) {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  assertLoaded()
  return result
}
