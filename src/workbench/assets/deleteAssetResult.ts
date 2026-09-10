import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge } from '../../desktop/bridge'
import { readLocalProjectAsync, saveLocalProject } from '../library/localProjectStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import type { AssetRef } from './assetTypes'
import { applyAssetResultDeletion, buildAssetResultDeletionPlan } from './assetResultDeletion'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { NodeResultLifecyclePatch } from '../generationCanvas/model/nodeResultLifecycle'

export type DeleteAssetResultOutcome = {
  removedResultCount: number
  deletedFileCount: number
  failedFileCount: number
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
 * 删除的是「一个生成结果」，不是整个节点。当前项目走画布 store，关闭的项目原样保留完整 payload
 * 只替换 generationCanvas.nodes；最后再删落盘文件，元数据与磁盘不会出现“文件先没了、项目仍引用”的窗口。
 */
async function deleteAssetResultUnlocked(
  asset: AssetRef,
  currentProjectId: string | null,
): Promise<DeleteAssetResultOutcome> {
  const metadataProjectId = asset.origin.source === 'project' ? asset.origin.projectId : currentProjectId
  let removedResultCount = 0

  if (metadataProjectId && metadataProjectId === currentProjectId) {
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

  const currentNodes = metadataProjectId === currentProjectId
    ? useGenerationCanvasStore.getState().nodes
    : []
  const fileTarget = buildAssetResultDeletionPlan(asset, currentNodes).fileTarget
  if (!fileTarget) return { removedResultCount, deletedFileCount: 0, failedFileCount: 0 }
  const deleteFiles = getDesktopBridge()?.workspace?.deleteFiles
  if (!deleteFiles) return { removedResultCount, deletedFileCount: 0, failedFileCount: 1 }
  const result = await deleteFiles({ projectId: fileTarget.projectId, relativePaths: [fileTarget.relativePath] })
  return {
    removedResultCount,
    deletedFileCount: result.deletedCount,
    failedFileCount: result.failedCount,
  }
}


export function deleteAssetResult(
  asset: AssetRef,
  currentProjectId = getDesktopActiveProjectId(),
): Promise<DeleteAssetResultOutcome> {
  const projectId = asset.origin.source === 'project' ? asset.origin.projectId : currentProjectId
  if (!projectId) return deleteAssetResultUnlocked(asset, currentProjectId)
  return serializeProjectDeletion(projectId, () => deleteAssetResultUnlocked(asset, currentProjectId))
}
