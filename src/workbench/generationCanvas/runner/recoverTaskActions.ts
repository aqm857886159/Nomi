import { fetchWorkbenchTaskResultByVendor, pollCanvasShotRun, type TaskResultDto } from '../../api/taskApi'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import { deliverRunOutcome, isRunTargetLoaded as isTargetLoaded, type RunProjectTarget } from './runProjectDelivery'
import { localizeRemoteResultUrl } from './resultAssetLocalization'
import { narrateProgress } from '../../observability/narrate'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { asTrimmedString, resolveTaskKind, selectedModelKey, selectedVendor } from './catalogTaskResolve'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'
import i18n from '../../../i18n'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'
import type { MediaDimensions } from '../nodes/nodeSizing'
import { awaitMediaTransfer, describePhaseSilence } from './generationPhaseDeadline'
import { isTerminalTaskStatus } from '../../../../electron/shared/taskStatus'
import { productionRunIdOf } from '../../production/productionShotOwnership'
import { retryProductionRetrievalForNode } from '../../production/retryProductionRetrieval'
import { productionRunApi } from '../../production/productionRunApi'

const RECOVER_POLL_INTERVAL_MS = 3000
// 找回轮询自己的上限（10 分钟）：超了仍没终态 → 退回 recoverable，按钮重现，让用户稍后再试。
// 它只在两次查询之间检查；**每一次**查询自己另有时限（awaitMediaTransfer）——2026-09-28 之前没有，
// 一次不返回的查询让「重新拉取」本身也永远转圈，这个 10 分钟上限根本轮不到检查。
const RECOVER_POLL_TIMEOUT_MS = 600000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

/** 从一个 recoverable 节点重建续查所需的身份（全在节点上，taskId 已落盘）。 */
function buildRecoverPayload(nodeId: string): { taskId: string; vendor: string; taskKind: ReturnType<typeof resolveTaskKind>; prompt: string; modelKey: string; archetype?: { modeId: string }; run?: GenerationNodeRunRecord } | null {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null
  const taskId = asTrimmedString(node.runs?.[0]?.taskId) || asTrimmedString(node.progress?.taskId)
  const vendor = selectedVendor(node)
  if (!taskId || !vendor) return null
  // 用同一套 reference 解析还原原始 granular kind（image_to_video vs text_to_video…），
  // 让主进程 findTaskMapping 命中与首发同一个 query 桶。
  const references = resolveGenerationReferences(node, { nodes: state.nodes, edges: state.edges })
  const archetype = node.meta?.archetype
  const modeId = archetype && typeof archetype === 'object' ? asTrimmedString((archetype as { modeId?: unknown }).modeId) : ''
  return {
    taskId,
    vendor,
    taskKind: resolveTaskKind(node, references),
    prompt: asTrimmedString(node.prompt),
    modelKey: selectedModelKey(node) || '',
    ...(modeId ? { archetype: { modeId } } : {}),
    ...(node.runs?.[0] ? { run: node.runs[0] } : {}),
  }
}

/**
 * 找回的项目身份只来自任务自己：运行记录在提交那一刻固定的 projectId。
 * 旧记录没有这一栏时，由「记录持久化在哪个项目里」派生——点击找回时它就在签发的项目画布上。
 * 记录说它属于别的项目（例如节点被复制到了这里）→ 拒绝，不把原项目的产物落进这个项目。
 */
function resolveRecoverTarget(run: GenerationNodeRunRecord | undefined, project: ProjectExecutionContext): RunProjectTarget | null {
  const recorded = asTrimmedString(run?.projectId)
  if (recorded && recorded !== project.binding.projectId) return null
  return project.binding
}

/**
 * 重新拉取一个超时找回态节点的结果（query，不是 generate → 不铸付费令牌、不弹确认）。
 * 主进程 fetchTaskResult 在内存缓存 miss 时用 {vendor,modelKey,taskKind,taskId,projectId} 无状态重建查询，
 * 故重启 App 后仍可拉回。拉取期间节点显示 running（品牌 logo 转圈），出片回到**任务所属项目**的节点：
 * 用户中途切走项目，结果照样写进原项目（盘上副本），新项目零副作用。
 */
