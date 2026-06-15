/**
 * 工作台三步引导（v3 spec C 屏）。
 *
 * 原则：锚定真实 UI、不做 scrim 压暗（避免「让用户看的内容反而变暗/被挡」）、
 * callout 不复制动作按钮——推进 = 用户点真实按钮（做即学）：
 *   1/3 创作：spotlight「拆镜头」chip；点它（launchStoryboardPlanning 会切到
 *       generation）→ 自动进第 2 步
 *   2/3 生成：画布节点出现前显示等待文案（拆镜是真实 LLM 调用，不许卡死——
 *       超时给指路 + 始终可跳过）；节点出现后讲解卡片，「下一步」切预览
 *   3/3 预览：锚定右上「导出」，完成写持久化标记
 *
 * 渲染在 WorkbenchShell 根内（不 BodyPortal——portal 到 body 会丢 --nomi-* token
 * 作用域，见 CreationAiPanel 全屏 portal 的补类处理）。fixed 定位 + 视口 clamp。
 */
import React from 'react'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import {
  WORKBENCH_TOUR_REQUEST_EVENT,
  consumeWorkbenchTourRequest,
  readWorkbenchTourFlag,
  writeWorkbenchTourFlag,
} from './workbenchTourState'

type TourStep = 1 | 2 | 3

/** 每步锚点选择器（按序取第一个命中的）。 */
const STEP_TARGET_SELECTORS: Record<TourStep, string[]> = {
  1: ['[data-tour="storyboard-cta"]', '[aria-label="展开创作助手"]'],
  2: ['.generation-canvas-v2-node', '.workbench-shell__body'],
  3: ['.nomi-appbar__primary'],
}

type Placement = 'left' | 'right' | 'below'

const STEP_PLACEMENT: Record<TourStep, Placement> = { 1: 'left', 2: 'right', 3: 'below' }

const CALLOUT_WIDTH = 300
const VIEWPORT_MARGIN = 12
const TARGET_GAP = 16
/** 第 2 步等待超过这个时长还没有节点 → 给指路提示（拆镜可能慢/失败了）。 */
const STORYBOARD_WAIT_HINT_MS = 30_000

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

function measureTarget(step: TourStep): Rect | null {
  for (const selector of STEP_TARGET_SELECTORS[step]) {
    const el = document.querySelector(selector)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  return null
}

function computeCalloutPosition(target: Rect, placement: Placement, calloutHeight: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left: number
  let top: number
  if (placement === 'left') {
    left = target.left - CALLOUT_WIDTH - TARGET_GAP
    top = target.top + target.height / 2 - calloutHeight / 2
    if (left < VIEWPORT_MARGIN) left = target.right + TARGET_GAP
  } else if (placement === 'right') {
    left = target.right + TARGET_GAP
    top = target.top + target.height / 2 - calloutHeight / 2
    if (left + CALLOUT_WIDTH > vw - VIEWPORT_MARGIN) left = target.left - CALLOUT_WIDTH - TARGET_GAP
  } else {
    left = target.right - CALLOUT_WIDTH
    top = target.bottom + TARGET_GAP
  }
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - CALLOUT_WIDTH - VIEWPORT_MARGIN)
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - calloutHeight - VIEWPORT_MARGIN))
  return { left, top }
}

