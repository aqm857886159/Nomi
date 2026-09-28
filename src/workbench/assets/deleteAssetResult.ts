import { getDesktopBridge } from '../../desktop/bridge'
import { readLocalProjectAsync, saveLocalProject } from '../library/localProjectStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import type { AssetRef } from './assetTypes'
import { applyAssetResultDeletion, buildAssetResultDeletionPlan } from './assetResultDeletion'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { NodeResultLifecyclePatch } from '../generationCanvas/model/nodeResultLifecycle'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { registerUndoHistoryEvictionHandler } from '../generationCanvas/events/canvasUndoJournal'

export type DeleteAssetResultOutcome = {
  removedResultCount: number
  deletedFileCount: number
  failedFileCount: number
}

const deletionQueues = new Map<string, Promise<void>>()
type PendingFileDeletion = { projectId: string; relativePath: string }
const pendingFileDeletions = new Map<string, PendingFileDeletion>()

function pendingDeletionKey(target: PendingFileDeletion): string {
  return `${target.projectId}\u0000${target.relativePath}`
}

export function queuePendingAssetDeletion(target: PendingFileDeletion): void {
  pendingFileDeletions.set(pendingDeletionKey(target), target)
}

export async function flushPendingAssetDeletions(): Promise<{ deletedFileCount: number; failedFileCount: number }> {
  const liveNodes = useGenerationCanvasStore.getState().nodes
  const targets = [...pendingFileDeletions.values()].filter((target) => !liveNodes.some((node) => {
    return [node.result, ...(node.history ?? [])].some((result) => {
      if (!result) return false
      return [result.url, result.thumbnailUrl].some((url) => typeof url === 'string' && url.includes(target.relativePath))
    })
  }))
  const retained = [...pendingFileDeletions.values()].filter((target) => !targets.includes(target))
  pendingFileDeletions.clear()
  for (const target of retained) pendingFileDeletions.set(pendingDeletionKey(target), target)
  const deleteFiles = getDesktopBridge()?.workspace?.deleteFiles
  if (!deleteFiles) return { deletedFileCount: 0, failedFileCount: targets.length }
  let deletedFileCount = 0
  let failedFileCount = 0
  for (const target of targets) {
    try {
      const result = await deleteFiles({ projectId: target.projectId, relativePaths: [target.relativePath] })
      deletedFileCount += result.deletedCount
      failedFileCount += result.failedCount
    } catch {
      failedFileCount += 1
    }
  }
  return { deletedFileCount, failedFileCount }
}

registerUndoHistoryEvictionHandler(() => { void flushPendingAssetDeletions() })

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
 * 删除的是「一个生成结果」，不是整个节点。当前项目走画布 store，关闭的项目原样保留完整 payload
 * 只替换 generationCanvas.nodes；最后再删落盘文件，元数据与磁盘不会出现“文件先没了、项目仍引用”的窗口。
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
  let removedResultCount = 0

  if (inLoadedStore) {
    const store = useGenerationCanvasStore.getState()
    const plan = buildAssetResultDeletionPlan(asset, store.nodes)
    const rollbacks = plan.matches.flatMap((match) => {
      const existing = store.nodes.find((node) => node.id === match.nodeId)
      if (!existing) return []
      return [{
        nodeId: match.nodeId,
        before: {
          result: existing.result,
          history: existing.history,
          status: existing.status,
          error: existing.error,
        },
        applied: match.patch,
      }]
    })
    for (const match of plan.matches) store.updateNode(match.nodeId, match.patch)
    removedResultCount += plan.matches.length
    if (plan.matches.length > 0) {
      try {
        const persisted = await persistActiveWorkbenchProjectNow()
        if (!persisted || persisted.id !== metadataProjectId) {
          throw new Error(`Active project result deletion could not be persisted: ${metadataProjectId}`)
        }
      } catch (error) {
        rollbackAppliedPatches(rollbacks)
        throw error
      }
    }
  } else if (metadataProjectId) {
    const project = await readLocalProjectAsync(metadataProjectId)
    if (project) {
      const plan = buildAssetResultDeletionPlan(asset, project.payload.generationCanvas.nodes)
      if (plan.matches.length > 0) {
        await saveLocalProject(metadataProjectId, {
          ...project.payload,
          generationCanvas: {
            ...project.payload.generationCanvas,
            nodes: applyAssetResultDeletion(project.payload.generationCanvas.nodes, plan),
          },
        }, project.name)
        removedResultCount += plan.matches.length
      }
    }
  }

  const currentNodes = inLoadedStore && isProjectExecutionContextCurrent(loaded ?? undefined)
    ? useGenerationCanvasStore.getState().nodes
    : []
  const fileTarget = buildAssetResultDeletionPlan(asset, currentNodes).fileTarget
  if (!fileTarget) return { removedResultCount, deletedFileCount: 0, failedFileCount: 0 }
  queuePendingAssetDeletion(fileTarget)
  return { removedResultCount, deletedFileCount: 0, failedFileCount: 0 }
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
