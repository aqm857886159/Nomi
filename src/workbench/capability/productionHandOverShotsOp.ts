// `production.hand-over-shots` 的渲染层那一半（D2 第③步：一台发动机）。主进程那一半在 `electron/capabilityCore/canvasHandOver.ts`。
//
// 主进程已经在出价上记下了「这几镜交给画布」（卡上点了「生成」= 手势；「直接生成」档 = 策略），也把还没落的镜落好了。
// 这里只做画布批量那一条路本来就做的事，一镜一镜照节点当前的样子发：
//
//   ① 本机预检（`handOverPrecheck`，和卡上出卡前那一份同一个判据）：判得出发不出去的不开同意，回给主进程原因；
//   ③ 开同意（`consentCanvasShots` 带 production 链接 → 主进程把画布单镜 Run 绑到那一次交接上），开不成整批不交；
//   ④ 回话（哪几镜没开出同意、为什么）——主进程只等这一步，不等生成；
//   ⑤ 派发：画布批量的依赖波次 + 单节点提交（`runGenerationNodesByPlan`），每一镜走画布单节点那一条提交、带同一个手势收据。
//      不用 `runPlanWithToasts`：成败由卡 / 回执 / 节点自己说，不再弹一遍批量提示。没轮到就停了的那几镜，同意当场收回。
//
// 「这一镜归不归画布」不在这里判（`claimAdmittedByHost`）：渲染层的 Run 投影比账本晚一拍，主进程派发时按绑着的画布 Run 认。
import { logRendererWarn } from '../../desktop/rendererLog'
import type { GenerationHandOverFailure } from '../../desktop/productionRunBridgeTypes'
import { consentCanvasShots, withdrawCanvasShots, type CanvasConsentShot } from '../api/taskApi'
import { planCanvasGenerationScope } from '../generationCanvas/runner/generationScopeFacts'
import { selectedModelKey, selectedVendor } from '../generationCanvas/runner/catalogTaskResolve'
import { captureApprovedGenerationInputs } from '../generationCanvas/runner/runProjectDelivery'
import { runGenerationNodesByPlan } from '../generationCanvas/runner/generationRunWaves'
import { createRunId } from '../generationCanvas/store/canvasIds'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { handOverPrecheck } from '../production/handOverPrecheck'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import type { HandOverShotsReply } from '../../../electron/shared/contracts/canvasHandOver'

type HandOverShotsAnswer = Readonly<{ skipped: NonNullable<HandOverShotsReply['skipped']> }>

type HandOverTarget = Readonly<{ shotId: string; nodeId: string }>

type HandOverShotsInput = Readonly<{ projectId: string; runId: string; shots: readonly HandOverTarget[] }>

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function parseInput(data: Record<string, unknown>): HandOverShotsInput {
  const shots = Array.isArray(data.shots) ? data.shots.flatMap((entry): HandOverTarget[] => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const shotId = text(record.shotId)
    const nodeId = text(record.nodeId)
    return shotId && nodeId ? [{ shotId, nodeId }] : []
  }) : []
  const projectId = text(data.projectId)
  const runId = text(data.runId)
  if (!projectId || !runId || shots.length === 0) throw new SurfacePortWireError('capability_input_invalid')
  return { projectId, runId, shots }
}

const notSent = (code: string): GenerationHandOverFailure => ({ kind: 'not_sent', code })

