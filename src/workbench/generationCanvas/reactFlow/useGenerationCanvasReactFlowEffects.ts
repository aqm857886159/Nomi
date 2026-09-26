import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactFlowInstance } from '@xyflow/react'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  subscribeBrowserAssetsImportToCanvas,
  type BrowserAssetCanvasImportItem,
} from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import { toast } from '../../../ui/toast'
import { useWorkbenchStore } from '../../workbenchStore'
import { importBrowserAssetsToGenerationCanvas } from '../components/canvasStageDrop'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { FOCUS_GENERATION_NODE_EVENT, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { publishCanvasStageSize } from '../store/canvasVisibleArea'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { resolveCanvasFocusZoom, resolvePendingCanvasFocus, type PendingCanvasFocus } from './focusViewportRecovery'

type HostEffectsArgs = {
  animateViewportTo: (zoom: number, offset: { x: number; y: number }, duration?: number) => void
  cancelViewportAnimation: () => void
  activeCategoryId: string
  flow: ReactFlowInstance<GenerationFlowNode, GenerationFlowEdge>
  hostRef: React.RefObject<HTMLDivElement>
  nodes: GenerationCanvasNode[]
  allNodes: GenerationCanvasNode[]
  setStageSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>
  setLiveViewport: React.Dispatch<React.SetStateAction<{ x: number; y: number; zoom: number }>>
  setFocusFlashNodeId: React.Dispatch<React.SetStateAction<string | null>>
  zoomRef: React.MutableRefObject<number>
}

export function useGenerationCanvasReactFlowHostEffects({
  activeCategoryId,
  animateViewportTo,
  cancelViewportAnimation,
  flow,
  hostRef,
  nodes,
  allNodes,
  setStageSize,
  setLiveViewport,
  setFocusFlashNodeId,
  zoomRef,
}: HostEffectsArgs): void {
  const { t } = useTranslation()
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const pendingFocusRef = React.useRef<PendingCanvasFocus | null>(null)
  const focusFlashTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const handleFocusNode = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: unknown; select?: unknown }>).detail
      const nodeId = detail?.nodeId
      // 「跳到这个节点」和「选中它」是两件事。默认两件一起做（「跳到源节点」「刚建好的那一个」
      // 都要接着就编辑），但**带我去看一批东西**的入口必须能只跳不选——选中会浮出那张
      // composer，把旁边的镜头盖住（golden 走查量到「第 2 镜没有可点中的位置」就是这么来的）。
      const select = detail?.select !== false
      if (typeof nodeId !== 'string' || !nodeId) return
      const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      if (!target) {
        toast(t('generationCommon.node.sourceNoLongerExists'), 'warning')
        return
      }
      const viewport = flow.getViewport()
      const focus: PendingCanvasFocus = {
        nodeId,
        categoryId: target.categoryId || 'shots',
        viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      }
      pendingFocusRef.current = focus
      setActiveCategoryId(target.categoryId || 'shots')
      if (select) selectNode(nodeId)
    }
    window.addEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
    return () => window.removeEventListener(FOCUS_GENERATION_NODE_EVENT, handleFocusNode)
  }, [flow, selectNode, setActiveCategoryId, t])

  React.useEffect(() => {
    const pending = pendingFocusRef.current
    const decision = resolvePendingCanvasFocus(
      pending,
      activeCategoryId,
      nodes,
      allNodes,
    )
    if (decision.type === 'wait') return
    pendingFocusRef.current = null
    if (decision.type === 'restore') {
      setLiveViewport(decision.viewport)
      // 直写前先取消在飞的自动让位（我们自己的 rAF 调度器），再以 duration=0 直写。
      cancelViewportAnimation()
      void flow.setViewport(decision.viewport, { duration: 0 })
      return
    }
    const size = resolveNodeVisualSize(decision.node)
    setFocusFlashNodeId(decision.node.id)
    if (focusFlashTimerRef.current !== null) window.clearTimeout(focusFlashTimerRef.current)
    focusFlashTimerRef.current = window.setTimeout(() => {
      setFocusFlashNodeId((current) => current === decision.node.id ? null : current)
      focusFlashTimerRef.current = null
    }, 1_400)
    // 聚焦跳转也走我们自己的调度器：React Flow 的 setCenter({ duration }) 同样是 d3 过渡，
    // 撞上 pane 那一帧 0×0 的 extent 缓存就会算出 NaN 视口，被打断时 promise 也永不结算。
    const stage = hostRef.current?.getBoundingClientRect()
    if (stage) {
      const focusZoom = resolveCanvasFocusZoom(size, stage, zoomRef.current || 1)
      animateViewportTo(
        focusZoom,
        {
          x: stage.width / 2 - (decision.node.position.x + size.width / 2) * focusZoom,
          y: stage.height / 2 - (decision.node.position.y + size.height / 2) * focusZoom,
        },
        220,
      )
    }
    return
  }, [activeCategoryId, allNodes, animateViewportTo, cancelViewportAnimation, flow, hostRef, nodes, setFocusFlashNodeId, setLiveViewport, zoomRef])

  React.useEffect(() => () => {
    if (focusFlashTimerRef.current !== null) window.clearTimeout(focusFlashTimerRef.current)
  }, [])

  // 以前这里还有一段「撤销掉被聚焦的节点 → 把视口退回聚焦前」：它是给「复制变体后程序自动聚焦过去」配的撤销对称。
  // 2026-09-25 起复制 / 落地都不再自动聚焦，聚焦只剩用户自己点的定位；撤销不再替他挪画布（程序不主动移动画布）。

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const updateSize = () => {
      const rect = host.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
      // 新东西落在可见区要知道「可见区多大」：store 层的 addNode 够不到这个组件，读的是这份发布值（canvasVisibleArea）。
      publishCanvasStageSize({ width: rect.width, height: rect.height })
    }
    updateSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize)
    observer?.observe(host)
    return () => observer?.disconnect()
  }, [hostRef, setStageSize])

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const aliases: Array<[string, string]> = [
      ['.react-flow__viewport', 'generation-canvas-v2__canvas'],
      ['.react-flow__edges', 'generation-canvas-v2__edges'],
      ['.react-flow__nodes', 'generation-canvas-v2__nodes'],
    ]
    const applyAliases = () => {
      for (const [selector, className] of aliases) host.querySelector(selector)?.classList.add(className)
    }
    applyAliases()
    const observer = new MutationObserver(applyAliases)
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [hostRef])
}

