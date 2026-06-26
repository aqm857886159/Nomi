import React from 'react'
import { IconCube, IconMaximize } from '@tabler/icons-react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { EmptyStateLauncher } from './render/CardCommon'
import { toast } from '../../../ui/toast'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { cloneScene3DState, normalizeScene3DState } from './scene3d/scene3dSerializer'
import { persistScene3DScreenshot } from './scene3d/scene3dScreenshot'
import type { Scene3DCaptureResult, Scene3DState } from './scene3d/scene3dTypes'

const loadScene3DFullscreen = () => import('./scene3d/Scene3DFullscreen')
const Scene3DFullscreen = lazyWithChunkBoundary('3D 全屏编辑', loadScene3DFullscreen)

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

function scene3DStateKey(state: Scene3DState): string {
  return JSON.stringify(state)
}

function persistableScene3DState(state: Scene3DState): Scene3DState {
  return cloneScene3DState(normalizeScene3DState(state))
}

function Scene3DEditor({ node, width, height, readOnly = false }: Scene3DEditorProps): JSX.Element {
  const [fullscreen, setFullscreen] = React.useState(false)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const sceneState = React.useMemo(() => readScene3DState(node), [node.id, node.meta?.scene3dState])
  const sceneStateKey = React.useMemo(() => scene3DStateKey(sceneState), [sceneState])
  const persistedSceneStateKeyRef = React.useRef(sceneStateKey)
  const lastThumbnailRef = React.useRef(sceneState.lastThumbnail)
  const thumbnailUrl = sceneState.lastThumbnail

  React.useEffect(() => {
    persistedSceneStateKeyRef.current = sceneStateKey
    lastThumbnailRef.current = sceneState.lastThumbnail
  }, [sceneState.lastThumbnail, sceneStateKey])

  const preloadFullscreenEditor = React.useCallback(() => {
    void loadScene3DFullscreen()
  }, [])

  const handleStateChange = React.useCallback((nextState: Scene3DState) => {
    const nextSceneState = persistableScene3DState({
      ...nextState,
      lastThumbnail: nextState.lastThumbnail ?? lastThumbnailRef.current,
    })
    const nextSceneStateKey = scene3DStateKey(nextSceneState)
    if (persistedSceneStateKeyRef.current === nextSceneStateKey) return

    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const currentSceneState = normalizeScene3DState(current?.meta?.scene3dState)
    if (scene3DStateEqual(currentSceneState, nextSceneState)) {
      persistedSceneStateKeyRef.current = nextSceneStateKey
      lastThumbnailRef.current = nextSceneState.lastThumbnail
      return
    }

    persistedSceneStateKeyRef.current = nextSceneStateKey
    lastThumbnailRef.current = nextSceneState.lastThumbnail
    updateNode(node.id, {
      meta: {
        ...(current?.meta || {}),
        scene3dState: nextSceneState,
      },
    })
  }, [node.id, updateNode])

  const handleCloseFullscreen = React.useCallback(() => {
    setFullscreen(false)
    void persistActiveWorkbenchProjectNow().catch(() => {})
  }, [])

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
      const nextSceneState = persistableScene3DState({
        ...normalizeScene3DState(current?.meta?.scene3dState),
        lastThumbnail: persisted.url,
      })
      lastThumbnailRef.current = persisted.url
      persistedSceneStateKeyRef.current = scene3DStateKey(nextSceneState)
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
      <div className="group relative w-full h-full overflow-hidden">
        {thumbnailUrl ? (
          <>
            <img
              className="w-full h-full object-contain select-none pointer-events-none bg-nomi-ink-05"
              src={thumbnailUrl}
              alt=""
              draggable={false}
            />
            {/* 有缩略图时整图悬浮可点开编辑器——此前只有右上角小钮能点，整张图看着可点其实点不动（用户反馈）。
                覆盖层 pointer-events-none 让节点仍可从图上拖拽；只有居中按钮接管点击（外壳放行 button 不触发拖拽）。 */}
            <div
              className={cn(
                'pointer-events-none absolute inset-0 grid place-items-center',
                'bg-nomi-ink/0 transition-colors duration-[var(--nomi-transition-fast)] group-hover:bg-nomi-ink/[0.32]',
              )}
            >
              <button
                type="button"
                aria-label="打开 3D 编辑器"
                className={cn(
                  'pointer-events-auto inline-flex items-center gap-1.5 rounded-nomi px-3 py-1.5 border-0 cursor-pointer',
                  'bg-nomi-paper/[0.92] text-body-sm font-semibold text-nomi-ink shadow-nomi-sm backdrop-blur-[10px]',
                  'opacity-0 transition-opacity duration-[var(--nomi-transition-fast)] group-hover:opacity-100',
                  'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
                )}
                onFocus={preloadFullscreenEditor}
                onPointerEnter={preloadFullscreenEditor}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  setFullscreen(true)
                }}
              >
                <IconCube size={15} stroke={1.7} />
                打开 3D 编辑器
              </button>
            </div>
          </>
        ) : (
          <div className={cn('flex h-full w-full items-center justify-center')}>
            <EmptyStateLauncher
              icon={<IconCube size={24} stroke={1.65} />}
              label="点击进入 3D 编辑器"
              hint="摆放模型、相机并输出截图"
              activateAriaLabel="进入 3D 编辑器"
              onActivate={() => setFullscreen(true)}
              onPreload={preloadFullscreenEditor}
            />
          </div>
        )}
        <button
          className={cn(
            'absolute right-3 top-3 grid size-8 place-items-center',
            'rounded-nomi border border-nomi-line-soft',
            'bg-nomi-paper/[0.82] text-nomi-ink-60 shadow-nomi-sm',
            'backdrop-blur-[10px] transition hover:bg-nomi-paper hover:text-nomi-ink',
          )}
          type="button"
          aria-label="打开 3D 编辑器"
          title="打开 3D 编辑器"
          onFocus={preloadFullscreenEditor}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={preloadFullscreenEditor}
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
            onClose={handleCloseFullscreen}
            onScreenshot={(capture) => { void handleScreenshot(capture) }}
            onStateChange={handleStateChange}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}

export default React.memo(Scene3DEditor, (previous, next) => (
  previous.node.id === next.node.id &&
  previous.node.title === next.node.title &&
  previous.node.meta?.scene3dState === next.node.meta?.scene3dState &&
  previous.node.position.x === next.node.position.x &&
  previous.node.position.y === next.node.position.y &&
  previous.width === next.width &&
  previous.height === next.height &&
  previous.readOnly === next.readOnly
))
