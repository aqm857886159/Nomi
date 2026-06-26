/**
 * 引导旅途的聚光：在真实控件上画一圈高亮 + 一句话气泡指明「在这里」。
 *
 * 纯展示组件：高亮目标（selectors）、文案（title/body）、按钮回调全由调用方（JourneyTour）
 * 配置传入——不绑定任何固定步骤枚举，可服务任意一步引导。
 *
 * 原则（承袭已删的 WorkbenchTour）：
 *  - **不压暗**主内容（Design.md：别让要看的东西变暗）；高亮环 pointer-events:none，
 *    用户能直接点真实控件。
 *  - **位置精准**：环按目标 getBoundingClientRect 实测绘制（视口坐标，跨画布平移/缩放仍准），
 *    用 rAF 持续重测——节点会随画布动、模式刚切换布局也在沉降。气泡视口 clamp，不溢出。
 *  - 点别处 / Esc → onDismiss（跳过整条引导）。
 *
 * 渲染在 React 树内（不 BodyPortal，保 --nomi-* token 作用域）。
 */
import React from 'react'
import { IconArrowRight } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

type Rect = { left: number; top: number; width: number; height: number }

const RING_OUTSET = 4 // 环相对目标外扩，留呼吸
const VIEWPORT_MARGIN = 12
const CALLOUT_WIDTH = 232
const TARGET_GAP = 12

function measure(selectors: string[]): Rect | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    // 目标要在视口内（避免画布平移后指向屏外）
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  return null
}

/** 气泡放在目标下方优先，放不下翻到上方；横向以目标中心对齐再 clamp 进视口。 */
function calloutPosition(target: Rect, calloutH: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = target.top + target.height + TARGET_GAP
  if (top + calloutH > vh - VIEWPORT_MARGIN) {
    const above = target.top - TARGET_GAP - calloutH
    if (above >= VIEWPORT_MARGIN) top = above
  }
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - calloutH - VIEWPORT_MARGIN))
  let left = target.left + target.width / 2 - CALLOUT_WIDTH / 2
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - CALLOUT_WIDTH - VIEWPORT_MARGIN)
  return { left, top }
}

type Props = {
  /** 目标控件选择器（按序取第一个命中且可见的）；空数组 = 无目标，气泡兜底居中。 */
  selectors: string[]
  /** 气泡标题（如「① 一切从你的一句话开始」）。 */
  title: string
  /** 一句话指引。 */
  body: string
  /** 进度标（如「讲解 1/6」）；空则不显示。 */
  stepLabel?: string
  /** 主按钮文案（如「下一步」「完成」）。 */
  primaryLabel: string
  /** 推进到下一步。 */
  onNext: () => void
  /** 跳过整条引导（点别处 / Esc / 点跳过）。 */
  onDismiss: () => void
}

export function OnboardingSpotlight({
  selectors,
  title,
  body,
  stepLabel,
  primaryLabel,
  onNext,
  onDismiss,
}: Props): JSX.Element | null {
  const selectorKey = selectors.join('|')
  const [rect, setRect] = React.useState<Rect | null>(null)
  const calloutRef = React.useRef<HTMLDivElement | null>(null)
  const [calloutH, setCalloutH] = React.useState(96)

  // rAF 持续实测目标几何：模式刚切换布局在沉降、画布会平移/缩放，位置必须实时跟随才精准。
  React.useEffect(() => {
    setRect(null)
    if (selectors.length === 0) return
    let raf = 0
    const tick = () => {
      setRect(measure(selectors))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorKey])

  React.useLayoutEffect(() => {
    if (calloutRef.current) setCalloutH(calloutRef.current.offsetHeight)
  }, [rect, selectorKey])

  // 点别处 / Esc → 收起（pointerdown 捕获阶段，避免被画布吞掉）。
  React.useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (el && el.closest('[data-onboarding-spotlight-callout]')) return
      onDismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])

  // 目标未找到（如「生成」步但画布还没节点）→ 不画环，气泡落到屏幕下方居中兜底，
  // 让点「下一步」逐步走查时每步说明都看得到，不至于一片空白。
  const pos = rect
    ? calloutPosition(rect, calloutH)
    : {
        left: Math.max(VIEWPORT_MARGIN, Math.round((window.innerWidth - CALLOUT_WIDTH) / 2)),
        top: Math.max(VIEWPORT_MARGIN, Math.round(window.innerHeight * 0.62)),
      }
  // 矮目标（按钮/chip）用 pill 环；大块（节点卡）用标准圆角——pill 套大矩形会成巨型椭圆。
  const ringRadius = rect && rect.height <= 44 ? 'rounded-full' : 'rounded-nomi'

  return (
    <>
      {rect ? (
        <div
          data-onboarding-spotlight-ring="true"
          aria-hidden="true"
          className={cn('fixed z-[3400] pointer-events-none border-2 border-nomi-accent', ringRadius)}
          style={{
            left: rect.left - RING_OUTSET,
            top: rect.top - RING_OUTSET,
            width: rect.width + RING_OUTSET * 2,
            height: rect.height + RING_OUTSET * 2,
            boxShadow: '0 0 0 4px var(--nomi-accent-soft)',
          }}
        />
      ) : null}
      <div
        ref={calloutRef}
        data-onboarding-spotlight-callout="true"
        role="dialog"
        aria-label={title}
        className={cn(
          'fixed z-[3401] flex flex-col gap-1 p-3',
          'rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg',
        )}
        style={{ left: pos.left, top: pos.top, width: CALLOUT_WIDTH }}
      >
        <div className="text-caption font-bold text-nomi-accent">{title}</div>
        <p className="m-0 text-body-sm text-nomi-ink-80 leading-snug">{body}</p>
        <div className="flex items-center gap-2 mt-1">
          {stepLabel ? <span className="text-micro text-nomi-ink-40 tabular-nums">{stepLabel}</span> : null}
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              'ml-auto inline-flex items-center h-7 px-2.5 rounded-full border-0 bg-transparent cursor-pointer font-inherit',
              'text-caption text-nomi-ink-40 transition-colors hover:text-nomi-ink',
            )}
          >
            跳过
          </button>
          <button
            type="button"
            onClick={onNext}
            className={cn(
              'inline-flex items-center gap-1 h-7 px-3 rounded-full border-0 cursor-pointer font-inherit',
              'bg-nomi-ink text-nomi-paper text-caption font-medium transition-colors hover:bg-nomi-accent',
            )}
          >
            {primaryLabel}
            <IconArrowRight size={13} stroke={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  )
}
