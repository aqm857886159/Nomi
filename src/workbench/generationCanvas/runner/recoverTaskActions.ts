import { fetchWorkbenchTaskResultByVendor, type TaskResultDto } from '../../api/taskApi'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { narrateProgress } from '../../observability/narrate'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { asTrimmedString, resolveTaskKind, selectedModelKey, selectedVendor } from './catalogTaskResolve'
import { normalizeCatalogTaskResult } from './catalogTaskResultParse'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])
const RECOVER_POLL_INTERVAL_MS = 3000
// 找回轮询自己的上限（10 分钟）：超了仍没终态 → 退回 recoverable，按钮重现，让用户稍后再试。
const RECOVER_POLL_TIMEOUT_MS = 600000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

/** 从一个 recoverable 节点重建续查所需的 {taskId, vendor, taskKind, modelKey}（全在节点上，taskId 已落盘）。 */
function buildRecoverPayload(nodeId: string): { taskId: string; vendor: string; taskKind: ReturnType<typeof resolveTaskKind>; prompt: string; modelKey: string } | null {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null
  const taskId = asTrimmedString(node.runs?.[0]?.taskId) || asTrimmedString(node.progress?.taskId)
  const vendor = selectedVendor(node)
  if (!taskId || !vendor) return null
  // 用同一套 reference 解析还原原始 granular kind（image_to_video vs text_to_video…），
  // 让主进程 findTaskMapping 命中与首发同一个 query 桶。
  const references = resolveGenerationReferences(node, { nodes: state.nodes, edges: state.edges })
  return {
    taskId,
    vendor,
    taskKind: resolveTaskKind(node, references),
    prompt: asTrimmedString(node.prompt),
    modelKey: selectedModelKey(node) || '',
  }
}

/**
 * 重新拉取一个超时找回态节点的结果（query，不是 generate → 不铸付费令牌、不弹确认）。
 * 主进程 fetchTaskResult 在内存缓存 miss 时用 {vendor,modelKey,taskKind,taskId} 无状态重建查询，
 * 故重启 App 后仍可拉回。拉取期间节点显示 running（品牌 logo 转圈），出片 addNodeResult 回节点。
 */
export async function recoverNodeResult(nodeId: string): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const payload = buildRecoverPayload(id)
  const store = useGenerationCanvasStore.getState()
  if (!payload) {
    store.setNodeStatus(id, 'error', '无法找回：缺少任务标识（taskId）或模型信息，请重新生成。')
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
    message: '正在重新拉取结果…',
    taskId: payload.taskId,
  })

  const startedAt = Date.now()
  let current: TaskResultDto | null = null
  try {
    while (true) {
      const response = await fetchWorkbenchTaskResultByVendor({
        taskId: payload.taskId,
        vendor: payload.vendor,
        taskKind: payload.taskKind,
        prompt: payload.prompt || null,
        modelKey: payload.modelKey || null,
      })
      current = response.result
      if (TERMINAL_STATUSES.has(current.status)) break
      if (Date.now() - startedAt > RECOVER_POLL_TIMEOUT_MS) {
        // 仍没出来 → 退回可找回态，按钮重现，稍后可再拉。
        useGenerationCanvasStore.getState().setNodeStatus(id, 'recoverable', '任务仍在上游进行，请稍后再次拉取。')
        return
      }
      useGenerationCanvasStore.getState().setNodeProgress(id, {
        runId,
        phase: 'still-generating',
        message: narrateProgress('still-generating', { elapsedMs: Date.now() - startedAt }),
        taskId: payload.taskId,
      })
      await delay(RECOVER_POLL_INTERVAL_MS)
    }
  } catch (error) {
    // 网络/查询本身报错 → 退回可找回态（不是真失败），让用户能再点。
    const message = error instanceof Error && error.message ? error.message : '拉取结果失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'recoverable', message)
    return
  }

  const liveNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
  if (!liveNode || !current) return
  try {
    const normalized = normalizeCatalogTaskResult(current, liveNode)
    useGenerationCanvasStore.getState().addNodeResult(id, normalized)
    await persistActiveWorkbenchProjectNow().catch(() => {})
  } catch (error) {
    // 终态是 failed（normalizeCatalogTaskResult 对 failed 抛错）→ 这才是真失败，落 error 桶。
    const message = error instanceof Error && error.message ? error.message : '生成失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', message)
  }
}

/** 放弃找回：用户明确把这个超时节点标为失败（进红色错误桶，可重试生成）。 */
export function dismissRecoverableNode(nodeId: string): void {
  const id = String(nodeId || '').trim()
  if (!id) return
  useGenerationCanvasStore.getState().setNodeStatus(id, 'error', '已标记为失败：生成超时，未找回结果。可重新生成。')
}
