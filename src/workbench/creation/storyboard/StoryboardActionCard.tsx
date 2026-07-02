import React from 'react'
import { IconArrowRight, IconMovie, IconPhoto, IconUserPlus } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'

/**
 * 跨面板动作卡：创作助手识别到「拆镜头 / 立角色卡」意图后，不再静默直接开跑，
 * 而是在对话流里推这张可见的卡，用户点按钮才真正落画布（治隐形）。
 * 纯视图——文案/图标按 kind 派生（P4 通用，不为两种动作写两套），点击回调与消费态由父组件持有。
 *
 * 拆镜头带「图片分镜 / 视频分镜」二选一（默认图片，用户拍板 2026-07-02 image-first）：
 * 图片分镜 = 每镜一张静态画面（图生图，无时长/运镜）；视频分镜 = 每镜一段视频（带时长）。
 * 模式在点按钮那一刻随 onRun 传出 → 注入 planner 的拆镜头指令。
 */
type StoryboardActionKind = 'storyboard' | 'fixation'
export type StoryboardShotMode = 'image' | 'video'

const ACTION_COPY: Record<StoryboardActionKind, { lead: string; cta: string; Icon: typeof IconMovie }> = {
  storyboard: { lead: '看起来你想把故事拆成镜头。', cta: '拆成镜头 · 落画布', Icon: IconMovie },
  fixation: { lead: '看起来你想给角色立卡。', cta: '立角色卡', Icon: IconUserPlus },
}

const MODE_OPTIONS: Array<{ value: StoryboardShotMode; label: string; Icon: typeof IconMovie }> = [
  { value: 'image', label: '图片分镜', Icon: IconPhoto },
  { value: 'video', label: '视频分镜', Icon: IconMovie },
]

export default function StoryboardActionCard({
  kind,
  resolved,
  onRun,
}: {
  kind: StoryboardActionKind
  resolved: boolean
  onRun: (shotMode: StoryboardShotMode) => void
}): JSX.Element {
  const { lead, cta, Icon } = ACTION_COPY[kind]
  const [mode, setMode] = React.useState<StoryboardShotMode>('image')
  return (
    <div className={cn('flex flex-col gap-2 p-3 rounded-nomi border border-nomi-line bg-nomi-paper')} data-action-card={kind}>
      <div className={cn('flex items-center gap-2 min-w-0')}>
        <Icon size={15} stroke={1.6} className={cn('shrink-0 text-nomi-ink-60')} />
        <span className={cn('min-w-0 flex-1 text-body-sm text-nomi-ink-80 leading-relaxed')}>{lead}</span>
      </div>
      {kind === 'storyboard' ? (
        <div className={cn('flex items-center gap-1')} role="radiogroup" aria-label="分镜类型">
          {MODE_OPTIONS.map((option) => {
            const active = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={resolved}
                onClick={() => setMode(option.value)}
                data-shot-mode={option.value}
                className={cn(
                  'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-caption border whitespace-nowrap shrink-0',
                  active
                    ? 'border-nomi-ink bg-nomi-ink text-nomi-paper font-medium'
                    : 'border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80 hover:border-nomi-ink-20',
                )}
              >
                <option.Icon size={12} stroke={1.8} />
                {option.label}
              </button>
            )
          })}
          <span className={cn('text-micro text-nomi-ink-40 ml-1 min-w-0 truncate')}>
            {mode === 'image' ? '每镜一张静态画面，满意后可转视频' : '每镜一段带时长的视频'}
          </span>
        </div>
      ) : null}
      <WorkbenchButton
        variant="primary"
        size="sm"
        className={cn('self-start')}
        disabled={resolved}
        onClick={() => onRun(mode)}
        data-action-run={kind}
      >
        <Icon size={14} stroke={1.7} />
        {resolved ? '已开始' : cta}
        {!resolved ? <IconArrowRight size={13} stroke={1.7} /> : null}
      </WorkbenchButton>
    </div>
  )
}
