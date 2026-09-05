import React from 'react'
import type { EnsureComposerVisibleEventDetail } from '../components/useComposerVisibilityPan'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  didComposerAvailableSpaceChange,
  ENSURE_COMPOSER_VISIBLE_EVENT,
  getUnobstructedComposerSpaceBelow,
  shouldAllowComposerAttachmentRecompute,
  shouldPreserveComposerAttachmentOnRatioChange,
} from './nodeSizing'
import { createComposerPanRequestLatch } from './composerPanRequestLifecycle'

const FLIP_HYSTERESIS = 48
const TOOLBAR_CLEARANCE_GAP = 18
const VIEWPORT_MARGIN = 12

export const NODE_FLOATING_TOOLBAR_SELECTOR = '[data-node-floating-toolbar="true"]'

export function toolbarClearanceInCanvasUnits(screenHeight: number, zoom: number, gap: number): number {
  return screenHeight > 0 ? screenHeight / (zoom || 1) + gap : 0
}

type Placement = {
  anchorRef: React.RefObject<HTMLDivElement>
  canvasZoom: number
  flipUp: boolean
  aboveClearance: number
  shiftX: number
  maxHeight: number
}

export function resolveComposerViewportGeometry(input: {
  previousFlipUp: boolean
  spaceAbove: number
  spaceBelow: number
  toolbarScreenHeight: number
  canvasZoom: number
  gap: number
  contentHeight: number
  preferredMaxHeight: number
  /** 最小可用高度；低于它卡片等于不可用（见 COMPOSER_MIN_USABLE_HEIGHT）。不吃提示词的节点传 0。 */
  minUsableHeight: number
}): {
  flipUp: boolean
  maxHeight: number
  availableAbove: number
  availableBelow: number
  aboveClearance: number
} {
  const zoom = input.canvasZoom || 1
  const aboveClearance = toolbarClearanceInCanvasUnits(
    input.toolbarScreenHeight,
    zoom,
    TOOLBAR_CLEARANCE_GAP,
  )
  const availableAbove = Math.max(
    0,
    input.spaceAbove - VIEWPORT_MARGIN - (input.gap + aboveClearance) * zoom,
  )
  const availableBelow = Math.max(
    0,
    input.spaceBelow - VIEWPORT_MARGIN - input.gap * zoom,
  )
  const minUsable = Math.min(input.minUsableHeight, input.preferredMaxHeight)
  // 需求高度**不许低于最小可用高度**：卡片被夹小后自身的测量会跟着缩水（实测 118 vs 真实 191），
  // 拿那个数当「需要多高」会让代码误判「这侧装得下」，从而压掉本该发出的翻转/平移请求。
  const neededHeight = Math.min(
    input.preferredMaxHeight,
    Math.max(minUsable, input.contentHeight > 0 ? input.contentHeight : input.preferredMaxHeight),
  )
  const aboveFits = availableAbove >= neededHeight
  const belowFits = availableBelow >= neededHeight

  let flipUp = input.previousFlipUp
  if (aboveFits !== belowFits) {
    flipUp = aboveFits
  } else if (!aboveFits && !belowFits) {
    // When neither side can fit the full card, stale attachment hysteresis must not
    // pin it to the smaller side. Use the roomier side and scroll inside the card.
    if (availableAbove !== availableBelow) flipUp = availableAbove > availableBelow
  } else if (input.previousFlipUp && availableBelow >= neededHeight + FLIP_HYSTERESIS) {
    flipUp = false
  }

  const selectedSpace = flipUp ? availableAbove : availableBelow
  return {
    flipUp,
    // 下限兜底：空间再紧也不把卡片夹成「提示词 0 高 + 底栏被裁到卡外」的缝。
    // 真放不下时宁可让卡片压住节点一点（浮层本来就是盖在画布上的），也不给一个点不到的空壳。
    maxHeight: Math.max(minUsable, Math.floor(Math.min(input.preferredMaxHeight, selectedSpace))),
    availableAbove,
    availableBelow,
    aboveClearance,
  }
}