/** 交接的派发（第⑤步）。不 await：主进程只等同意开好。没轮到就停了 / 本镜跑挂在提交之前的，同意当场收回（主进程按没发出去落定）。 */
function dispatchHandedOverShots(project: ProjectExecutionContext, recordIds: ReadonlyMap<string, string>, assertApprovedInputs: ReturnType<typeof captureApprovedGenerationInputs>): void {
  const { nodes, edges } = useGenerationCanvasStore.getState()
  const projectId = project.binding.projectId
  // 同意已开：这几镜此刻归这一次交接，「生成中」只读节点自己的状态，不把自己剔掉。
  const plan = planCanvasGenerationScope('hand-over', [...recordIds.keys()], { nodes, edges }, { busy: 'status' })
  void runGenerationNodesByPlan(plan, {
    assertApprovedInputs,
    target: project.binding,
    canvasRunRecordIds: recordIds,
    claimAdmittedByHost: true,
    // 交过去的派发（供应商受理 / 拒）主进程已经落定；这一下收回只对还没派发的那一份同意生效（例如提交前发现节点变了）。
    onNodeResult: (event) => {
      if (event.ok) return
      const runRecordId = recordIds.get(event.nodeId)
      if (runRecordId) withdrawCanvasShots({ projectId, runRecordIds: [runRecordId], by: 'stopped' })
    },
  }).catch((error: unknown) => logRendererWarn('production-hand-over-dispatch-failed', { projectId }, error))
}

/**
 * 主进程问「这几镜交给画布」时的那一下。回 `skipped`：没开出同意的镜和原因（Nomi 自己的语义码）。
 * 预期之中的失败都写进回话（码能一路送到卡上）；只有入参坏了才抛。
 */
export async function handOverShotsOp(data: Record<string, unknown>): Promise<HandOverShotsAnswer> {
  const input = parseInput(data)
  const skipped: Array<{ shotId: string; failure: GenerationHandOverFailure }> = []
  const skip = (targets: readonly HandOverTarget[], failure: GenerationHandOverFailure): HandOverShotsAnswer => {
    skipped.push(...targets.map((target) => ({ shotId: target.shotId, failure })))
    return { skipped }
  }
  const project = withProjectAction((issued) => issued)
  if (!project || project.binding.projectId !== input.projectId) return skip(input.shots, notSent('project_not_open'))

  // ① 本机预检：和卡上出卡前那一份同一个判据。
  const graph = useGenerationCanvasStore.getState()
  const failures = handOverPrecheck(input.shots.map((target) => target.nodeId), graph)
  const ready = input.shots.filter((target) => {
    const failure = failures.get(target.nodeId)
    if (failure) skipped.push({ shotId: target.shotId, failure })
    return !failure
  })
  if (ready.length === 0) return { skipped }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const readyNodes = ready.map((target) => byId.get(target.nodeId)!)

  // ③ 开同意（带 production 链接：主进程绑到那一次交接上）。批准的输入这一刻定死：派发前节点又变了就不发这一镜。
  const shots: CanvasConsentShot[] = readyNodes.map((node, index) => ({
    nodeId: node.id, runRecordId: createRunId(node.id), vendor: selectedVendor(node), modelKey: selectedModelKey(node), kind: node.kind,
    production: { runId: input.runId, shotId: ready[index]!.shotId },
  }))
  const assertApprovedInputs = captureApprovedGenerationInputs(shots.map((shot) => shot.nodeId))
  try {
    await consentCanvasShots({ projectId: input.projectId, shots })
  } catch (error) {
    // 主进程那头一镜没开成就整批收回（出价在两步之间关了 / 交接绑不上）：一镜都没交。
    logRendererWarn('production-hand-over-consent-failed', { projectId: input.projectId }, error)
    return skip(ready, notSent('canvas_consent_failed'))
  }
  const recordIds = new Map(shots.map((shot) => [shot.nodeId, shot.runRecordId]))
  if (!isProjectExecutionContextCurrent(project)) {
    // 开同意那一下里换了项目：还没交任何东西，收回刚开的同意（主进程按没发出去落定）。
    withdrawCanvasShots({ projectId: input.projectId, runRecordIds: [...recordIds.values()], by: 'stopped' })
    return { skipped }
  }
  // ④ 先回话（同步返回之前派发不会跑到 await 之后），⑤ 派发在后台跑。
  dispatchHandedOverShots(project, recordIds, assertApprovedInputs)
  return { skipped }
}
