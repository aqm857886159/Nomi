import React from 'react'
import { toast } from '../../../ui/toast'
import { persistNodeImageFile } from '../adapters/persistNodeImage'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PanoramaScreenshot } from './PanoramaViewer'
import { mediaNodeSize } from './nodeSizing'

/**
 * 全景节点的两个回调（上传换图 / 视口截图建节点）从 BaseGenerationNode 抽出（R9 防巨壳）。
 * 逻辑、依赖数组逐字不动；store action 在 hook 内自订阅（selector 返回稳定引用，不引入额外 rerender）。
 */
export function useNodePanoramaHandlers(
  node: GenerationCanvasNode,
  visualSize: { width: number; height: number },
): {
  handlePanoramaFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handlePanoramaScreenshot: (screenshot: PanoramaScreenshot) => void
} {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)

  const handlePanoramaFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      const createdAt = Date.now()
      // 即时 base64 预览（短命）→ 落盘换 nomi-local 替换，避免全景大图 base64 永久驻留。
      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const dataUrl = loadEvent.target?.result
        if (typeof dataUrl !== 'string') return
        updateNode(node.id, { result: { id: `panorama-${createdAt}`, type: 'image', url: dataUrl, createdAt } })
      }
      reader.readAsDataURL(file)
      void persistNodeImageFile(file, node.id).then((localUrl) => {
        if (!localUrl) return
        updateNode(node.id, { result: { id: `panorama-asset-${createdAt}`, type: 'image', url: localUrl, createdAt } })
      })
    },
    [node.id, updateNode],
  )

  const handlePanoramaScreenshot = React.useCallback(
    (screenshot: PanoramaScreenshot) => {
      const { dataUrl, dimensions } = screenshot
      const createdAt = Date.now()
      const screenshotNode = addNode({
        kind: 'asset',
        title: screenshot.title || '全景截图',
        prompt: screenshot.prompt || '全景视口截图',
        position: {
          x: Math.round(node.position.x + visualSize.width + 80),
          y: Math.round(node.position.y),
        },
      })
      const result = {
        id: `panorama-shot-${screenshotNode.id}-${createdAt}`,
        type: 'image' as const,
        url: dataUrl,
        createdAt,
      }
      const screenshotSize = mediaNodeSize(dimensions.width, dimensions.height)
      updateNode(screenshotNode.id, {
        result,
        history: [result],
        status: 'success',
        ...(screenshotSize
          ? {
              size: {
                width: screenshotSize.width,
                height: screenshotSize.height,
              },
            }
          : {}),
        meta: {
          ...(screenshotNode.meta || {}),
          source: screenshot.source || 'panorama-screenshot',
          sourceNodeId: node.id,
          localOnly: true,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
          imageAspectRatio: dimensions.width / Math.max(1, dimensions.height),
        },
      })
      connectNodes(node.id, screenshotNode.id, 'reference')
      toast('已创建全景截图节点', 'success')
    },
    [addNode, node.id, node.position.x, node.position.y, connectNodes, updateNode, visualSize.width],
  )

  return { handlePanoramaFileChange, handlePanoramaScreenshot }
}
