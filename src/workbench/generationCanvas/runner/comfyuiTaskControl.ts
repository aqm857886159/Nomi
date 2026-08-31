// ComfyUI 任务的取消登记 + ws 进度 watch 帮手（P 轨 · 2026-08-01 拍板遮罩取消）。
// 取消语义：① 新服定向 jobs cancel，旧服只安全删除排队项 ② 本地登记 nodeId → 轮询下一 tick
// 抛 ComfyuiTaskCancelledError（免费查询即刻停，不等 20min 硬超时）③ setNodeStatus(id,'idle') 走
// 既有 cancelled 语义（canvasRunActions：最新 run 标 cancelled、节点回 idle，不进红色错误桶）。
import { getDesktopBridge } from '../../../desktop/bridge'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useComfyuiPreviewStore } from '../store/comfyuiPreviewStore'
import { toast } from '../../../ui/toast'
import i18n from '../../../i18n'

const cancelRequested = new Set<string>()

export class ComfyuiTaskCancelledError extends Error {
  constructor() {
    super('已取消')
    this.name = 'ComfyuiTaskCancelledError'
  }
}

export function isComfyuiTaskCancelledError(error: unknown): error is ComfyuiTaskCancelledError {
  return error instanceof Error && error.name === 'ComfyuiTaskCancelledError'
}

export function isComfyuiCancelRequested(nodeId: string): boolean {
  return cancelRequested.has(nodeId)
}

export function clearComfyuiCancel(nodeId: string): void {
  cancelRequested.delete(nodeId)
}

/** 遮罩取消按钮入口。prompt_id 优先读 node.progress.taskId，回落 runs[0].taskId（progress 是整体替换、run 是保底）。 */
export function requestComfyuiCancel(node: {
  id: string
  progress?: { taskId?: string } | null
  runs?: Array<{ taskId?: string }> | null
}): void {
  cancelRequested.add(node.id)
  const promptId = (node.progress?.taskId || node.runs?.[0]?.taskId || '').trim()
  const tasks = getDesktopBridge()?.tasks
  if (promptId) {
    void tasks?.comfyuiInterrupt?.(promptId)
      .then((result) => {
        if (result.mode === 'queue-only') toast(i18n.t('generationCommon.comfyuiCancel.queueOnly'), 'warning')
        else if (!result.ok) toast(i18n.t('generationCommon.comfyuiCancel.failed'), 'warning')
      })
      .catch(() => toast(i18n.t('generationCommon.comfyuiCancel.failed'), 'warning'))
      .finally(() => { void tasks?.comfyuiUnwatch?.(promptId).catch(() => undefined) })
  }
  useComfyuiPreviewStore.getState().clearPreview(node.id)
  useGenerationCanvasStore.getState().setNodeStatus(node.id, 'idle')
}

/** 提交拿到 prompt_id 后登记 ws 进度（fire-and-forget：桥不在/失败 = 没有进度，轮询照常兜底）。 */
export async function watchComfyuiProgress(payload: {
  promptId: string
  nodeId: string
  projectId?: string
  taskKind?: string
  modelKey?: string | null
  /** 多实例：跑这个任务的那台 ComfyUI 的 vendorKey。 */
  vendorKey?: string
}): Promise<boolean> {
  try {
    const result = await getDesktopBridge()?.tasks?.comfyuiWatch?.(payload)
    return Boolean(result?.ok)
  } catch {
    return false
  }
}

export function unwatchComfyuiProgress(promptId: string): void {
  void getDesktopBridge()?.tasks?.comfyuiUnwatch?.(promptId).catch(() => undefined)
}
