// 首次进入导演台的流程引导（2026-07-20 重写为 5 步旅程）。
// 原 3 步只指孤立动作（点假人/点相机/添加），用户不知道整体流程。
// 改成 5 步：摆场景 → 摆角色 → 摆相机 → 整运镜 → 出片，每步讲清"下一步干什么"。
// 角落可重看（不只第一次）。
import React from 'react'
import { markScene3DCoachSeen } from '../../../onboarding/onboardingState'

type CoachStep = {
  coach: string
  /** 主目标不在场时的兜底锚点（如整运镜面板要选中相机才渲染，兜底指相机行） */
  fallback?: string
  title: string
  body: string
}

const STEPS: readonly CoachStep[] = [
  {
    coach: 'add-button',
    title: '第 1 步 · 摆场景',
    body: '点「添加」选场景模板（城市街道/室内房间），再加道具和假人。场景是出片的地基。',
  },
  {
    coach: 'mannequin-row',
    title: '第 2 步 · 摆角色',
    body: '选中假人 → 头顶出「操控」→ WASD 走位、换姿势。角色是你运镜的焦点。',
  },
  {
    coach: 'camera-row',
    title: '第 3 步 · 摆相机',
    body: '加个相机 → 选中 → 右侧出运镜预设和画面预览。相机决定观众看到什么。',
  },
  {
    coach: 'camera-move-panel',
    fallback: 'camera-row',
    title: '第 4 步 · 整运镜',
    body: '选中相机后，右侧「运镜预设」13 招一键落轨迹（环绕/推近/希区柯克…），也可手动画轨迹、或录 take。',
  },
  {
    coach: 'export-button',
    title: '第 5 步 · 出片',
    body: '整完运镜，点「出片」→ 选「参考视频」→ 沿运镜渲染 mp4，自动喂给下游镜头。',
  },
]

interface TargetRect {
  left: number
  top: number
  width: number
  height: number
  hostWidth: number
  hostHeight: number
}

export function Scene3DCoachMarks({ onDone }: { onDone: () => void }): JSX.Element | null {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [step, setStep] = React.useState(0)
  const [rect, setRect] = React.useState<TargetRect | null>(null)

  const finish = React.useCallback(() => {
    markScene3DCoachSeen()
    onDone()
  }, [onDone])

  const measure = React.useCallback((index: number): TargetRect | null => {
    const host = hostRef.current
    const shell = host?.parentElement
    if (!shell) return null
    const spec = STEPS[index]
    const target = shell.querySelector(`[data-coach="${spec.coach}"]`)
      ?? (spec.fallback ? shell.querySelector(`[data-coach="${spec.fallback}"]`) : null)
    if (!target) return null
    const shellBox = shell.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    return {
      left: box.left - shellBox.left,
      top: box.top - shellBox.top,
      width: box.width,
      height: box.height,
      hostWidth: shellBox.width,
      hostHeight: shellBox.height,
    }
  }, [])

  React.useEffect(() => {
    // 目标控件不存在（布局变了/只读态/还没加相机）就跳到下一步，绝不挡人。
    const next = measure(step)
    if (!next) {
      if (step < STEPS.length - 1) setStep(step + 1)
      else finish()
      return
    }
    setRect(next)
    const onResize = () => setRect(measure(step))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [finish, measure, step])

  if (!rect) return <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[6]" />

  const current = STEPS[step]
  const CARD_W = 280
  const CARD_H = 148
  const cardLeft = Math.min(Math.max(rect.left + rect.width + 12, 8), rect.hostWidth - CARD_W - 8)
  const below = rect.top
  const cardTop = below + CARD_H + 8 > rect.hostHeight ? rect.top - CARD_H - 10 : Math.max(40, below)

  return (
    <div ref={hostRef} className="absolute inset-0 z-[6]">
      <div className="absolute inset-0 bg-nomi-ink/45" onClick={finish} />
      <div
        className="pointer-events-none absolute rounded-nomi border-2 border-nomi-paper shadow-nomi-md"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        className="absolute rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
        style={{ left: cardLeft, top: cardTop, width: CARD_W }}
      >
        <div className="text-caption font-medium text-nomi-ink">{current.title}</div>
        <div className="mt-1 text-micro leading-relaxed text-nomi-ink-60">{current.body}</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-micro text-nomi-ink-40">{step + 1} / {STEPS.length}</span>
          <span className="flex items-center gap-3">
            <button
              className="border-0 bg-transparent p-0 text-micro text-nomi-ink-60 hover:text-nomi-ink"
              type="button"
              onClick={finish}
            >
              跳过
            </button>
            <button
              className="rounded-nomi-sm border-0 bg-nomi-ink px-2.5 py-1 text-micro text-nomi-paper"
              type="button"
              onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}
            >
              {step < STEPS.length - 1 ? '下一步' : '开始使用'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
