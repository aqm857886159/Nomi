// 「从视频抽首/尾帧 → 落独立图片节点」整动作（不碰 UI，浮条调用它）。
// 复用 M-A 的抽帧 IPC（window.nomiDesktop.video.extractFrame，which:'first'|'last'）——纯基建，
// 抽出的是真实图片 URL（nomi-local://），建一个**已带结果**的图片节点，用户可直接拿去当任何参考/首尾帧。
// 失败一律人话 toast、不冒充（resolver/IPC 已封死"视频/封面当首帧"）。
import { getNodeSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export async function extractVideoFrameToNode(node: GenerationCanvasNode, which: 'first' | 'last'): Promise<void> {
  const videoUrl = node.result?.url
  if (node.result?.type !== 'video' || !videoUrl) return
  const label = which === 'first' ? '首帧' : '尾帧'

  const projectId = getActiveWorkbenchProjectId()
  if (!projectId) { toast('抽帧失败：找不到当前项目（请先保存项目后重试）', 'error'); return }
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) { toast('抽帧失败：当前环境不支持（需桌面端）', 'error'); return }

  let url: string
  try {
    const result = await extractFrame({ videoUrl, which, projectId })
    url = result?.url || ''
  } catch (error) {
    toast(`抽${label}失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    return
  }
  if (!url) { toast(`抽${label}失败：未能从视频取到帧`, 'error'); return }

  const store = useGenerationCanvasStore.getState()
  const size = getNodeSize(node)
  const created = store.addNode({
    kind: 'image',
    title: `${(node.title || '视频').trim()}·${label}`,
    position: { x: node.position.x + size.width + 64, y: node.position.y + (which === 'last' ? size.height / 2 + 24 : 0) },
    categoryId: node.categoryId,
  })
  // 抽出的帧本身就是成品图 → 直接落 result，新节点立即可见、可当参考，无需再生成。
  const createdAt = Date.now()
  store.updateNode(created.id, { result: { id: `frame-${which}-${createdAt}`, type: 'image', url, createdAt } })
  store.selectNode(created.id)
}
