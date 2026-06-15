/**
 * 上手引导的「带我去」聚光：在真实控件上画一圈高亮 + 一句话气泡指明「在这里」。
 *
 * 原则（承袭已删的 WorkbenchTour，但由清单按需触发、不自动推进）：
 *  - **不压暗**主内容（Design.md：别让要看的东西变暗）；高亮环 pointer-events:none，
 *    用户能直接点真实控件。
 *  - **位置精准**：环按目标 getBoundingClientRect 实测绘制（视口坐标，跨画布平移/缩放仍准），
 *    用 rAF 持续重测——节点会随画布动、模式刚切换布局也在沉降。气泡视口 clamp，不溢出。
 *  - 点别处 / Esc / 该步完成 → 收起。
 *
 * 渲染在 React 树内（不 BodyPortal，保 --nomi-* token 作用域）。
 */
import React from 'react'
import { IconArrowRight } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { ChecklistStep } from './onboardingState'

type Rect = { left: number; top: number; width: number; height: number }

type SpotTarget = {
  /** 目标控件选择器（按序取第一个命中且可见的）。 */
  selectors: string[]
  /** 气泡标题（带步号）与一句话指引。 */
  title: string
  hint: string
}

/** 每步指向的真实控件 + 文案。选择器来自现状勘察（顶栏常驻 / 创作输入 / 画布节点 / 预览导出）。 */
const SPOTLIGHT_TARGETS: Record<ChecklistStep, SpotTarget> = {
  model: {
    selectors: ['.nomi-appbar__ghost[aria-label="打开模型接入"]', '[aria-label="模型接入"]'],
    title: '① 接入模型',
    hint: '点这里接入一个 AI 服务（用你自己的 Key，Nomi 不另收费）。',
  },
  storyboard: {
    selectors: ['[data-tour="storyboard-cta"]', '[aria-label="展开创作助手"]'],
    title: '② 拆一个镜头',
    hint: '在这里跟创作助手说「拆成镜头」，它会把故事铺成画布。',
  },
  generated: {
    selectors: [
      '.generation-canvas-v2-node [aria-label="生成素材"]',
      '.generation-canvas-v2-node [aria-label="重新生成"]',
      '.generation-canvas-v2-node',
    ],
    title: '③ 生成一张',
    hint: '在镜头卡里选好模型，点「生成」开始出图。',
  },
  exported: {
    selectors: ['.workbench-preview-player__export-button', '.nomi-appbar__primary'],
    title: '④ 导出成片',
    hint: '排进时间轴后，点这里导出 MP4。',
  },
}

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
  step: ChecklistStep
  /** 是否是末步——决定主按钮是「下一步」还是「完成」。 */
  isLast: boolean
  /** 手动推进到下一步（不要求真完成；真完成会另由清单自动打勾）。 */
  onNext: () => void
  onDismiss: () => void
}

export function OnboardingSpotlight({ step, isLast, onNext, onDismiss }: Props): JSX.Element | null {
  const target = SPOTLIGHT_TARGETS[step]
  const [rect, setRect] = React.useState<Rect | null>(null)
  const calloutRef = React.useRef<HTMLDivElement | null>(null)
  const [calloutH, setCalloutH] = React.useState(96)

  // rAF 持续实测目标几何：模式刚切换布局在沉降、画布会平移/缩放，位置必须实时跟随才精准。
  React.useEffect(() => {
    setRect(null)
    let raf = 0
    const tick = () => {
      setRect(measure(target.selectors))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [target])

  React.useLayoutEffect(() => {
    if (calloutRef.current) setCalloutH(calloutRef.current.offsetHeight)
  }, [rect, step])

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
        aria-label={target.title}
        className={cn(
          'fixed z-[3401] flex flex-col gap-1 p-3',
          'rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg',
        )}
        style={{ left: pos.left, top: pos.top, width: CALLOUT_WIDTH }}
      >
        <div className="text-caption font-bold text-nomi-accent">{target.title}</div>
        <p className="m-0 text-body-sm text-nomi-ink-80 leading-snug">{target.hint}</p>
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              'inline-flex items-center h-7 px-2.5 rounded-full border-0 bg-transparent cursor-pointer font-inherit',
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
            {isLast ? '完成' : '下一步'}
            {isLast ? null : <IconArrowRight size={13} stroke={2} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </>
  )
}
