import { getDesktopBridge } from '../../desktop/bridge'
import { logRendererError } from '../../desktop/rendererLog'
import { readLocalProjectAsync, saveLocalProject } from '../library/localProjectStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import type { AssetRef } from './assetTypes'
import { applyAssetResultDeletion, buildAssetResultDeletionPlan } from './assetResultDeletion'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { NodeResultLifecyclePatch } from '../generationCanvas/model/nodeResultLifecycle'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import {
  dropUndoBarriersAfter,
  getLatestUndoBarrierAbsolutePosition,
  getUndoJournalGeneration,
  getUndoJournalPosition,
  pushUndoSnapshot,
} from '../generationCanvas/events/canvasUndoJournal'
import { deferAssetFileDeletion, forgetDeferredAssetDeletion } from './pendingAssetDeletions'

export type DeleteAssetResultOutcome = {
  removedResultCount: number
  deletedFileCount: number
  failedFileCount: number
  /** 文件没当场删、等撤销窗口过去再删（已加载项目的删除都是这样）。 */
  deferredFileCount: number
}

const deletionQueues = new Map<string, Promise<void>>()

function serializeProjectDeletion<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = deletionQueues.get(projectId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  deletionQueues.set(projectId, tail)
  void tail.finally(() => {
    if (deletionQueues.get(projectId) === tail) deletionQueues.delete(projectId)
  })
  return result
}

function lifecycleFingerprint(value: Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>): string {
  return JSON.stringify({
    result: value.result,
    history: value.history ?? [],
    status: value.status,
    error: value.error,
  })
}

function rollbackAppliedPatches(
  rollbacks: Array<{ nodeId: string; before: NodeResultLifecyclePatch; applied: NodeResultLifecyclePatch }>,
): void {
  const store = useGenerationCanvasStore.getState()
  for (const rollback of rollbacks) {
    const current = store.nodes.find((node) => node.id === rollback.nodeId)
    if (!current || lifecycleFingerprint(current) !== lifecycleFingerprint(rollback.applied)) continue
    store.updateNode(rollback.nodeId, rollback.before)
  }
}

/**
 * 删除的是「一个生成结果」，不是整个节点。
 * - 已加载项目：一个撤销步（先打撤销点再改画布），文件记进待删清单、和版本删除同一次存盘落盘；
 *   真删推迟到撤销日志再也退不回这一步（`pendingAssetDeletions.ts`）。
 * - 关闭的项目：原样保留完整 payload 只替换 generationCanvas.nodes，存盘后当场删文件（没有撤销可言）。
 * 两条路的「文件还有没有人用」都由 `buildAssetResultDeletionPlan` 判（画布 + 时间轴）。
 */
async function deleteAssetResultUnlocked(
  asset: AssetRef,
  loaded: ProjectExecutionContext | null,
): Promise<DeleteAssetResultOutcome> {
  const loadedProjectId = loaded ? loaded.binding.projectId : null
  const metadataProjectId = asset.origin.source === 'project' ? asset.origin.projectId : loadedProjectId
  // 「在画布 store 里改」只认发起删除时签发、且此刻仍有效的那个已加载项目；排队期间换了项目，
  // 原项目此刻已是关闭项目，走下面按项目读写盘的既有路径，绝不去改新项目的 store。
  const inLoadedStore = Boolean(metadataProjectId && metadataProjectId === loadedProjectId && isProjectExecutionContextCurrent(loaded ?? undefined))
  const outcome: DeleteAssetResultOutcome = { removedResultCount: 0, deletedFileCount: 0, failedFileCount: 0, deferredFileCount: 0 }

  if (inLoadedStore) {
    const store = useGenerationCanvasStore.getState()
    const plan = buildAssetResultDeletionPlan(asset, store.nodes, useWorkbenchStore.getState().timeline)
    if (plan.matches.length === 0) return outcome
    const barrierAt = getUndoJournalPosition()
    pushUndoSnapshot(store)
    const rollbacks = plan.matches.flatMap((match) => {
      const existing = store.nodes.find((node) => node.id === match.nodeId)
      if (!existing) return []
      return [{
        nodeId: match.nodeId,
        before: { result: existing.result, history: existing.history, status: existing.status, error: existing.error },
        applied: match.patch,
      }]
    })
    // 撤销点由上面那一下打（updateNode 只给提示词 / 标题 / meta 打点，结果字段不打）：一次删除 = 一个 ⌘Z。
    for (const match of plan.matches) store.updateNode(match.nodeId, match.patch)
    const deferred = plan.fileTarget
      ? { ...plan.fileTarget, journalGeneration: getUndoJournalGeneration(), journalPosition: getLatestUndoBarrierAbsolutePosition() }
      : null
    if (deferred) deferAssetFileDeletion(deferred)
    outcome.removedResultCount = plan.matches.length
    try {
      const persisted = await persistActiveWorkbenchProjectNow()
      if (!persisted || persisted.id !== metadataProjectId) {
        throw new Error(`Active project result deletion could not be persisted: ${metadataProjectId}`)
      }
    } catch (error) {
      rollbackAppliedPatches(rollbacks)
      if (deferred) forgetDeferredAssetDeletion(deferred)
      // 没删成就不该留下一个「撤销了也什么都不变」的空撤销步。
      dropUndoBarriersAfter(barrierAt)
      throw error
    }
    if (deferred) outcome.deferredFileCount = 1
    return outcome
  }

  if (!metadataProjectId) return outcome
  const project = await readLocalProjectAsync(metadataProjectId)
  if (!project) return outcome
  const plan = buildAssetResultDeletionPlan(asset, project.payload.generationCanvas.nodes, project.payload.timeline)
  if (plan.matches.length > 0) {
    await saveLocalProject(metadataProjectId, {
      ...project.payload,
      generationCanvas: {
        ...project.payload.generationCanvas,
        nodes: applyAssetResultDeletion(project.payload.generationCanvas.nodes, plan),
      },
    }, project.name)
    outcome.removedResultCount = plan.matches.length
  }
  if (!plan.fileTarget) return outcome
  const deleteFiles = getDesktopBridge()?.workspace?.deleteFiles
  if (!deleteFiles) return { ...outcome, failedFileCount: 1 }
  try {
    const result = await deleteFiles({ projectId: plan.fileTarget.projectId, relativePaths: [plan.fileTarget.relativePath] })
    return { ...outcome, deletedFileCount: result.deletedCount, failedFileCount: result.failedCount }
  } catch (error) {
    logRendererError('closed-project-asset-delete-failed', error)
    return { ...outcome, failedFileCount: 1 }
  }
}


/** loaded：发起删除那一刻签发的已加载项目（没有打开的项目 = null）；不再缺省读取「当前项目」。 */
export function deleteAssetResult(
  asset: AssetRef,
  loaded: ProjectExecutionContext | null,
): Promise<DeleteAssetResultOutcome> {
  const projectId = asset.origin.source === 'project' ? asset.origin.projectId : loaded?.binding.projectId
  if (!projectId) return deleteAssetResultUnlocked(asset, loaded)
  return serializeProjectDeletion(projectId, () => deleteAssetResultUnlocked(asset, loaded))
}