export async function recoverNodeResult(nodeId: string, project: ProjectExecutionContext): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const store = useGenerationCanvasStore.getState()
  // 制作派出去、已经生成、只差取回的镜（#975 V-975）：重新取回归 Run（job.retry_retrieval），不走画布自己的任务查询。
  const productionRunId = productionRunIdOf(store.nodes.find((candidate) => candidate.id === id) ?? { meta: undefined })
  if (productionRunId) {
    try {
      if (await retryProductionRetrievalForNode(project.binding.projectId, productionRunId, id, productionRunApi)) return
    } catch (error) {
      store.setNodeStatus(id, 'recoverable', error instanceof Error ? error.message : String(error))
      return
    }
  }
  const payload = buildRecoverPayload(id)
  if (!payload) {
    store.setNodeStatus(id, 'error', i18n.t('generationCommon.recoverable.missingTask'))
    return
  }
  const target = resolveRecoverTarget(payload.run, project)
  if (!target) {
    store.setNodeStatus(id, 'error', i18n.t('generationCommon.recoverable.otherProjectTask'))
    return
  }

  const node = store.nodes.find((candidate) => candidate.id === id)
  if (!node) return
  // 翻到 running：复用现有 run 记录，显示「正在拉取结果」（品牌 logo 转圈），清掉 recoverable 面板。
  store.setNodeStatus(id, 'running')
  const runId = node.runs?.[0]?.id
  store.setNodeProgress(id, {
    runId,
    phase: 'still-generating',
    message: i18n.t('generationCommon.recoverable.retrievingResult'),
    taskId: payload.taskId,
  })

  const startedAt = Date.now()
  let current: TaskResultDto | null = null
  try {
    while (true) {
      // 找回的这次查询里可能就包着整段下载（主进程查到成片就地落盘，且不为找回广播「开始落地」），
      // 所以按一次媒体传输那一档给时限；到点抛错，由下面的 catch 落回「可找回」，按钮重现。
      // 单镜 Run 路交出去的这一次：经它的 Run 查（主进程记下这一次查询，出片就记进 Run）；旧运行记录没有 Run，照旧路查。
      const query = async () => {
        const viaRun = runId ? await pollCanvasShotRun({ projectId: target.projectId, runRecordId: runId }) : null
        return viaRun ? { vendor: payload.vendor, result: viaRun } : fetchWorkbenchTaskResultByVendor({
          taskId: payload.taskId,
          vendor: payload.vendor,
          taskKind: payload.taskKind,
          prompt: payload.prompt || null,
          modelKey: payload.modelKey || null,
          projectId: target.projectId,
          ...(payload.archetype ? { archetype: payload.archetype } : {}),
        })
      }
      const response = await awaitMediaTransfer(query(), (waitedMs) => new Error(describePhaseSilence('still-generating', waitedMs)))
      current = response.result
      if (isTerminalTaskStatus(current.status)) break
      if (Date.now() - startedAt > RECOVER_POLL_TIMEOUT_MS) {
        // 仍没出来 → 退回可找回态，按钮重现，稍后可再拉。
        await deliverRunOutcome(target, id, { kind: 'status', status: 'recoverable', error: i18n.t('generationCommon.recoverable.stillUpstream') })
        return
      }
      // 进度只给前台看：原项目不在画布上时不写（那是别的项目的 store），也不为一句进度去写盘。
      if (isTargetLoaded(target)) {
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId,
          phase: 'still-generating',
          message: narrateProgress('still-generating', { elapsedMs: Date.now() - startedAt }),
          taskId: payload.taskId,
        })
      }
      await delay(RECOVER_POLL_INTERVAL_MS)
    }
  } catch (error) {
    // 网络/查询本身报错 → 退回可找回态（不是真失败），让用户能再点。
    // 走 describeOpaqueFailure 而不是自己写一句「拉取结果失败」：这条路径正是出站被拦最常落地的地方，
    // 而那条错误的价值全在它的机器码和「钱没丢、去确认代理」那句人话上——一句同义反复会把它盖掉。
    await deliverRunOutcome(target, id, { kind: 'status', status: 'recoverable', error: describeOpaqueFailure(error) })
    return
  }

  if (!current) return
  try {
    let mediaDimensions: MediaDimensions | undefined
    const onMediaDimensions = (dimensions: MediaDimensions) => { mediaDimensions = dimensions }
    const normalized = normalizeCatalogTaskResult(current, node, onMediaDimensions)
    // 结构闸（找回路径）：找回本身就发生在 CDN 快过期的时刻，此处尤其要把临时 URL 落地——落进任务所属项目。
    const localized = await localizeRemoteResultUrl(normalized, target.projectId, id, onMediaDimensions)
    const landedInOpenProject = await deliverRunOutcome(target, id, { kind: 'result', result: localized, ...(mediaDimensions ? { mediaDimensions } : {}) })
    if (landedInOpenProject) await persistActiveWorkbenchProjectNow().catch(() => {})
  } catch (error) {
    // 终态是 failed（normalizeCatalogTaskResult 对 failed 抛错）→ 这才是真失败，落 error 桶。
    await deliverRunOutcome(target, id, { kind: 'status', status: 'error', error: describeOpaqueFailure(error) })
  }
}

/** 放弃找回：用户明确把这个超时节点标为失败（进红色错误桶，可重试生成）。 */
export function dismissRecoverableNode(nodeId: string): void {
  const id = String(nodeId || '').trim()
  if (!id) return
  useGenerationCanvasStore.getState().setNodeStatus(id, 'error', '已标记为失败：生成超时，未找回结果。可重新生成。')
}
