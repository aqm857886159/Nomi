// 「把选中的切镜落成画布节点」整动作（不碰 UI，面板调用它）。
//
// 复用 extractVideoFrame 那条现成 IPC（which 传秒数——它本来就吃 'first'|'last'|number），
// 逐个抽成真图片节点，最后**自动编成一组**（用户 2026-08-02 拍板）：拆出来的一场戏立刻能整组运行、
// 也能一根线连到组上一次喂参考（见 model/groupInputLinks.ts）。
//
// 抽帧是逐个 ffmpeg，几十张会花点时间 → 串行 + 逐个报进度，别一次并发几十个进程把机器打满。
import { resolveNodeVisualSize } from './nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { formatShotTimestamp, shotCutNodePositions } from './shotCutSelection'
import i18n from '../../../i18n'

export type ExtractShotCutsProgress = { done: number; total: number }

export async function extractShotCutsToNodes(params: {
  node: GenerationCanvasNode
  seconds: readonly number[]
  onProgress?: (progress: ExtractShotCutsProgress) => void
}): Promise<{ created: number; failed: number }> {
  const { node, seconds, onProgress } = params
  const videoUrl = node.result?.url
  if (node.result?.type !== 'video' || !videoUrl || !seconds.length) return { created: 0, failed: 0 }

  const projectId = getActiveWorkbenchProjectId()
  if (!projectId) {
    toast(i18n.t('generationCommon.node.extractFrame.missingProject'), 'error')
    return { created: 0, failed: 0 }
  }
  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) {
    toast(i18n.t('generationCommon.node.extractFrame.desktopOnly'), 'error')
    return { created: 0, failed: 0 }
  }

  const size = resolveNodeVisualSize(node)
  const positions = shotCutNodePositions({ origin: node.position, sourceSize: size, count: seconds.length })
  const sourceTitle = (node.title || i18n.t('generationCommon.node.extractFrame.defaultVideoTitle')).trim()

  const createdIds: string[] = []
  let failed = 0
  for (let i = 0; i < seconds.length; i += 1) {
    const at = seconds[i] as number
    onProgress?.({ done: i, total: seconds.length })
    let url: string
    try {
      const result = await extractFrame({ videoUrl, which: at, projectId })
      url = result?.url || ''
    } catch {
      // 单帧失败不该毁掉整批：记数，最后一条 toast 说清「几张没成」。
      failed += 1
      continue
    }
    if (!url) { failed += 1; continue }
    const created = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: i18n.t('generationCommon.node.shotCuts.nodeTitle', { title: sourceTitle, time: formatShotTimestamp(at) }),
      position: positions[i] ?? node.position,
      // 成组紧凑布局：信任算好的坐标，跳过逐卡碰撞避让（否则会被推散成一片，切图九宫格栽过）。
      exactPosition: true,
      categoryId: node.categoryId,
    })
    const createdAt = Date.now()
    useGenerationCanvasStore.getState().updateNode(created.id, {
      result: { id: `shotcut-${Math.round(at * 1000)}-${createdAt}`, type: 'image', url, createdAt },
    })
    createdIds.push(created.id)
  }
  onProgress?.({ done: seconds.length, total: seconds.length })

  if (createdIds.length) {
    // 自动成一组：拆出来的一整场戏立刻能整组运行 / 一根线喂满（拍板 2026-08-02）。
    const latest = useGenerationCanvasStore.getState()
    const group = latest.createGroup(node.categoryId || 'shots', i18n.t('generationCommon.node.shotCuts.groupName', { title: sourceTitle }))
    if (group) {
      for (const id of createdIds) useGenerationCanvasStore.getState().moveNodeToGroup(id, group.id)
    }
    useGenerationCanvasStore.getState().selectNodes(createdIds)
  }

  if (failed > 0) {
    toast(i18n.t('generationCommon.node.shotCuts.someFailed', { failed, created: createdIds.length }), 'error')
  }
  return { created: createdIds.length, failed }
}
