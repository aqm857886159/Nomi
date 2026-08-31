import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  didComposerAvailableSpaceChange,
  ENSURE_COMPOSER_VISIBLE_EVENT,
  getUnobstructedComposerSpaceBelow,
  shouldAllowComposerAttachmentRecompute,
  shouldPreserveComposerAttachmentOnRatioChange,
} from './nodeSizing'

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
  const neededHeight = Math.min(
    input.preferredMaxHeight,
    input.contentHeight > 0 ? input.contentHeight : input.preferredMaxHeight,
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
    maxHeight: Math.max(0, Math.floor(Math.min(input.preferredMaxHeight, selectedSpace))),
    availableAbove,
    availableBelow,
    aboveClearance,
  }
}

export function resolveComposerViewportPanDelta(input: {
  availableAbove: number
  availableBelow: number
  neededHeight: number
}): number {
  if (input.availableAbove >= input.neededHeight || input.availableBelow >= input.neededHeight) return 0

  const moveUp = input.neededHeight - input.availableBelow
  const moveDown = input.neededHeight - input.availableAbove
  const canMoveUp = moveUp <= input.availableAbove
  const canMoveDown = moveDown <= input.availableBelow
  if (!canMoveUp && !canMoveDown) return 0
  if (canMoveUp && (!canMoveDown || moveUp <= moveDown)) return -moveUp
  return moveDown
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
}): Placement {
  const { node, visualSize, gap, preferredMaxHeight } = input
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const canvasOffset = useGenerationCanvasStore((state) => state.canvasOffset)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = React.useState(false)
  const [aboveClearance, setAboveClearance] = React.useState(0)
  const [shiftX, setShiftX] = React.useState(0)
  const [maxHeight, setMaxHeight] = React.useState(preferredMaxHeight)
  const aspectRatioKey = typeof node.meta?.aspect_ratio === 'string' ? node.meta.aspect_ratio : ''
  const previousAspectRatioRef = React.useRef<string | null>(null)
  const panRequestPendingRef = React.useRef(false)

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
      })
      const selectedAvailableSpace = flipUp ? geometry.availableAbove : geometry.availableBelow
      const neededScreenHeight = Math.min(
        preferredMaxHeight,
        card?.scrollHeight || anchor.offsetHeight || preferredMaxHeight,
      )
      const panDeltaY = resolveComposerViewportPanDelta({
        availableAbove: geometry.availableAbove,
        availableBelow: geometry.availableBelow,
        neededHeight: neededScreenHeight,
      })
      if (panDeltaY === 0) {
        panRequestPendingRef.current = false
      } else if (!panRequestPendingRef.current) {
        panRequestPendingRef.current = true
        window.dispatchEvent(new CustomEvent(ENSURE_COMPOSER_VISIBLE_EVENT, {
          detail: { deltaY: panDeltaY },
        }))
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
      setMaxHeight(
        Math.max(
          0,
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
    node.position?.x,
    node.position?.y,
    node.result?.url,
    preferredMaxHeight,
    visualSize.height,
    visualSize.width,
  ])

  return { anchorRef, canvasZoom, flipUp, aboveClearance, shiftX, maxHeight }
}
