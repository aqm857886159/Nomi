import React from 'react'
import { useTranslation } from 'react-i18next'
import { persistNodeImageBlob, persistNodeImageFile } from '../adapters/persistNodeImage'
import { isProjectImportCancellation } from '../adapters/assetImportAdapter'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PanoramaScreenshot } from './PanoramaViewer'
import { computeMediaMetaPatch, mediaNodeSize } from './nodeSizing'

/**
 * 全景节点的两个回调（上传换图 / 视口截图建节点）从 BaseGenerationNode 抽出（R9 防巨壳）。
 * 逻辑、依赖数组逐字不动；store action 在 hook 内自订阅（selector 返回稳定引用，不引入额外 rerender）。
 */
export function useNodePanoramaHandlers(
  node: GenerationCanvasNode,
  visualSize: { width: number; height: number },
  reportFeedback: (message: string) => void,
): {
  handlePanoramaFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handlePanoramaScreenshot: (screenshot: PanoramaScreenshot, project: ProjectExecutionContext) => void
} {
  const { t } = useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)

  const handlePanoramaFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      const createdAt = Date.now()
      // 先落盘再写 store：全景是 8K 级大图，base64 进 store 会被逐次 JSON 深拷贝 + 随每次保存全量序列化。
      // （旧写法「先塞 base64 给即时预览、落盘后再换掉」正是「九宫格卡死」那条病的同款入口。）
      void withProjectAction(async (project) => {
        try {
          const localUrl = await persistNodeImageFile(file, node.id, project)
          project.assertCurrent()
          if (!localUrl) return
          updateNode(node.id, { result: { id: `panorama-asset-${createdAt}`, type: 'image', url: localUrl, createdAt } })
        } catch (error) {
          if (!project.signal.aborted && !isProjectImportCancellation(error)) reportFeedback(t('generationCommon.panorama.captureFailed'))
        }
      })
    },
    [node.id, updateNode, reportFeedback, t],
  )

  const handlePanoramaScreenshot = React.useCallback(
    async (screenshot: PanoramaScreenshot, project: ProjectExecutionContext) => {
      let screenshotNodeId: string | undefined
      try {
        project.assertCurrent()
        const { blob, dimensions } = screenshot
        const createdAt = Date.now()
        const screenshotNode = addNode({
          kind: 'asset',
          title: screenshot.title || t('generationCommon.node.panoramaScreenshotTitle'),
          prompt: screenshot.prompt || t('generationCommon.node.panoramaScreenshotPrompt'),
          position: {
            x: Math.round(node.position.x + visualSize.width + 80),
            y: Math.round(node.position.y),
          },
        })
        screenshotNodeId = screenshotNode.id
        // 落盘换 nomi-local:// 之后才写 store —— 截图这条路以前把整张 base64 留在 store 里**永不替换**，
        // 全景 8K 图一张就是十几 MB，随每次保存全量序列化（同「九宫格卡死」的病根）。
        const stored = await persistNodeImageBlob(blob, screenshotNode.id, `panorama-shot-${createdAt}.png`, project)
        project.assertCurrent()
        const result = {
          id: `panorama-shot-${screenshotNode.id}-${createdAt}`,
          type: 'image' as const,
          url: stored.url,
          createdAt,
        }
        const screenshotSize = mediaNodeSize(dimensions.width, dimensions.height)
        const mediaMeta = computeMediaMetaPatch({
          resultType: result.type,
          meta: screenshotNode.meta || {},
          width: dimensions.width,
          height: dimensions.height,
        })?.meta
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
            ...(mediaMeta || {}),
            source: screenshot.source || 'panorama-screenshot',
            sourceNodeId: node.id,
            localOnly: stored.localOnly,
            ...(stored.localOnly ? {} : { uploadStatus: 'uploaded' as const }),
          },
        })
        connectNodes(node.id, screenshotNode.id, 'reference', undefined, undefined, { provenance: true })
      } catch (error) {
        if (project.signal.aborted || isProjectImportCancellation(error)) return
        if (screenshotNodeId) updateNode(screenshotNodeId, { status: 'error', error: t('generationCommon.panorama.captureFailed') })
        reportFeedback(t('generationCommon.panorama.captureFailed'))
      }
    },
    [addNode, t, node.position.x, node.position.y, node.id, visualSize.width, updateNode, connectNodes, reportFeedback],
  )

  return { handlePanoramaFileChange, handlePanoramaScreenshot }
}