type BrowserAssetImportEffectsArgs = {
  activeCategoryId: string
  getInsertionPosition: () => { x: number; y: number }
  readOnly: boolean
}

export function useBrowserAssetImportEffects({
  activeCategoryId,
  getInsertionPosition,
  readOnly,
}: BrowserAssetImportEffectsArgs): void {
  const { t } = useTranslation()
  const handleImport = React.useCallback((assets: readonly BrowserAssetCanvasImportItem[]) => {
    if (readOnly) return
    const result = importBrowserAssetsToGenerationCanvas(assets, {
      basePosition: getInsertionPosition(),
      categoryId: activeCategoryId,
    })
    if (result.createdCount === 0) {
      toast(t('generationCommon.canvas.noImportableAssets'), 'info')
      return
    }
    toast(
      result.createdCount === 1
        ? t('generationCommon.canvas.importedOne')
        : t('generationCommon.canvas.importedMany', { count: result.createdCount }),
      'success',
    )
  }, [activeCategoryId, getInsertionPosition, readOnly, t])

  React.useEffect(() => subscribeBrowserAssetsImportToCanvas(handleImport), [handleImport])

  React.useEffect(() => {
    const bridge = getDesktopBridge()?.browser?.assetOverlay
    if (!bridge?.onImportToCanvas) return undefined
    return bridge.onImportToCanvas((payload) => {
      const assets = Array.isArray(payload?.assets) ? payload.assets as BrowserAssetCanvasImportItem[] : []
      handleImport(assets)
    })
  }, [handleImport])
}
