import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCube, IconMaximize } from '@tabler/icons-react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import { EmptyStateLauncher } from './render/CardCommon'
import { NomiLoadingMark } from '../../../design'
import { toast } from '../../../ui/toast'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useWorkbenchStore } from '../../workbenchStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { cloneScene3DState, normalizeScene3DState } from './scene3d/scene3dSerializer'
import { persistScene3DScreenshot } from './scene3d/scene3dScreenshot'
import { frameCountForDuration } from './scene3d/takeRecording'
import { isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { DeferredNodeVideo } from './DeferredNodeMedia'
import { buildVideoPlaybackUrl } from '../../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../../media/videoPlaybackDiagnostics'
import { readScene3DCardPreview } from './scene3d/scene3dCardPreview'
import {
  referenceSlotForScene3DCaptureTitle,
  shouldAttachScene3DFrameReference,
  summarizeScene3DReferenceTarget,
} from './scene3d/scene3dReferenceDirector'
import type { Scene3DCaptureResult, Scene3DState } from './scene3d/scene3dTypes'

const loadScene3DFullscreen = () => import('./scene3d/Scene3DFullscreen')
const Scene3DFullscreen = lazyWithChunkBoundary('i18n:scene3d.fullscreen.chunkTitle', loadScene3DFullscreen)

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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
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

// 录 take 闭环状态徽标（用户反馈 #1）：「录制走位参考」节点在出片期间/出片后无任何反馈，
// 用户不知道成没成。读节点 meta 上 AI 运镜管线本就写的两个标志，复用同一套状态语义：
//   - cameraMoveAutoCapture 仍在 → 离屏渲染中（CameraMoveCaptureHost 处理完会清掉）
//   - cameraMoveVideo 已写回 → 出片完成（{ url } 是 mp4 素材）
export function readTakeCaptureStatus(node: GenerationCanvasNode): 'generating' | 'done' | null {
  const meta = node.meta as Record<string, unknown> | undefined
  if (!meta) return null
  if (meta.cameraMoveAutoCapture && typeof meta.cameraMoveAutoCapture === 'object') return 'generating'
  const video = meta.cameraMoveVideo
  if (video && typeof video === 'object' && readNonEmptyString((video as { url?: unknown }).url)) return 'done'
  return null
}

function Scene3DTakeGeneratingOverlay(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-center justify-center gap-2',
        'bg-nomi-ink/[0.62] px-3 py-1.5 text-caption font-medium text-nomi-paper backdrop-blur-[3px]',
      )}
      aria-live="polite"
    >
      <NomiLoadingMark size={16} />
      <span>{t('scene3d.fullscreen.referenceVideoGenerating')}</span>
    </div>
  )
}

