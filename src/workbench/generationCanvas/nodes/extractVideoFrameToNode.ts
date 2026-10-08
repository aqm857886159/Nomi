// 「从视频抽首/尾帧 → 落独立图片节点」整动作（不碰 UI，浮条调用它）。
// 复用 M-A 的抽帧 IPC（window.nomiDesktop.video.extractFrame，which:'first'|'last'）——纯基建，
// 抽出的是真实图片 URL（nomi-local://），建一个**已带结果**的图片节点，用户可直接拿去当任何参考/首尾帧。
// 失败一律人话 toast、不冒充（resolver/IPC 已封死"视频/封面当首帧"）。
import { FOCUS_GENERATION_NODE_EVENT, resolveNodeVisualSize } from './nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { isProjectImportCancellation, withProjectAction } from '../../project/projectCanvasReadSurface'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import i18n from '../../../i18n'

export async function extractVideoFrameToNode(node: GenerationCanvasNode, which: 'first' | 'last', reportFeedback: (message: string) => void): Promise<void> {
  const videoUrl = node.result?.url
  if (node.result?.type !== 'video' || !videoUrl) return
  const label = i18n.t(`generationCommon.node.extractFrame.${which}`)

  // 动作起点签发原项目：抽帧落盘、落节点都只认这一份，换项目即取消（不在新项目落节点、不报迟到的错）。
  const project = withProjectAction((issued) => issued)
  if (!project) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.missingProject'))
    return
  }
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.desktopOnly'))
    return
  }

  let url: string
  try {
    const result = await extractFrame({ videoUrl, which, projectId: project.binding.projectId, projectBinding: project.binding })
    project.assertCurrent()
    url = result?.url || ''
  } catch (error) {
    if (project.signal.aborted || isProjectImportCancellation(error)) return
    reportFeedback(i18n.t('generationCommon.node.extractFrame.failed', {
        frame: label,
        message: error instanceof Error ? error.message : String(error),
      }))
    return
  }
  if (!url) {
    reportFeedback(i18n.t('generationCommon.node.extractFrame.empty', { frame: label }))
    return
  }

  const store = useGenerationCanvasStore.getState()
  const size = resolveNodeVisualSize(node)
  const created = store.addNode({
    kind: 'image',
    title: i18n.t('generationCommon.node.extractFrame.nodeTitle', {
      title: (node.title || i18n.t('generationCommon.node.extractFrame.defaultVideoTitle')).trim(),
      frame: label,
    }),
    position: {
      x: node.position.x + size.width + 64,
      y: node.position.y + (which === 'last' ? size.height / 2 + 24 : 0),
    },
    categoryId: node.categoryId,
  })
  // 抽出的帧本身就是成品图 → 直接落 result，新节点立即可见、可当参考，无需再生成。
  const createdAt = Date.now()
  store.updateNode(created.id, { result: { id: `frame-${which}-${createdAt}`, type: 'image', url, createdAt } })
  store.selectNode(created.id)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: created.id } }))
  }
}
