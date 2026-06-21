// 站位参考的全局出图 Host：常驻挂载（不随画布节点剔除），扫描带 meta.stagingAutoCapture 的
// scene3d 节点 → 离屏渲染出图 → 落 image 节点 + 连 scene3d→image(reference) + image→镜头(composition_ref)
// → 写回缩略图 + 清标志。把 auto-capture 从「依赖节点在视口」的 Scene3DEditor 里抽出来（根因修复：
// 自研画布会剔除离屏节点，挂在节点里的截图永不触发）。create_staging_reference 工具的执行下半场。
import React from 'react'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { normalizeScene3DState } from './scene3dSerializer'
import { persistScene3DScreenshot } from './scene3dScreenshot'
import { Scene3DAutoCapture } from './Scene3DAutoCapture'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { Scene3DCaptureResult } from './scene3dTypes'

type StagingAutoCapture = { targetNodeId?: string }

function readStaging(node: GenerationCanvasNode): StagingAutoCapture | null {
  const raw = node.meta?.stagingAutoCapture
  return raw && typeof raw === 'object' ? (raw as StagingAutoCapture) : null
}

function imageNodeSize(width: number, height: number): { width: number; height: number; previewHeight: number } {
  const aspectRatio = width / Math.max(1, height)
  const nodeWidth = aspectRatio >= 1.75 ? 420 : aspectRatio <= 0.72 ? 260 : 340
  const previewHeight = Math.min(520, Math.max(120, Math.round(nodeWidth / Math.max(0.01, aspectRatio))))
  return { width: nodeWidth, height: previewHeight, previewHeight }
}

export function StagingCaptureHost(): JSX.Element | null {
  const pendingNode = useGenerationCanvasStore((state) =>
    state.nodes.find((node) => node.kind === 'scene3d' && readStaging(node) !== null) ?? null,
  )
  const processingRef = React.useRef<string | null>(null)

  const handleResult = React.useCallback(
    async (nodeId: string, capture: Scene3DCaptureResult | null) => {
      const store = useGenerationCanvasStore.getState()
      const node = store.nodes.find((candidate) => candidate.id === nodeId)
      const staging = node ? readStaging(node) : null
      const clearFlag = () => {
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        if (!current) return
        const meta = { ...(current.meta || {}) }
        delete (meta as Record<string, unknown>).stagingAutoCapture
        useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
      }
      try {
        if (!node || !capture) return
        const persisted = await persistScene3DScreenshot(capture.dataUrl, nodeId, capture.title)
        const createdAt = Date.now()
        const imageNode = store.addNode({
          kind: 'image',
          title: '站位参考',
          prompt: '3D 站位参考（站位 + 动作 + 机位）',
          position: { x: Math.round(node.position.x + 380), y: Math.round(node.position.y) },
        })
        const size = imageNodeSize(capture.width, capture.height)
        const result = {
          id: `staging-shot-${imageNode.id}-${createdAt}`,
          type: 'image' as const,
          url: persisted.url,
          assetId: persisted.assetId,
          raw: persisted.raw,
          createdAt,
        }
        store.updateNode(imageNode.id, {
          result,
          history: [result],
          status: 'success',
          size: { width: size.width, height: size.height },
          meta: {
            ...(imageNode.meta || {}),
            source: capture.source,
            sourceNodeId: nodeId,
            // 标记为站位构图图：被当 composition_ref 喂关键帧时，触发「构图控制+写实重渲染」prompt 后缀。
            stagingComposition: true,
            localOnly: persisted.localOnly,
            imageWidth: capture.width,
            imageHeight: capture.height,
            imageAspectRatio: capture.width / Math.max(1, capture.height),
            previewHeight: size.previewHeight,
          },
        })
        store.connectNodes(nodeId, imageNode.id, 'reference')
        if (staging?.targetNodeId) {
          store.connectNodes(imageNode.id, staging.targetNodeId, 'composition_ref')
        }
        // 缩略图写回 scene3d 节点（与手动截图同口径）。
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        store.updateNode(nodeId, {
          meta: {
            ...(current?.meta || node.meta || {}),
            scene3dState: { ...normalizeScene3DState(current?.meta?.scene3dState), lastThumbnail: persisted.url },
          },
        })
      } finally {
        clearFlag()
        processingRef.current = null
      }
    },
    [],
  )

  if (!pendingNode) return null
  if (processingRef.current && processingRef.current !== pendingNode.id) return null
  processingRef.current = pendingNode.id
  const state = normalizeScene3DState(pendingNode.meta?.scene3dState)
  const nodeId = pendingNode.id
  return <Scene3DAutoCapture state={state} onResult={(result) => { void handleResult(nodeId, result) }} />
}