function Scene3DEditor({ node, width, height, readOnly = false }: Scene3DEditorProps): JSX.Element {
  const { t } = useTranslation()
  const [fullscreen, setFullscreen] = React.useState(false)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const connectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const canvasNodes = useGenerationCanvasStore((state) => state.nodes)
  const canvasEdges = useGenerationCanvasStore((state) => state.edges)
  const requestCanvasFit = useWorkbenchStore((state) => state.requestCanvasFit)
  const sceneState = React.useMemo(() => readScene3DState(node), [node.id, node.meta?.scene3dState])
  const sceneStateKey = React.useMemo(() => scene3DStateKey(sceneState), [sceneState])
  const referenceTarget = React.useMemo(
    () => summarizeScene3DReferenceTarget(node.id, canvasNodes, canvasEdges),
    [canvasEdges, canvasNodes, node.id],
  )
  const persistedSceneStateKeyRef = React.useRef(sceneStateKey)
  const lastThumbnailRef = React.useRef(sceneState.lastThumbnail)
  const cardPreview = readScene3DCardPreview(node)

  React.useEffect(() => {
    persistedSceneStateKeyRef.current = sceneStateKey
    lastThumbnailRef.current = sceneState.lastThumbnail
  }, [sceneState.lastThumbnail, sceneStateKey])

  const preloadFullscreenEditor = React.useCallback(() => {
    void loadScene3DFullscreen()
  }, [])

  const handleStateChange = React.useCallback(
    (nextState: Scene3DState) => {
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
    },
    [node.id, updateNode],
  )

  // 关编辑器后 fit + 高亮新节点（P3）：截图和录 take 都触发，不只录 take
  // 原 bug：fitView 只在录 take 后触发，截图后关编辑器不 fit → 用户找不到截图节点
  const pendingFitNodeIdRef = React.useRef<string | null>(null)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)

  const handleCloseFullscreen = React.useCallback(() => {
    setFullscreen(false)
    void persistActiveWorkbenchProjectNow().catch(() => {})
    const pendingId = pendingFitNodeIdRef.current
    if (pendingId) {
      pendingFitNodeIdRef.current = null
      // 延迟一帧让画布渲染完再 fit + select
      requestAnimationFrame(() => {
        requestCanvasFit()
        selectNode(pendingId)
      })
    }
  }, [requestCanvasFit, selectNode])

  // 录 take（S2）：把录制好的（含角色/机位轨迹的）场景另建一个 scene3d 节点 + 打 cameraMoveAutoCapture 标志，
  // 整条出 mp4 + 喂目标镜头 video_ref 复用 AI 运镜常驻 Host（CameraMoveCaptureHost），不另起接缝（P1）。
  // 另建节点而非覆写本节点 → 非破坏：用户原本编排好的 3D 场景保持原样。
  // 目标镜头 = 本 scene3d 节点下游连到的视频节点（无则只出 mp4 留痕，不挂）。
  // 返回 take 节点 id：出片产物卡靠它盯 meta.cameraMoveVideo 等渲染完成（P3-14）。
  const handleRecordTake = React.useCallback((recordedState: Scene3DState): string => {
    const store = useGenerationCanvasStore.getState()
    const downstreamVideoTarget = store.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => store.nodes.find((candidate) => candidate.id === edge.target))
      .find((candidate) => candidate && isVideoLikeGenerationNodeKind(candidate.kind))
    const fps = 24 // Seedance 参考视频要求 23.8–60 FPS（与 AI 运镜一致）
    const duration = recordedState.sceneTimeline?.totalDuration ?? 1
    const frameCount = frameCountForDuration(duration, fps)
    const takeNode = addNode({
      kind: 'scene3d',
      title: t('scene3d.fullscreen.recordedTakeTitle'),
      prompt: '',
      // #1 闭环可见性根因：scene3d 的默认分类是 'scene'，但用户正看着的子画布
      // （source 节点所在分类，常是 'shots'）未必是 'scene'。漏传 categoryId →
      // 新节点落到另一个子画布 → 既不进当前 activeCategoryId 过滤后的 nodes、也不渲染 DOM，
      // fitView 只框当前分类的 nodes 永远带不进它（用户看到的就是「录完节点人间蒸发」）。
      // 让 take 节点继承 source 节点「实际显示所在」的分类，确保它和 source 同屏、fit 能框到。
      // 用 (node.categoryId || 'shots') 而非裸 node.categoryId：source 是 legacy 无分类节点时
      // 它按 'shots' 兜底渲染（见 GenerationCanvas 过滤），但 addNode 对 undefined 会退到
      // scene3d 默认分类 'scene'——直接传 undefined 仍会错位，必须用同一套兜底口径。
      categoryId: node.categoryId || 'shots',
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y + height + 80),
      },
    })
    updateNode(takeNode.id, {
      meta: {
        ...(takeNode.meta || {}),
        scene3dState: recordedState,
        cameraMoveAutoCapture: {
          ...(downstreamVideoTarget ? { targetNodeId: downstreamVideoTarget.id } : {}),
          fps,
          frameCount,
        },
      },
    })
    // 闭环可见性（#1）：标记本次录过 take；真正的画布 fit + 高亮推迟到关闭编辑器后（handleCloseFullscreen），
    // 因为此刻全屏编辑器盖着画布、fit 是白跑。关掉后画布可见再 fit + select，把新「录制走位参考」节点带进视口。
    pendingFitNodeIdRef.current = takeNode.id
    return takeNode.id
  }, [addNode, height, node.categoryId, node.id, node.position.x, node.position.y, t, updateNode])

  const handleScreenshot = React.useCallback(async (capture: Scene3DCaptureResult) => {
    try {
      const persisted = await persistScene3DScreenshot(capture.dataUrl, node.id, capture.title)
      const createdAt = Date.now()
      const screenshotNode = addNode({
        kind: 'image',
        title: capture.title,
        prompt: t('scene3d.fullscreen.screenshotPrompt'),
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
      const targetSlot = referenceSlotForScene3DCaptureTitle(capture.title)
      if (
        targetSlot &&
        referenceTarget.state !== 'not-connected' &&
        shouldAttachScene3DFrameReference(referenceTarget, targetSlot)
      ) {
        connectNodes(screenshotNode.id, referenceTarget.targetNodeId, targetSlot)
      }

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
      toast(t('scene3d.fullscreen.screenshotCreated'), 'success')
      // P3：标记截图节点，关编辑器后 fit + 高亮
      pendingFitNodeIdRef.current = screenshotNode.id
    } catch (error) {
      toast(error instanceof Error ? error.message : t('scene3d.fullscreen.screenshotFailed'), 'error')
    }
  }, [addNode, connectNodes, node.id, node.meta, node.position.x, node.position.y, referenceTarget, t, updateNode, width])

  const takeCaptureStatus = readTakeCaptureStatus(node)

  return (
    <>
      <div className="group relative w-full h-full overflow-hidden" data-tour-target="staging trajectory">
        {takeCaptureStatus === 'generating' ? <Scene3DTakeGeneratingOverlay /> : null}
        {cardPreview.kind === 'video' ? (
          <DeferredNodeVideo
            data-scene3d-take-video="true"
            className="h-full w-full min-h-0 bg-nomi-ink-05 object-contain pointer-events-auto select-none"
            src={buildVideoPlaybackUrl(cardPreview.url)}
            crossOrigin="use-credentials"
            controls
            muted
            playsInline
            preload="metadata"
            draggable={false}
            onError={(event) => {
              void diagnoseVideoPlaybackFailure(cardPreview.url, event.currentTarget.error).then(
                logVideoPlaybackFailure,
              )
            }}
          />
        ) : cardPreview.kind === 'image' ? (
          <>
            <img
              className="w-full h-full object-contain select-none pointer-events-none bg-nomi-ink-05"
              src={cardPreview.url}
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
                aria-label={t('scene3d.fullscreen.openEditor')}
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
                {t('scene3d.fullscreen.openEditor')}
              </button>
            </div>
          </>
        ) : (
          <div className={cn('flex h-full w-full items-center justify-center')}>
            <EmptyStateLauncher
              icon={<IconCube size={24} stroke={1.65} />}
              label={t('scene3d.fullscreen.enterEditor')}
              hint={t('scene3d.fullscreen.editorHint')}
              activateAriaLabel={t('scene3d.fullscreen.enterEditorAria')}
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
          aria-label={t('scene3d.fullscreen.openEditor')}
          title={t('scene3d.fullscreen.openEditor')}
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
            nodeTitle={node.title || t('scene3d.fullscreen.sceneTitle')}
            readOnly={readOnly}
            onClose={handleCloseFullscreen}
            onScreenshot={(capture) => {
              void handleScreenshot(capture)
            }}
            onStateChange={handleStateChange}
            onRecordTake={readOnly ? undefined : handleRecordTake}
            referenceTarget={referenceTarget}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}

export default React.memo(
  Scene3DEditor,
  (previous, next) =>
    previous.node.id === next.node.id &&
    previous.node.title === next.node.title &&
    previous.node.meta?.scene3dState === next.node.meta?.scene3dState &&
    // 录 take 状态徽标（#1）随这两个标志变化重渲染：CaptureHost 出片后清 cameraMoveAutoCapture、写 cameraMoveVideo，
    // 而 scene3dState 引用不变——只比 scene3dState 会漏掉状态切换、徽标永远停在「生成中」。
    previous.node.meta?.cameraMoveAutoCapture === next.node.meta?.cameraMoveAutoCapture &&
    previous.node.meta?.cameraMoveVideo === next.node.meta?.cameraMoveVideo &&
    previous.node.position.x === next.node.position.x &&
    previous.node.position.y === next.node.position.y &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.readOnly === next.readOnly,
)
