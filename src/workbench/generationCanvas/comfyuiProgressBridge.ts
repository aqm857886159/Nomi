// ComfyUI ws 进度事件 → 画布节点（P 轨渲染层桥，镜像 reviewEventBridge 的 init-once 形态）。
// 主进程 comfyuiProgressSocket 推 {kind: progress|preview|queue|done}；这里翻成
// setNodeProgress（文案必经 narrate 注册表，S2 纪律）+ 预览帧写会话级瞬态 store（绝不持久化）。
import { getDesktopBridge } from '../../desktop/bridge'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import { useNodeLivePreviewStore } from './store/nodeLivePreviewStore'
import { narrateProgress } from '../observability/narrate'

type ComfyuiProgressEventLike = {
  nodeId?: string
  promptId?: string
  kind?: string
  percent?: number
  currentClass?: string
  startedNodes?: number
  totalNodes?: number
  queueAhead?: number
  previewDataUrl?: string
}

let unsubscribe: (() => void) | null = null

export function initComfyuiProgressBridge(): void {
  if (unsubscribe) return
  const on = getDesktopBridge()?.tasks?.onComfyuiProgress
  if (!on) return
  unsubscribe = on((raw) => {
    const event = raw as ComfyuiProgressEventLike
    const nodeId = (event?.nodeId || '').trim()
    if (!nodeId) return
    const previews = useNodeLivePreviewStore.getState()
    if (event.kind === 'preview' && event.previewDataUrl) {
      previews.setPreview(nodeId, event.previewDataUrl)
      return
    }
    if (event.kind === 'done') {
      previews.clearPreview(nodeId)
      return
    }
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find((n) => n.id === nodeId)
    // 迟到帧（已取消/已终态）直接丢，别把 idle 节点又抬回 running。
    if (!node || (node.status !== 'running' && node.status !== 'queued')) return
    // setNodeProgress 是整体替换：必须带回 taskId(=prompt_id)，遮罩取消按钮靠它做定向取消。
    const taskId = (event.promptId || node.progress?.taskId || '').trim()
    if (event.kind === 'queue') {
      store.setNodeProgress(nodeId, {
        phase: 'comfyui-queued',
        percent: 0,
        ...(taskId ? { taskId } : {}),
        message: narrateProgress('comfyui-queued', { queueAhead: event.queueAhead }),
      })
      return
    }
    if (event.kind === 'progress') {
      store.setNodeProgress(nodeId, {
        phase: 'comfyui-node',
        ...(typeof event.percent === 'number' ? { percent: event.percent } : {}),
        ...(taskId ? { taskId } : {}),
        message: narrateProgress('comfyui-node', {
          currentClass: event.currentClass,
          startedNodes: event.startedNodes,
          totalNodes: event.totalNodes,
        }),
      })
    }
  })
}
