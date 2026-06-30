/**
 * 新手上手手册面板（App 内出口）。读唯一内容源 handbookContent，原生离线、跟随明暗 token。
 * 外壳对齐 SkillLibraryPanel：mantine Portal 居中模态 + 背板点击/ESC 关闭 + token-only，不另造弹层（P1）。
 * iconKey → 已登记 vendor 组件经 HANDBOOK_ICON 映射；marketing/handbook.html 共用同一份数据（另一出口）。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconBox,
  IconDeviceGamepad2,
  IconGift,
  IconLayoutGrid,
  IconMap,
  IconMoodConfuzed,
  IconMovie,
  IconPencil,
  IconPlugConnectedX,
  IconScissors,
  IconTimeline,
  IconTypography,
  IconUserCheck,
  IconVolumeOff,
  IconWand,
  IconX,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiWordmark } from '../../design'
import {
  HANDBOOK_FIRST_WIN,
  HANDBOOK_GOTCHAS,
  HANDBOOK_INTENT_ROUTES,
  HANDBOOK_PIPELINE,
  HANDBOOK_SUBTITLE,
  HANDBOOK_TITLE,
} from './handbookContent'

type Props = {
  opened: boolean
  onClose: () => void
}

/** iconKey（kebab）→ vendor 已登记组件。新增 iconKey 时同步补这里 + vendor 登记。 */
const HANDBOOK_ICON: Record<string, Icon> = {
  pencil: IconPencil,
  scissors: IconScissors,
  'layout-grid': IconLayoutGrid,
  wand: IconWand,
  timeline: IconTimeline,
  movie: IconMovie,
  'user-check': IconUserCheck,
  box: IconBox,
  'device-gamepad-2': IconDeviceGamepad2,
  gift: IconGift,
  typography: IconTypography,
  'alert-triangle': IconAlertTriangle,
  'plug-connected-x': IconPlugConnectedX,
  'mood-confuzed': IconMoodConfuzed,
  'alert-circle': IconAlertCircle,
  'volume-off': IconVolumeOff,
}

function HandbookIcon({ iconKey, size, className }: { iconKey: string; size: number; className?: string }): JSX.Element | null {
  const Cmp = HANDBOOK_ICON[iconKey]
  if (!Cmp) return null
  return <Cmp size={size} stroke={1.6} className={className} />
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className={cn('text-body font-semibold text-nomi-ink m-0')}>{children}</h2>
}

