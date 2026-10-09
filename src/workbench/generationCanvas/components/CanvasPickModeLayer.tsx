import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPointer } from '../../../vendor/tablerIcons'
import { cancelCanvasPickMode, handleCanvasPickModeKeyDown, pickCanvasNode, useCanvasPickModeStore } from '../store/canvasPickMode'

/**
 * 「在画布上点选」的界面（状态在 store/canvasPickMode，一个调用 `enterCanvasPickMode` 就进来）：
 * 顶部一条「选择要引用的节点 · Esc」，接管画布上的指针——点 eligible 的卡 = 选中它（回调一次）、点空白 = 取消、
 * 点灰掉的卡 = 什么都不做；Esc 取消。卡的描边 / 变灰在 GenerationFlowNodeView，变暗在 CanvasPickModeDim。
 * 视觉正本：自动引用样张 autoref-06（D-autoref 线）。
 */
export function CanvasPickModeLayer(): JSX.Element | null {
  const { t } = useTranslation()
  const active = useCanvasPickModeStore((state) => state.request !== null)
  React.useEffect(() => {
    if (!active) return undefined
    // 按下那一下定下结果；同一次点击后面的 mouseup / click 一起吞掉，免得落到卡上又选中 / 拖动它。
    let swallowUntilClick = false
    const inBar = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-canvas-pick-bar]'))
    const onPointerDown = (event: PointerEvent) => {
      if (inBar(event.target)) return
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.generation-canvas-react-flow')) {
        cancelCanvasPickMode()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      swallowUntilClick = true
      const nodeId = target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id
      if (nodeId) pickCanvasNode(nodeId)
      else cancelCanvasPickMode()
    }
    const swallow = (event: Event) => {
      if (!swallowUntilClick || inBar(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click') swallowUntilClick = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handleCanvasPickModeKeyDown(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    for (const type of ['mousedown', 'pointerup', 'mouseup', 'click'] as const) window.addEventListener(type, swallow, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      for (const type of ['mousedown', 'pointerup', 'mouseup', 'click'] as const) window.removeEventListener(type, swallow, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active])
  if (!active) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-[30] -translate-x-1/2">
      <div
        data-canvas-pick-bar="true"
        role="status"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-pill border border-nomi-line bg-nomi-paper py-1 pl-3 pr-1 text-caption text-nomi-ink shadow-nomi-md"
      >
        <IconPointer size={15} stroke={1.7} className="text-nomi-accent" aria-hidden="true" />
        <span className="font-medium">{t('generationCommon.canvas.pickMode.title')}</span>
        <button
          type="button"
          aria-label={t('generationCommon.canvas.pickMode.exit')}
          onClick={() => cancelCanvasPickMode()}
          className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-pill border border-nomi-line bg-nomi-ink-05 px-2 text-micro font-medium text-nomi-ink-60 hover:text-nomi-ink"
        >
          {t('generationCommon.canvas.pickMode.escKey')}
        </button>
      </div>
    </div>
  )
}

/** 点选进行中把画布底（点阵 / 背景）压暗；卡和连线在它之上（React Flow 的渲染层 z-index 4 > 3）。挂在 <ReactFlow> 里。 */
export function CanvasPickModeDim(): JSX.Element | null {
  const active = useCanvasPickModeStore((state) => state.request !== null)
  return active ? <div aria-hidden="true" data-canvas-pick-dim="true" className="pointer-events-none absolute inset-0 z-[3] bg-nomi-ink/30" /> : null
}