export function WorkbenchTour(): JSX.Element | null {
  const [active, setActive] = React.useState(false)
  const [step, setStep] = React.useState<TourStep>(1)
  const [target, setTarget] = React.useState<Rect | null>(null)
  const [waitHint, setWaitHint] = React.useState(false)
  const calloutRef = React.useRef<HTMLDivElement | null>(null)
  const [calloutHeight, setCalloutHeight] = React.useState(160)
  const step2EnteredAtRef = React.useRef(0)

  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const canvasNodeCount = useGenerationCanvasStore((state) => state.nodes.length)

  // 启动：挂载时消费 pending（tryExample 在本组件挂载前就会发请求）；挂载后收到
  // 事件即视为显式请求（pending 只为补挂载时序，不是事件的前置条件）。
  React.useEffect(() => {
    const tryActivate = (viaEvent: boolean) => {
      const requested = consumeWorkbenchTourRequest() || viaEvent
      if (!requested) return
      if (readWorkbenchTourFlag()) return
      setStep(1)
      setActive(true)
    }
    tryActivate(false)
    const handleEvent = () => tryActivate(true)
    window.addEventListener(WORKBENCH_TOUR_REQUEST_EVENT, handleEvent)
    return () => window.removeEventListener(WORKBENCH_TOUR_REQUEST_EVENT, handleEvent)
  }, [])

  // 步骤推进 = 跟随真实模式切换（点「拆镜头」会切 generation；用户自己点 stepper 同样推进）。
  React.useEffect(() => {
    if (!active) return
    if (workspaceMode === 'generation' && step === 1) {
      step2EnteredAtRef.current = Date.now()
      setWaitHint(false)
      setStep(2)
    } else if (workspaceMode === 'preview' && step < 3) {
      setStep(3)
    }
  }, [active, workspaceMode, step])

  // 第 2 步等待超时 → 指路提示（真实 LLM 调用可能慢/失败，引导不许卡死）。
  React.useEffect(() => {
    if (!active || step !== 2 || canvasNodeCount > 0) return
    const elapsed = Date.now() - step2EnteredAtRef.current
    const timer = window.setTimeout(() => setWaitHint(true), Math.max(0, STORYBOARD_WAIT_HINT_MS - elapsed))
    return () => window.clearTimeout(timer)
  }, [active, step, canvasNodeCount])

  // 锚点几何：轮询 + resize（节点会移动/出现，target 元素可能晚于步骤切换挂载）。
  React.useEffect(() => {
    if (!active) return
    const update = () => setTarget(measureTarget(step))
    update()
    const interval = window.setInterval(update, 400)
    window.addEventListener('resize', update)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('resize', update)
    }
  }, [active, step, canvasNodeCount])

  // callout 实高用于垂直定位（文案随步骤变，估高会漂）。
  React.useLayoutEffect(() => {
    const el = calloutRef.current
    if (el) setCalloutHeight(el.offsetHeight)
  }, [active, step, waitHint, canvasNodeCount])

  const finish = React.useCallback((flag: 'done' | 'skipped') => {
    writeWorkbenchTourFlag(flag)
    setActive(false)
  }, [])

  if (!active || !target) return null

  const placement = STEP_PLACEMENT[step]
  const position = computeCalloutPosition(target, placement, calloutHeight)
  const step2Waiting = step === 2 && canvasNodeCount === 0

  const content = step === 1
    ? {
        title: '先有故事',
        text: '示例故事已填好。在下方输入框直接说「拆成镜头」或「做成视频」，Nomi 就会把它变成画布上的镜头。',
      }
    : step === 2
      ? step2Waiting
        ? {
            title: '正在拆分镜…',
            text: waitHint
              ? '有点久了——可以在右侧助手里重发「拆镜头」，或先跳过引导自己逛逛。'
              : '镜头节点会逐个出现在画布上。',
          }
        : {
            title: '每个镜头是一张卡片',
            text: '在卡片里改提示词、选模型，「生成」开始出图。',
          }
      : {
          title: '连起来看',
          text: '镜头按顺序排进时间轴，右上「导出」输出 MP4。',
        }

  return (
    <>
      {/* spotlight 焦点环：盖在锚点上方，不拦截点击。圆角随目标自适应：
          chip/按钮（矮目标）用 pill，节点卡这类大块用标准圆角——pill 套大矩形会变巨型椭圆 */}
      <div
        data-workbench-tour-ring="true"
        aria-hidden="true"
        className={cn(
          'fixed z-[3500] pointer-events-none outline outline-2 outline-nomi-accent outline-offset-2',
          target.height <= 44 ? 'rounded-pill' : 'rounded-nomi',
        )}
        style={{ left: target.left, top: target.top, width: target.width, height: target.height }}
      />
      <div
        ref={calloutRef}
        data-workbench-tour-callout="true"
        role="dialog"
        aria-label={`引导第 ${step} 步`}
        className={cn(
          'fixed z-[3500] flex flex-col gap-1 p-4',
          'border border-nomi-line rounded-nomi-lg bg-nomi-paper shadow-nomi-lg',
        )}
        style={{ left: position.left, top: position.top, width: CALLOUT_WIDTH }}
      >
        <div className="text-micro font-bold tracking-wider text-nomi-ink-40">{step} / 3</div>
        <div className="text-title font-bold text-nomi-ink">{content.title}</div>
        <p className="m-0 mb-2 text-body-sm text-nomi-ink-60">{content.text}</p>
        <div className="flex items-center gap-2">
          {step === 2 && !step2Waiting ? (
            <button
              type="button"
              onClick={() => {
                setWorkspaceMode('preview')
                setStep(3)
              }}
              className={cn(
                'inline-flex items-center h-8 px-4 rounded-pill border-0 cursor-pointer font-inherit',
                'bg-nomi-ink text-nomi-paper text-body-sm font-medium transition-colors hover:bg-nomi-accent',
              )}
            >
              下一步：预览
            </button>
          ) : null}
          {step === 3 ? (
            <button
              type="button"
              onClick={() => finish('done')}
              className={cn(
                'inline-flex items-center h-8 px-4 rounded-pill border-0 cursor-pointer font-inherit',
                'bg-nomi-ink text-nomi-paper text-body-sm font-medium transition-colors hover:bg-nomi-accent',
              )}
            >
              开始创作
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => finish('skipped')}
            className={cn(
              'inline-flex items-center h-8 px-3 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
              'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
            )}
          >
            跳过引导
          </button>
        </div>
      </div>
    </>
  )
}
