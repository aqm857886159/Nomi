// 首次进入导演台的三步教练标注（2026-07-11 用户拍板方案 A）。
// 断层依据（真机冷启动走查）：导演台三个核心能力全是隐藏状态——「操控」要先选中假人才出现、
// 姿势藏在属性第二个 tab、运镜预设要先选中相机才解锁；第一屏零提示。
// 三步分别指向左列表假人行 / 相机行 / 底部「添加」，可跳过、只出现一次（onboardingState 持久化）。
import React from 'react'
import { hasSeenScene3DCoach, markScene3DCoachSeen } from '../../../onboarding/onboardingState'

const STEPS = [
  {
    coach: 'mannequin-row',
    title: '点假人，人就归你管',
    body: '右侧出「姿势」面板一键换姿势；头顶出「操控」——进去 WASD 走位、录 take。',
  },
  {
    coach: 'camera-row',
    title: '点相机，运镜归你调',
    body: '选中相机出画面预览和「运镜预设」——推近 / 环绕 / 希区柯克变焦，13 招一键落轨迹。',
  },
  {
    coach: 'add-button',
    title: '场景不用自己搭',
    body: '「添加」里有城市街道 / 室内房间场景模板，还有车、树、路灯这些道具。',
  },
] as const

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
    const target = shell.querySelector(`[data-coach="${STEPS[index].coach}"]`)
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
    // 目标控件不存在（布局变了/只读态）就直接结束，绝不挡人。
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
  // 卡片钳制进外壳边界：默认贴目标右侧同高；越界则回收（底部锚点时自动落到目标上方）。
  const CARD_W = 256
  const CARD_H = 132
  const cardLeft = Math.min(Math.max(rect.left + rect.width + 12, 8), rect.hostWidth - CARD_W - 8)
  const below = rect.top
  const cardTop = below + CARD_H + 8 > rect.hostHeight ? rect.top - CARD_H - 10 : Math.max(40, below)

  return (
    <div ref={hostRef} className="absolute inset-0 z-[6]">
      {/* 压暗层：2026-07-11 悬案已破——「类不上屏」真因是 r3f Canvas 初始化自 suspend 让 React 把整棵
          外壳 display:none（hideInstance），类本身无辜；Canvas 已上 FencedCanvas 围栏，此处回归 token 类。 */}
      <div className="absolute inset-0 bg-nomi-ink/45" onClick={finish} />
      <div
        className="pointer-events-none absolute rounded-nomi border-2 border-nomi-paper shadow-nomi-md"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        className="absolute w-64 rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
        style={{ left: cardLeft, top: cardTop }}
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

export { hasSeenScene3DCoach }
