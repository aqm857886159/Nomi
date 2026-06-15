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

// 结构化深比较（仅 JSON 值：plain object / array / 原始值——Scene3DState 一直是可序列化纯数据，
// 故等价于原来的 JSON.stringify 相等，但**首处不同即短路返回**，不像 stringify 每次都把整棵
// objects[]/cameras[] 全序列化两遍。根因 P1：去掉父层「每次 state 变就两次整树序列化」的热点开销，
// 写库去重契约不变（仍只在 next 与已落盘 state 真不同时 updateNode）。
function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonValueEqual(a[i], b[i])) return false
    }
    return true
  }
  if (isPlainJsonObject(a) && isPlainJsonObject(b)) {
    // 与 JSON.stringify 同义：忽略两侧 value 为 undefined 的键（stringify 会丢这些键），
    // 故 { parentId: undefined } 与 {} 视为相等——保持对旧实现的行为等价、不产生多余写入。
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined)
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (b[key] === undefined) return false
      if (!jsonValueEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}

export function scene3DStateEqual(a: Scene3DState, b: Scene3DState): boolean {
  return jsonValueEqual(a, b)
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
    if (scene3DStateEqual(currentSceneState, nextState)) return
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
            <div className="grid size-12 place-items-center rounded-nomi border border-nomi-line-soft bg-nomi-paper/[0.72] shadow-nomi-sm">
              <IconCube className="text-nomi-ink-60" size={25} stroke={1.65} />
            </div>
            <div className="text-center">
              <div className="text-caption font-medium text-nomi-ink-70">点击进入 3D 编辑器</div>
              <div className="mt-1 text-micro text-nomi-ink-45">摆放模型、相机并输出截图</div>
            </div>
          </div>
        )}
        <button
          className={cn(
            'absolute right-3 top-3 grid size-8 place-items-center',
            'rounded-nomi border border-nomi-line-soft',
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
