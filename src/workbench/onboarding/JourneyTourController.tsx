/**
 * 引导旅途的渲染器：纯订阅 journeyTourStore，渲染当前 beat（cinematic 气泡 / spotlight / finale）。
 *
 * 不持有运行状态——回放序列由 journeyTourStore 的模块级 runner 驱动（remount 安全）。这里只负责
 * 把当前 beat 画出来 + 把按钮接到 store 的 advance/skip/finish。挂在 studio 视图（NomiStudioApp）。
 */
import React from 'react'
import { IconCheck, IconPlayerPlay } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { OnboardingSpotlight } from './OnboardingSpotlight'
import { useJourneyTourStore } from './journeyTourStore'
import { TOUR_TEACH_TOTAL } from './journeyTour'

export function JourneyTourController({ onStartReal }: { onStartReal: () => void }): JSX.Element | null {
  const active = useJourneyTourStore((s) => s.active)
  const phase = useJourneyTourStore((s) => s.phase)
  const beat = useJourneyTourStore((s) => s.beat)
  const teachIndex = useJourneyTourStore((s) => s.teachIndex)
  const selectors = useJourneyTourStore((s) => s.selectors)
  const advance = useJourneyTourStore((s) => s.advance)
  const skip = useJourneyTourStore((s) => s.skip)
  const finish = useJourneyTourStore((s) => s.finish)

  if (!active) return null

  if (phase === 'finale') {
    return (
      <div
        className="fixed inset-0 z-[3402] grid place-items-center bg-nomi-scrim"
        data-journey-tour="finale"
        role="dialog"
        aria-label="引导结束"
      >
        <div className="w-[400px] max-w-[88vw] flex flex-col items-center gap-3 p-7 rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg text-center">
          <span className="grid place-items-center size-11 rounded-full bg-nomi-accent-soft text-nomi-accent">
            <IconCheck size={22} stroke={1.8} aria-hidden="true" />
          </span>
          <div className="text-title font-semibold text-nomi-ink">这就是全程，现在轮到你</div>
          <p className="m-0 text-body-sm text-nomi-ink-60 leading-snug">
            从一句话到成片，每一步都在你眼皮底下。要不要用你自己的故事走一遍？
          </p>
          <div className="flex items-center gap-2.5 mt-2">
            <button
              type="button"
              onClick={() => {
                finish()
                onStartReal()
              }}
              className={cn(
                'inline-flex items-center h-9 px-4 rounded-full border-0 cursor-pointer font-inherit',
                'bg-nomi-ink text-nomi-paper text-body-sm font-medium transition-colors hover:bg-nomi-accent',
              )}
            >
              用我自己的故事走一遍
            </button>
            <button
              type="button"
              onClick={finish}
              className={cn(
                'inline-flex items-center h-9 px-4 rounded-full border border-nomi-line bg-nomi-paper cursor-pointer font-inherit',
                'text-body-sm text-nomi-ink-80 transition-colors hover:bg-nomi-ink-05',
              )}
            >
              先逛逛
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!beat) return null

  if (beat.kind === 'spotlight') {
    return (
      <OnboardingSpotlight
        selectors={selectors ?? beat.selectors ?? []}
        title={beat.title}
        body={beat.body}
        stepLabel={`讲解 ${teachIndex}/${TOUR_TEACH_TOTAL}`}
        primaryLabel={teachIndex >= TOUR_TEACH_TOTAL ? '完成' : '下一步'}
        onNext={advance}
        onDismiss={skip}
      />
    )
  }

  // cinematic：底部居中气泡 + 自动播放提示，无「下一步」（自动推进）。
  return (
    <div
      className="fixed left-1/2 bottom-7 -translate-x-1/2 z-[3401] w-[320px] max-w-[88vw] flex flex-col gap-1 p-3 rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg"
      data-journey-tour="cinematic"
      role="status"
    >
      <div className="text-caption font-bold text-nomi-accent">{beat.title}</div>
      <p className="m-0 text-body-sm text-nomi-ink-80 leading-snug">{beat.body}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="inline-flex items-center gap-1 text-micro text-nomi-ink-40">
          <IconPlayerPlay size={11} stroke={1.8} aria-hidden="true" />
          自动播放中
        </span>
        <button
          type="button"
          onClick={skip}
          className="ml-auto inline-flex items-center h-7 px-2.5 rounded-full border-0 bg-transparent cursor-pointer font-inherit text-caption text-nomi-ink-40 transition-colors hover:text-nomi-ink"
        >
          跳过
        </button>
      </div>
    </div>
  )
}
