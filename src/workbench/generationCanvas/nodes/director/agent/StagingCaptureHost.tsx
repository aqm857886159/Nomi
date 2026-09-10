/**
 * [INPUT]: 依赖 react、react-i18next、../../../store/generationCanvasStore、../../../model/generationCanvasTypes、../bridge/persistOutputs 的 persistDirectorScreenshot、
 *          ../model/directorProject 的 normalizeDirectorProject、../model/directorIds 的 createOutputId、../model/directorNodeMeta 的 meta 键、./createStagingReferenceNode 的 readStagingAutoCapture、./DirectorHeadlessCapture
 * [OUTPUT]: 对外提供 StagingCaptureHost：常驻挂在画布上，扫到带 stagingAutoCapture 的 director 节点 → 离屏出一张站位图 → 落 image 节点 +
 *          连 director→image(reference) + image→镜头(composition_ref) → 截图写回工程 outputs.screenshots + 清标志
 * [POS]: director/agent 的 create_staging_reference 执行下半场。常驻而不挂在节点里：React Flow 只渲染视口内节点，挂节点里的截图永不触发（V1 根因，入籍保留）。
 *        一次只处理一个节点；结果处理失败也清标志，不让 Host 卡死。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { persistDirectorScreenshot } from '../bridge/persistOutputs'
import { createOutputId } from '../model/directorIds'
import { DIRECTOR_NODE_KIND, DIRECTOR_PROJECT_META_KEY, STAGING_AUTO_CAPTURE_META_KEY } from '../model/directorNodeMeta'
import { normalizeDirectorProject } from '../model/directorProject'
import type { DirectorProject } from '../model/directorTypes'
import { readStagingAutoCapture } from './createStagingReferenceNode'
import { DirectorHeadlessCapture, type HeadlessCaptureResult } from './DirectorHeadlessCapture'

const STILL_TIMES = [0]

function imageNodeSize(width: number, height: number): { width: number; height: number; previewHeight: number } {
  const aspectRatio = width / Math.max(1, height)
  const nodeWidth = aspectRatio >= 1.75 ? 420 : aspectRatio <= 0.72 ? 260 : 340
  const previewHeight = Math.min(520, Math.max(120, Math.round(nodeWidth / Math.max(0.01, aspectRatio))))
  return { width: nodeWidth, height: previewHeight, previewHeight }
}

function isPendingStaging(node: GenerationCanvasNode): boolean {
  return node.kind === DIRECTOR_NODE_KIND && readStagingAutoCapture(node) !== null
}

/** 截图写回工程产物清单（与全屏壳的截图同口径：只存资产句柄） */
function projectWithScreenshot(project: DirectorProject, name: string, assetUrl: string): DirectorProject {
  const cameraName = project.scenes[0]?.cameras[0]?.name ?? ''
  const output = { id: createOutputId(), name, cameraName, assetUrl, createdAt: Date.now() }
  return { ...project, outputs: { ...project.outputs, screenshots: [output, ...project.outputs.screenshots] } }
}

export function StagingCaptureHost(): JSX.Element | null {
  const { t } = useTranslation()
  const pendingNode = useGenerationCanvasStore((state) => state.nodes.find(isPendingStaging) ?? null)
  const processingRef = React.useRef<string | null>(null)

  const handleResult = React.useCallback(
    async (nodeId: string, capture: HeadlessCaptureResult | null) => {
      const store = useGenerationCanvasStore.getState()
      const node = store.nodes.find((candidate) => candidate.id === nodeId)
      const staging = node ? readStagingAutoCapture(node) : null
      const clearFlag = () => {
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        if (!current) return
        const meta = { ...(current.meta || {}) }
        delete meta[STAGING_AUTO_CAPTURE_META_KEY]
        useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
      }
      try {
        if (!node || !capture || capture.frames.length === 0) return
        const title = t('director.agent.stagingReference')
        const persisted = await persistDirectorScreenshot(capture.frames[0], nodeId, title)
        const createdAt = Date.now()
        const imageNode = store.addNode({
          kind: 'image',
          title,
          prompt: t('director.agent.stagingPrompt'),
          position: { x: Math.round(node.position.x + 380), y: Math.round(node.position.y) },
        })
        const size = imageNodeSize(capture.width, capture.height)
        const result = { id: `staging-shot-${imageNode.id}-${createdAt}`, type: 'image' as const, url: persisted.url, assetId: persisted.assetId, raw: persisted.raw, createdAt }
        store.updateNode(imageNode.id, {
          result,
          history: [result],
          status: 'success',
          size: { width: size.width, height: size.height },
          meta: {
            ...(imageNode.meta || {}),
            source: 'director-camera',
            sourceNodeId: nodeId,
            // 站位构图图：被当 composition_ref 喂关键帧时触发「构图控制 + 写实重渲染」提示词后缀
            stagingComposition: true,
            localOnly: persisted.localOnly,
            imageWidth: capture.width,
            imageHeight: capture.height,
            imageAspectRatio: capture.width / Math.max(1, capture.height),
            previewHeight: size.previewHeight,
          },
        })
        store.connectNodes(nodeId, imageNode.id, 'reference')
        if (staging?.targetNodeId) store.connectNodes(imageNode.id, staging.targetNodeId, 'composition_ref')
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        const project = normalizeDirectorProject(current?.meta?.[DIRECTOR_PROJECT_META_KEY] ?? node.meta?.[DIRECTOR_PROJECT_META_KEY])
        store.updateNode(nodeId, { meta: { ...(current?.meta || node.meta || {}), [DIRECTOR_PROJECT_META_KEY]: projectWithScreenshot(project, title, persisted.url) } })
      } finally {
        clearFlag()
        processingRef.current = null
      }
    },
    [t],
  )

  const nodeId = pendingNode?.id ?? null
  const project = React.useMemo(
    () => (pendingNode ? normalizeDirectorProject(pendingNode.meta?.[DIRECTOR_PROJECT_META_KEY]) : null),
    // 只在换节点时重建工程：出图期间节点 meta 的其它写入不该重挂离屏画布
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeId],
  )
  const onResult = React.useCallback((result: HeadlessCaptureResult | null) => {
    if (nodeId) void handleResult(nodeId, result)
  }, [handleResult, nodeId])

  if (!pendingNode || !project || !nodeId) return null
  if (processingRef.current && processingRef.current !== nodeId) return null
  processingRef.current = nodeId
  return <DirectorHeadlessCapture key={nodeId} project={project} times={STILL_TIMES} onResult={onResult} />
}