/**
 * 需要把画布平移多少，才能给 composer 让出空间。返回值直接加到 canvasOffset.y：
 * 负 = 节点上移（换下方空间），正 = 节点下移（换上方空间），0 = 不动。
 *
 * ⚠️ `availableAbove/Below`（那一侧**装得下多少 composer**，已扣掉边距与工具条让位）
 * 与 `headroomAbove/Below`（画布**还能往那个方向移多远**且节点不出视口）是两回事。
 * 早先版本拿前者当后者用，于是「往上推节点换下方空间」时还在白扣 60px 的工具条让位，
 * 逃生口整个失效（2026-08-26 win32：真实上移余量 128，缺口 125.5，本来推得动却返回 0）。
 *
 * 够不到完整需求时**也推到极限**（部分平移），不再全有全无地放弃：推满后 headroom 归零，
 * 下一轮 delta 自然是 0，不会来回抖。
 */
export function resolveComposerViewportPanDelta(input: {
  availableAbove: number
  availableBelow: number
  /** 只扣 stage 边距、不扣软障碍（时间轴把手）的下方空间。 */
  viewportAvailableBelow?: number
  headroomAbove: number
  headroomBelow: number
  neededHeight: number
}): number {
  if (input.availableAbove >= input.neededHeight || input.availableBelow >= input.neededHeight) return 0

  const headroomAbove = Math.max(0, input.headroomAbove)
  const headroomBelow = Math.max(0, input.headroomBelow)
  // 上移节点这么多，下方才够；下移这么多，上方才够。
  const moveUp = input.neededHeight - input.availableBelow
  const moveDown = input.neededHeight - input.availableAbove

  // 优先「一步到位」：能完全满足需求的方向里挑挪动最小的那个（视觉扰动最小）。
  const fitsByMovingUp = moveUp > 0 && moveUp <= headroomAbove
  const fitsByMovingDown = moveDown > 0 && moveDown <= headroomBelow
  if (fitsByMovingUp && (!fitsByMovingDown || moveUp <= moveDown)) return -moveUp
  if (fitsByMovingDown) return moveDown

  // 两侧都无法完全绕开软障碍时，stage 是不能破的硬边界，把手退化为可最小重叠的软边界。
  // 只向当前默认的下挂方向做满足视口所需的最小上移；一旦 stage 已容纳就收敛到 0，
  // 不再因为另一侧 partial gain 较大而反向翻到顶外。
  const viewportAvailableBelow = Math.max(0, input.viewportAvailableBelow ?? input.availableBelow)
  if (viewportAvailableBelow >= input.neededHeight) return 0
  const moveUpForViewport = input.neededHeight - viewportAvailableBelow
  if (moveUpForViewport > 0 && moveUpForViewport <= headroomAbove) return -moveUpForViewport

  // 谁也满足不了：推到余量极限，取能换来更多空间的方向。总比留一条点不到的缝强。
  const gainBelow = Math.min(moveUp, headroomAbove)
  const gainAbove = Math.min(moveDown, headroomBelow)
  if (gainBelow <= 0 && gainAbove <= 0) return 0
  return gainBelow >= gainAbove ? -gainBelow : gainAbove
}

/**
 * composer 的视口定位总闸：横向夹取、上下避让、比例切换保持连接侧，以及动态时间轴把手观察。
 * 这些都只依赖屏幕几何，独立于 composer 的业务控件与生成逻辑。
 */
