import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { COMPOSER_ROOT_SELECTOR } from './canvasChromeLayers'

const SHADOW_MARGIN = 24
type Rect = { left: number; top: number; right: number; bottom: number }

/** 外框控件盒子被一组生成框压住的部分（相对外框控件自己的左上角）。纯函数，便于单测。 */
export function occludedHoles(dock: Rect, composers: readonly Rect[]): Rect[] {
  const holes: Rect[] = []
  for (const c of composers) {
    const left = Math.max(dock.left, c.left)
    const top = Math.max(dock.top, c.top)
    const right = Math.min(dock.right, c.right)
    const bottom = Math.min(dock.bottom, c.bottom)
    if (right - left > 0.5 && bottom - top > 0.5) holes.push({ left: left - dock.left, top: top - dock.top, right: right - dock.left, bottom: bottom - dock.top })
  }
  return holes
}

/** 把洞转成 clip-path。外框比盒子大一圈，别把投影一起剪掉；洞用反向缠绕（nonzero 下挖空）。没有洞返回 undefined（不加任何裁剪）。 */
export function clipPathForHoles(width: number, height: number, holes: readonly Rect[]): string | undefined {
  if (holes.length === 0) return undefined
  const m = SHADOW_MARGIN
  const outer = `M${-m} ${-m}H${width + m}V${height + m}H${-m}Z`
  const cut = holes.map((h) => `M${h.left} ${h.top}V${h.bottom}H${h.right}V${h.top}Z`).join('')
  return `path(nonzero,"${outer}${cut}")`
}

/**
 * 加节点条 / 缩放簇不许盖在节点生成框上（用户 2026-10-10 验收规则）。
 * 层级做不到（见 canvasChromeLayers.ts 顶部说明），所以把外框控件被生成框压住的那一块用 clip-path 裁掉：
 * 视觉与命中都等同于「生成框在上」。只在有节点被选中（才会有生成框）时跑，选中期间每帧量一次（生成框懒加载，挂上的时刻不定），值没变不写 DOM。
 */
export function useCanvasChromeOcclusion(ref: React.RefObject<HTMLElement | null>): void {
  const selectedCount = useGenerationCanvasStore((state) => state.selectedNodeIds.length)
  React.useEffect(() => {
    const el = ref.current
    const stage = el?.closest<HTMLElement>('[data-shortcut-surface="canvas"]')
    // 没有节点被选中就没有生成框，不用跑；生成框是懒加载的，选中之后多久挂上来不定，所以选中期间一直每帧量。
    if (!el || !stage || selectedCount === 0) return undefined
    let raf = 0
    let applied: string | undefined
    const apply = (value: string | undefined) => {
      if (value === applied) return
      applied = value
      if (value === undefined) el.style.removeProperty('clip-path')
      else el.style.clipPath = value
    }
    const tick = () => {
      const composers = [...stage.querySelectorAll<HTMLElement>(COMPOSER_ROOT_SELECTOR)]
        .filter((node) => getComputedStyle(node).visibility !== 'hidden')
        .map((node) => node.getBoundingClientRect())
      const box = el.getBoundingClientRect()
      const holes = occludedHoles(box, composers)
      apply(clipPathForHoles(box.width, box.height, holes))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      apply(undefined)
    }
  }, [ref, selectedCount])
}
