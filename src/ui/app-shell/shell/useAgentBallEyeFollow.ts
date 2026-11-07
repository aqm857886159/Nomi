// Agent 小球的眼睛跟着鼠标看（拍板 docs/design/boards/2026-10-27-agent-persona/ 的 persona.eyes / Q9）。
//
// 只在真的有指针移动时算：pointermove 只记坐标，一帧最多算一次（rAF 合并）；算出来只写宿主按钮上的两个
// CSS 变量（--nomi-agent-look-x / -y，NomiAgentFace 的眼睛那一层读它们），不写 Zustand、不进 React state，
// 所以跟随永远不触发重渲染。离小球中心 160px 以外归位一次、之后不再写；鼠标停在身上 = 抬眼。
// 鼠标离开窗口、窗口失焦也归位；卸载时取消还没跑的那一帧、摘掉监听。系统开了减弱动效就不挂监听（眼睛不跟、不抬）。
// 空闲时（鼠标不动）这里不请求任何动画帧。设计卡 docs/plan/2026-10-27-agent-persona.md ★7。
import React from 'react'

/** 只在鼠标离小球中心约这么远以内才跟着看（拍板 Q9）。 */
export const AGENT_EYE_FOLLOW_RADIUS_PX = 160
/** 舞台边长（= BALL_SIZE）与形象单位数：1 个形象单位 = 44 / 28 px。 */
const STAGE_PX = 44
const STAGE_UNITS = 28
const UNIT_PX = STAGE_PX / STAGE_UNITS
/** 眼睛最多偏多远（形象单位）：左右 2.3、上下 1.6；停在身上时抬 0.8（照拍板小样的热区规则）。 */
const LOOK_X_UNITS = 2.3
const LOOK_Y_UNITS = 1.6
const LIFT_UNITS = 0.8

export const AGENT_LOOK_X = '--nomi-agent-look-x'
export const AGENT_LOOK_Y = '--nomi-agent-look-y'

type Rect = Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>

/**
 * 指针在 (x, y) 时眼睛该往哪偏（px）。null = 太远了，归位。
 * 舞台（44×44）贴在按钮右缘：胶囊往左长时，眼睛看的中心仍按右下那颗球的位置算。
 */
export function agentEyeLook(rect: Rect, x: number, y: number): { x: number; y: number } | null {
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { x: 0, y: round(-LIFT_UNITS * UNIT_PX) }
  const cx = rect.right - STAGE_PX / 2
  const cy = (rect.top + rect.bottom) / 2
  const dx = x - cx
  const dy = y - cy
  const distance = Math.hypot(dx, dy)
  if (distance > AGENT_EYE_FOLLOW_RADIUS_PX || distance === 0) return null
  return { x: round((dx / distance) * LOOK_X_UNITS * UNIT_PX), y: round((dy / distance) * LOOK_Y_UNITS * UNIT_PX) }
}

const round = (value: number): number => Math.round(value * 10) / 10 || 0

/** 把跟随挂到宿主元素上（右下小球的原生按钮）。 */
export function useAgentBallEyeFollow(target: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const element = target.current
    if (!element || typeof window === 'undefined') return undefined
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let frame = 0
    let pointer: { x: number; y: number } | null = null
    let written: string | null = null
    const write = (look: { x: number; y: number } | null): void => {
      const key = look ? `${look.x},${look.y}` : null
      if (key === written) return
      written = key
      if (look) {
        element.style.setProperty(AGENT_LOOK_X, `${look.x}px`)
        element.style.setProperty(AGENT_LOOK_Y, `${look.y}px`)
      } else {
        element.style.removeProperty(AGENT_LOOK_X)
        element.style.removeProperty(AGENT_LOOK_Y)
      }
    }
    const flush = (): void => {
      frame = 0
      if (pointer) write(agentEyeLook(element.getBoundingClientRect(), pointer.x, pointer.y))
    }
    const onMove = (event: PointerEvent): void => {
      pointer = { x: event.clientX, y: event.clientY }
      if (!frame) frame = window.requestAnimationFrame(flush)
    }
    const rest = (): void => {
      pointer = null
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      write(null)
    }
    const root = document.documentElement
    const attach = (): void => {
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('blur', rest)
      root.addEventListener('pointerleave', rest)
    }
    const detach = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', rest)
      root.removeEventListener('pointerleave', rest)
      rest()
    }
    const sync = (): void => (media?.matches ? detach() : attach())
    sync()
    media?.addEventListener('change', sync)
    return () => {
      media?.removeEventListener('change', sync)
      detach()
    }
  }, [target])
}
