// Local task cancellation shares one node registry; each backend owns its actual interrupt.
// 取消语义：① 新服定向 jobs cancel，旧服只安全删除排队项 ② 本地登记 nodeId → 轮询下一 tick
// 抛 LocalTaskCancelledError（免费查询即刻停，不等 20min 硬超时）③ setNodeStatus(id,'idle') 走
// 既有 cancelled 语义（canvasRunActions：最新 run 标 cancelled、节点回 idle，不进红色错误桶）。
import { getDesktopBridge } from '../../../desktop/bridge'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useNodeLivePreviewStore } from '../store/nodeLivePreviewStore'
import { isLocalProcessingProgressPhase } from '../model/localProcessingPhase'
import { notify } from '../../../ui/notificationPolicy'
import i18n from '../../../i18n'

const cancelRequested = new Set<string>()
/** 正在等主进程回音的 await（查结果、提交、落地）：停止请求一到就通知它们，不等下一轮轮询。 */
const cancelListeners = new Map<string, Set<() => void>>()

function markTaskCancelRequested(nodeId: string): void {
  cancelRequested.add(nodeId)
  for (const listener of [...(cancelListeners.get(nodeId) ?? [])]) listener()
}

/**
 * 订阅这个节点的「停止」请求（已经请求过就立刻回调一次），返回退订函数。
 *
 * 为什么要它（2026-09-28）：以前取消只是在集合里记一笔，轮询在每一轮开头问一次——节点卡在一次永远不返回的
 * 查结果 IPC 上时，「下一轮」永远不来，停止按钮按了等于没按。现在正在等的那个 await 订阅这里，一叫停立刻结束。
 */
export function onTaskCancelRequested(nodeId: string, listener: () => void): () => void {
  if (cancelRequested.has(nodeId)) {
    listener()
    return () => {}
  }
  let listeners = cancelListeners.get(nodeId)
  if (!listeners) {
    listeners = new Set()
    cancelListeners.set(nodeId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = cancelListeners.get(nodeId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) cancelListeners.delete(nodeId)
  }
}

export class LocalTaskCancelledError extends Error {
  constructor() {
    super('已取消')
    this.name = 'LocalTaskCancelledError'
  }
}

export function isLocalTaskCancelledError(error: unknown): error is LocalTaskCancelledError {
  return error instanceof Error && error.name === 'LocalTaskCancelledError'
}

export function isTaskCancelRequested(nodeId: string): boolean {
  return cancelRequested.has(nodeId)
}

export function clearTaskCancel(nodeId: string): void {
  cancelRequested.delete(nodeId)
}

/** 遮罩取消按钮入口。prompt_id 优先读 node.progress.taskId，回落 runs[0].taskId（progress 是整体替换、run 是保底）。 */
export function requestTaskCancel(node: {
  id: string
  progress?: { phase?: string; taskId?: string } | null
  runs?: Array<{ taskId?: string }> | null
}, present: (message: string) => void): void {
  present('')
  const report = (reason: 'failed' | 'queueOnly') => notify({
    identity: `task-cancel:${node.id}`, reason, level: 'inline', present,
    message: reason === 'failed' ? i18n.t('generationCommon.comfyuiCancel.failed') : i18n.t('generationCommon.comfyuiCancel.queueOnly'), type: 'warning',
  })
  // 本地深度处理没有 taskId（它不是一次「任务」，是一段跑在本机的处理），所以它只需要
  // 把登记放下——编排每批之间会问一次 isTaskCancelRequested。**这里不改节点状态**：
  // 收摊要做的事是把那个还没出片的派生节点删掉（startVideoDepthDerivation），
  // 在这里顺手把它翻成 idle 只会留下一张永远空着的卡。
  if (isLocalProcessingProgressPhase(node.progress?.phase)) {
    markTaskCancelRequested(node.id)
    useNodeLivePreviewStore.getState().clearPreview(node.id)
    return
  }
  const promptId = (node.progress?.taskId || node.runs?.[0]?.taskId || '').trim()
  const tasks = getDesktopBridge()?.tasks
  if (promptId.startsWith('local-')) {
    void tasks?.cancel?.(promptId).then((result) => {
      if (!result.ok) report('failed')
      else {
        const store = useGenerationCanvasStore.getState()
        const current = store.nodes.find((candidate) => candidate.id === node.id)
        if ((current?.progress?.taskId || current?.runs?.[0]?.taskId) !== promptId) return
        if (current?.status === 'running') markTaskCancelRequested(node.id)
        store.setNodeStatus(node.id, 'idle')
      }
    }).catch(() => report('failed'))
    return
  }
  markTaskCancelRequested(node.id)
  if (promptId) {
    void tasks?.comfyuiInterrupt?.(promptId)
      .then((result) => {
        if (result.mode === 'queue-only') report('queueOnly')
        else if (!result.ok) report('failed')
      })
      .catch(() => report('failed'))
      .finally(() => { void tasks?.comfyuiUnwatch?.(promptId).catch(() => undefined) })
  }
  useNodeLivePreviewStore.getState().clearPreview(node.id)
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