export function HandbookPanel({ opened, onClose }: Props): JSX.Element | null {
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  if (!opened) return null

  return (
    <Portal>
      <div
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4000, background: 'var(--nomi-scrim)', animation: 'nomi-fade 140ms cubic-bezier(.2,.7,.3,1)' }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-label="上手手册"
          className={cn('w-[680px] max-w-full max-h-[86vh] flex flex-col overflow-hidden', 'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg')}
          style={{ animation: 'nomi-panel-pop 160ms cubic-bezier(.2,.7,.3,1)' }}
        >
          {/* 头部 */}
          <div className={cn('flex items-center gap-2 px-5 pt-4 pb-3 border-b border-nomi-line')}>
            <IconMap size={18} stroke={1.6} className={cn('text-nomi-accent')} />
            <b className={cn('text-title font-bold text-nomi-ink')}>{HANDBOOK_TITLE}</b>
            <NomiWordmark fontSize={13} className={cn('text-nomi-ink-40')} />
            <span className={cn('flex-1')} />
            <button
              type="button"
              className={cn('w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent', 'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
              aria-label="关闭上手手册"
              onClick={onClose}
            >
              <IconX size={16} stroke={2} />
            </button>
          </div>

          {/* 正文（滚动区） */}
          <div className={cn('flex-1 overflow-auto px-5 py-4 flex flex-col gap-5')}>
            <p className={cn('text-caption text-nomi-ink-40 m-0')}>{HANDBOOK_SUBTITLE}</p>

            {/* 流水线一行图 */}
            <div className={cn('rounded-nomi bg-nomi-ink-05 px-4 py-3')}>
              <div className={cn('text-micro text-nomi-ink-40 mb-2')}>一条流水线，全程在你眼皮底下</div>
              <div className={cn('flex items-center flex-wrap gap-1.5')}>
                {HANDBOOK_PIPELINE.map((step, i) => (
                  <React.Fragment key={step.label}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-nomi-sm text-body-sm',
                        step.accent ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-paper border border-nomi-line text-nomi-ink-80',
                      )}
                    >
                      <HandbookIcon iconKey={step.iconKey} size={15} />
                      {step.label}
                    </span>
                    {i < HANDBOOK_PIPELINE.length - 1 ? <IconArrowRight size={14} stroke={1.6} className={cn('text-nomi-ink-40')} /> : null}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* 90 秒首胜 */}
            <section className={cn('flex flex-col gap-2')}>
              <SectionTitle>90 秒先尝到甜头</SectionTitle>
              <p className={cn('text-caption text-nomi-ink-60 m-0')}>不用读完手册——先看一条片自己跑出来，再上手做你自己的。</p>
              <div className={cn('grid gap-2.5 grid-cols-2 max-[560px]:grid-cols-1')}>
                {HANDBOOK_FIRST_WIN.map((step) => (
                  <div key={step.n} className={cn('rounded-nomi border border-nomi-line bg-nomi-paper p-3')}>
                    <div className={cn('flex items-center gap-2 mb-1')}>
                      <span className={cn('grid place-items-center w-5 h-5 rounded-full bg-nomi-accent-soft text-nomi-accent text-micro font-semibold')}>{step.n}</span>
                      <span className={cn('text-body-sm font-medium text-nomi-ink')}>{step.title}</span>
                    </div>
                    <div className={cn('text-caption text-nomi-ink-60 leading-relaxed')}>{step.body}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 我想做 X → 走这条路 */}
            <section className={cn('flex flex-col gap-2')}>
              <SectionTitle>我想做 X → 走这条路</SectionTitle>
              <p className={cn('text-caption text-nomi-ink-60 m-0')}>能做的指清楚路径，做不到的当场标，不让你撞墙找半天。</p>
              <div className={cn('flex flex-col border border-nomi-line rounded-nomi overflow-hidden')}>
                {HANDBOOK_INTENT_ROUTES.map((route, i) => (
                  <div
                    key={route.title}
                    className={cn(
                      'flex gap-3 px-3.5 py-2.5',
                      i > 0 && 'border-t border-nomi-line',
                      route.warn ? 'bg-nomi-ink-05' : i % 2 === 0 ? 'bg-nomi-paper' : 'bg-nomi-ink-05',
                    )}
                  >
                    <HandbookIcon iconKey={route.iconKey} size={18} className={cn('mt-0.5 shrink-0', route.warn ? 'text-nomi-ink-40' : 'text-nomi-ink-60')} />
                    <div className={cn('min-w-0')}>
                      <div className={cn('flex items-center gap-2 flex-wrap')}>
                        <span className={cn('text-body-sm font-medium', route.warn ? 'text-nomi-ink-60' : 'text-nomi-ink')}>{route.title}</span>
                        {route.badge ? <span className={cn('text-micro px-1.5 py-0.5 rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent')}>{route.badge}</span> : null}
                      </div>
                      <div className={cn('text-caption mt-0.5', route.warn ? 'text-nomi-ink-40' : 'text-nomi-ink-60')}>{route.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 卡住了看这里 */}
            <section className={cn('flex flex-col gap-2')}>
              <SectionTitle>卡住了看这里</SectionTitle>
              <div className={cn('grid gap-2.5 grid-cols-2 max-[560px]:grid-cols-1')}>
                {HANDBOOK_GOTCHAS.map((g) => (
                  <div key={g.title} className={cn('rounded-nomi bg-nomi-ink-05 p-3')}>
                    <div className={cn('flex items-center gap-2 mb-1 text-body-sm font-medium text-nomi-ink')}>
                      <HandbookIcon iconKey={g.iconKey} size={16} className={cn('text-nomi-ink-60 shrink-0')} />
                      {g.title}
                    </div>
                    <div className={cn('text-caption text-nomi-ink-60 leading-relaxed')}>{g.body}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </Portal>
  )
}
