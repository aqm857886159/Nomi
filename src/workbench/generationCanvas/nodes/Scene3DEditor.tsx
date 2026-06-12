import React from 'react'
import { IconCube, IconMaximize } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { normalizeScene3DState } from './scene3d/scene3dSerializer'
import { persistScene3DScreenshot } from './scene3d/scene3dScreenshot'
import type { Scene3DCaptureResult, Scene3DState } from './scene3d/scene3dTypes'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'

const Scene3DFullscreen = lazyWithChunkBoundary('3D 全屏编辑', () => import('./scene3d/Scene3DFullscreen'))

type Scene3DEditorProps = {
  node: GenerationCanvasNode
  width: number
  height: number
  readOnly?: boolean
}

function imageNodeSize(width: number, height: number): { width: number; height: number; previewHeight: number } {
  const aspectRatio = width / Math.max(1, height)
  const nodeWidth = aspectRatio >= 1.75 ? 420 : aspectRatio <= 0.72 ? 260 : 340
  const previewHeight = Math.min(520, Math.max(120, Math.round(nodeWidth / Math.max(0.01, aspectRatio))))
  return {
    width: nodeWidth,
    height: previewHeight,
    previewHeight,
  }
}

function readScene3DState(node: GenerationCanvasNode): Scene3DState {
  return normalizeScene3DState(node.meta?.scene3dState)
}

function scene3DStateKey(state: Scene3DState): string {
  return JSON.stringify(state)
}

export default function Scene3DEditor({ node, width, height, readOnly = false }: Scene3DEditorProps): JSX.Element {
  const [fullscreen, setFullscreen] = React.useState(false)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const sceneState = readScene3DState(node)
  const thumbnailUrl = sceneState.lastThumbnail

  const handleStateChange = React.useCallback((nextState: Scene3DState) => {
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const currentSceneState = normalizeScene3DState(current?.meta?.scene3dState)
    if (scene3DStateKey(currentSceneState) === scene3DStateKey(nextState)) return
    updateNode(node.id, {
      meta: {
        ...(current?.meta || {}),
        scene3dState: nextState,
      },
    })
  }, [node.id, updateNode])

  const handleScreenshot = React.useCallback(async (capture: Scene3DCaptureResult) => {
    try {
      const persisted = await persistScene3DScreenshot(capture.dataUrl, node.id, capture.title)
      const createdAt = Date.now()
      const screenshotNode = addNode({
        kind: 'image',
        title: capture.title,
        prompt: '3D 场景截图',
        position: {
          x: Math.round(node.position.x + width + 80),
          y: Math.round(node.position.y),
        },
      })
      const result = {
        id: `scene3d-shot-${screenshotNode.id}-${createdAt}`,
        type: 'image' as const,
        url: persisted.url,
        assetId: persisted.assetId,
        raw: persisted.raw,
        createdAt,
      }
      const size = imageNodeSize(capture.width, capture.height)
      updateNode(screenshotNode.id, {
        result,
        history: [result],
        status: 'success',
        size: { width: size.width, height: size.height },
        meta: {
          ...(screenshotNode.meta || {}),
          source: capture.source,
          sourceNodeId: node.id,
          localOnly: persisted.localOnly,
          imageWidth: capture.width,
          imageHeight: capture.height,
          imageAspectRatio: capture.width / Math.max(1, capture.height),
          previewHeight: size.previewHeight,
        },
      })
      connectNodes(node.id, screenshotNode.id, 'reference')

      const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
      const nextSceneState = {
        ...normalizeScene3DState(current?.meta?.scene3dState),
        lastThumbnail: persisted.url,
      }
      updateNode(node.id, {
        meta: {
          ...(current?.meta || node.meta || {}),
          scene3dState: nextSceneState,
        },
      })
      toast('3D 截图已创建图片节点', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '截图失败，请重试', 'error')
    }
  }, [addNode, connectNodes, node.id, node.meta, node.position.x, node.position.y, updateNode, width])

  return (
    <>
      <div className="relative w-full h-full overflow-hidden">
        {thumbnailUrl ? (
          <img
            className="w-full h-full object-contain select-none pointer-events-none bg-nomi-ink-05"
            src={thumbnailUrl}
            alt=""
            draggable={false}
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full flex-col items-center justify-center gap-3',
              'text-nomi-ink-60',
            )}
          >
            <div className="grid size-12 place-items-center rounded-[8px] border border-nomi-line-soft bg-nomi-paper/[0.72] shadow-nomi-sm">
              <IconCube className="text-nomi-ink-60" size={25} stroke={1.65} />
            </div>
            <div className="text-center">
              <div className="text-caption font-medium text-nomi-ink-70">点击进入 3D 编辑器</div>
              <div className="mt-1 text-[11px] text-nomi-ink-45">摆放模型、相机并输出截图</div>
            </div>
          </div>
        )}
        <button
          className={cn(
            'absolute right-3 top-3 grid size-8 place-items-center',
            'rounded-[8px] border border-nomi-line-soft',
            'bg-nomi-paper/[0.82] text-nomi-ink-55 shadow-nomi-sm',
            'backdrop-blur-[10px] transition hover:bg-nomi-paper hover:text-nomi-ink',
          )}
          type="button"
          aria-label="打开 3D 编辑器"
          title="打开 3D 编辑器"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setFullscreen(true)
          }}
        >
          <IconMaximize size={16} stroke={1.9} />
        </button>
      </div>

      {fullscreen ? (
        <React.Suspense fallback={null}>
          <Scene3DFullscreen
            initialState={sceneState}
            nodeTitle={node.title || '3D场景'}
            readOnly={readOnly}
            onClose={() => setFullscreen(false)}
            onScreenshot={(capture) => { void handleScreenshot(capture) }}
            onStateChange={handleStateChange}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}