export function useComposerViewportPlacement(input: {
  node: GenerationCanvasNode
  visualSize: { width: number; height: number }
  gap: number
  preferredMaxHeight: number
  /** 低于它 composer 等于不可用（COMPOSER_MIN_USABLE_HEIGHT）；不吃提示词的节点传 0。 */
  minUsableHeight: number
}): Placement {
  const { node, visualSize, gap, preferredMaxHeight, minUsableHeight } = input
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const canvasOffset = useGenerationCanvasStore((state) => state.canvasOffset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = React.useState(false)
  const [aboveClearance, setAboveClearance] = React.useState(0)
  const [shiftX, setShiftX] = React.useState(0)
  const [maxHeight, setMaxHeight] = React.useState(preferredMaxHeight)
  const aspectRatioKey = typeof node.meta?.aspect_ratio === 'string' ? node.meta.aspect_ratio : ''
  const previousAspectRatioRef = React.useRef<string | null>(null)
  const [panSettlementRevision, requestPanRemeasure] = React.useReducer((revision: number) => revision + 1, 0)
  const panRequestLatchRef = React.useRef<ReturnType<typeof createComposerPanRequestLatch> | null>(null)
  if (!panRequestLatchRef.current) {
    panRequestLatchRef.current = createComposerPanRequestLatch(() => {
      if (anchorRef.current) requestPanRemeasure()
    })
  }
  const panRequestLatch = panRequestLatchRef.current

  React.useEffect(() => () => panRequestLatch.dispose(), [panRequestLatch])

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const stage = anchor?.closest('.generation-canvas-v2__stage')
    const nodeEl = anchor?.parentElement
    if (!anchor || !stage || !nodeEl) return
    const workspaceCanvas = stage.closest('.workbench-generation__canvas')
    const preserveAttachment = shouldPreserveComposerAttachmentOnRatioChange(
      previousAspectRatioRef.current,
      aspectRatioKey,
    )
    previousAspectRatioRef.current = aspectRatioKey
    const initialStageRect = stage.getBoundingClientRect()
    let observedAvailableSpace = {
      anchor: { width: anchor.offsetWidth, height: anchor.offsetHeight },
      stage: { width: initialStageRect.width, height: initialStageRect.height },
    }

    const recompute = (changes: { availableSpaceChanged?: boolean; obstacleChanged?: boolean } = {}) => {
      const stageRect = stage.getBoundingClientRect()
      const nodeRect = nodeEl.getBoundingClientRect()
      const margin = VIEWPORT_MARGIN
      const cardScreenWidth = anchor.offsetWidth
      const centerX = nodeRect.left + nodeRect.width / 2
      const wouldLeft = centerX - cardScreenWidth / 2
      const wouldRight = centerX + cardScreenWidth / 2
      const minLeft = stageRect.left + margin
      const maxRight = stageRect.right - margin
      let nextShiftX = 0
      if (wouldRight > maxRight) nextShiftX = maxRight - wouldRight
      if (wouldLeft + nextShiftX < minLeft) nextShiftX = minLeft - wouldLeft
      setShiftX(Math.round(nextShiftX))

      const timelineHandle = workspaceCanvas?.querySelector<HTMLElement>('.workbench-generation__timeline-handle')
      const viewportSpaceBelow = Math.max(0, stageRect.bottom - nodeRect.bottom)
      const spaceBelow = getUnobstructedComposerSpaceBelow({
        stage: stageRect,
        node: nodeRect,
        composer: { left: wouldLeft + nextShiftX, right: wouldRight + nextShiftX },
        obstacles: timelineHandle ? [timelineHandle.getBoundingClientRect()] : [],
      })
      const spaceAbove = nodeRect.top - stageRect.top
      const toolbar = nodeEl.querySelector<HTMLElement>(NODE_FLOATING_TOOLBAR_SELECTOR)
      const toolbarScreenHeight = toolbar ? toolbar.getBoundingClientRect().height : 0
      const card = anchor.querySelector<HTMLElement>('.generation-canvas-v2-node__composer-card')
      const geometry = resolveComposerViewportGeometry({
        previousFlipUp: flipUp,
        spaceAbove,
        spaceBelow,
        toolbarScreenHeight,
        canvasZoom,
        gap,
        contentHeight: card?.scrollHeight || anchor.offsetHeight || preferredMaxHeight,
        preferredMaxHeight,
        minUsableHeight,
      })
      const selectedAvailableSpace = flipUp ? geometry.availableAbove : geometry.availableBelow
      const neededScreenHeight = Math.min(
        preferredMaxHeight,
        Math.max(minUsableHeight, card?.scrollHeight || anchor.offsetHeight || preferredMaxHeight),
      )
      const panDeltaY = resolveComposerViewportPanDelta({
        availableAbove: geometry.availableAbove,
        availableBelow: geometry.availableBelow,
        viewportAvailableBelow: Math.max(0, viewportSpaceBelow - VIEWPORT_MARGIN - gap * canvasZoom),
        // 平移余量 = 节点还能往那个方向移多远（留 VIEWPORT_MARGIN 不让它贴死边），
        // 与「那一侧装得下多少」分开算——混用是逃生口失效的根因。
        headroomAbove: Math.max(0, spaceAbove - VIEWPORT_MARGIN),
        headroomBelow: Math.max(0, spaceBelow - VIEWPORT_MARGIN),
        neededHeight: neededScreenHeight,
      })
      if (panDeltaY === 0) {
        panRequestLatch.observeNoRequest()
      } else {
        const acknowledge = panRequestLatch.tryAcquire()
        if (acknowledge) {
          const detail: EnsureComposerVisibleEventDetail = { nodeId: node.id, deltaY: panDeltaY, onSettled: acknowledge }
          window.dispatchEvent(new CustomEvent(ENSURE_COMPOSER_VISIBLE_EVENT, { detail }))
        }
      }
      const attachmentObstructed = selectedAvailableSpace < neededScreenHeight
      const allowFlip = shouldAllowComposerAttachmentRecompute({
        preserveForRatioChange: preserveAttachment,
        availableSpaceChanged: changes.availableSpaceChanged ?? false,
        obstacleChanged: changes.obstacleChanged ?? false,
        attachmentObstructed,
      })
      const nextFlipUp = allowFlip ? geometry.flipUp : flipUp
      setFlipUp(nextFlipUp)
      setAboveClearance(geometry.aboveClearance)
      // 与 resolveComposerViewportGeometry 的 maxHeight 同一套算法（这里按 nextFlipUp 重取一次侧别），
      // 下限同样兜到最小可用高度——两处必须一致，否则卡片又会被夹回不可用。
      setMaxHeight(
        Math.max(
          Math.min(minUsableHeight, preferredMaxHeight),
          Math.floor(Math.min(
            preferredMaxHeight,
            nextFlipUp ? geometry.availableAbove : geometry.availableBelow,
          )),
        ),
      )
    }

    let observedTimelineHandle: HTMLElement | null = null
    let observedTimelineHandleSize: { width: number; height: number } | null = null
    const resizeObserver = new ResizeObserver((entries) => {
      const stageRect = stage.getBoundingClientRect()
      const nextAvailableSpace = {
        anchor: { width: anchor.offsetWidth, height: anchor.offsetHeight },
        stage: { width: stageRect.width, height: stageRect.height },
      }
      const availableSpaceChanged = didComposerAvailableSpaceChange(observedAvailableSpace, nextAvailableSpace)
      observedAvailableSpace = nextAvailableSpace
      let obstacleChanged = false
      if (observedTimelineHandle && entries.some((entry) => entry.target === observedTimelineHandle)) {
        const nextSize = {
          width: observedTimelineHandle.offsetWidth,
          height: observedTimelineHandle.offsetHeight,
        }
        obstacleChanged = observedTimelineHandleSize !== null && (
          observedTimelineHandleSize.width !== nextSize.width || observedTimelineHandleSize.height !== nextSize.height
        )
        observedTimelineHandleSize = nextSize
      }
      recompute({ availableSpaceChanged, obstacleChanged })
    })

    const syncTimelineHandleObservation = (): boolean => {
      const nextHandle = workspaceCanvas?.querySelector<HTMLElement>('.workbench-generation__timeline-handle') ?? null
      if (nextHandle === observedTimelineHandle) return false
      if (observedTimelineHandle) resizeObserver.unobserve(observedTimelineHandle)
      observedTimelineHandle = nextHandle
      observedTimelineHandleSize = nextHandle
        ? { width: nextHandle.offsetWidth, height: nextHandle.offsetHeight }
        : null
      if (nextHandle) resizeObserver.observe(nextHandle)
      return true
    }

    resizeObserver.observe(anchor)
    resizeObserver.observe(stage)
    syncTimelineHandleObservation()
    recompute()

    const mutationObserver = new MutationObserver(() => {
      if (syncTimelineHandleObservation()) recompute({ obstacleChanged: true })
    })
    if (workspaceCanvas) mutationObserver.observe(workspaceCanvas, { childList: true, subtree: true })
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [
    aboveClearance,
    aspectRatioKey,
    canvasOffset,
    canvasZoom,
    flipUp,
    gap,
    minUsableHeight,
    node.position?.x,
    node.position?.y,
    node.result?.url,
    panRequestLatch,
    panSettlementRevision,
    preferredMaxHeight,
    visualSize.height,
    visualSize.width,
  ])

  return { anchorRef, canvasZoom, flipUp, aboveClearance, shiftX, maxHeight }
}
