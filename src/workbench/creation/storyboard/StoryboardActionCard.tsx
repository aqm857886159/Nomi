import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconMovie, IconPhoto, IconPhotoPlus, IconUserPlus, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'

/**
 * 跨面板动作卡：创作助手识别到「拆镜头 / 立角色卡」意图后，不再静默直接开跑，
 * 而是在对话流里推这张可见的卡，用户点按钮才真正落画布（治隐形）。
 * 纯视图——文案/图标按 kind 派生（P4 通用，不为两种动作写两套），点击回调与消费态由父组件持有。
 *
 * 拆镜头带「图片 / 视频 / 图片+视频」三选一（默认图片，用户拍板 2026-07-02 image-first）：
 * 图片分镜 = 每镜一张静态画面；视频分镜 = 每镜一段视频；图片+视频 = 每镜首帧图→视频。
 * 模式在点按钮那一刻随 onRun 传出 → 注入 planner 的拆镜头指令。
 */
type StoryboardActionKind = 'storyboard' | 'fixation'
export type StoryboardShotMode = 'image' | 'video' | 'image-video'

const ACTION_ICON: Record<StoryboardActionKind, typeof IconMovie> = {
  storyboard: IconMovie,
  fixation: IconUserPlus,
}

const MODE_OPTIONS: Array<{ value: StoryboardShotMode; labelKey: string; Icon: typeof IconMovie }> = [
  { value: 'image', labelKey: 'storyboardEditor.action.imageMode', Icon: IconPhoto },
  { value: 'video', labelKey: 'storyboardEditor.action.videoMode', Icon: IconMovie },
  { value: 'image-video', labelKey: 'storyboardEditor.action.imageVideoMode', Icon: IconPhotoPlus },
]

export default function StoryboardActionCard({
  kind,
  resolved,
  onRun,
  lead: leadOverride,
  onDismiss,
}: {
  kind: StoryboardActionKind
  resolved: boolean
  onRun: (shotMode: StoryboardShotMode) => void
  /** 覆盖默认引导语（情景卡自动浮现复用同一张卡，只换措辞——避免并行版 P1）。 */
  lead?: string
  /** 传了才渲染右上角「收起」——主动浮现的情景卡可关，聊天流里识别意图弹的卡不可关。 */
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const Icon = ACTION_ICON[kind]
  const defaultLead = kind === 'storyboard' ? t('storyboardEditor.action.storyboardLead') : t('storyboardEditor.action.fixationLead')
  const cta = kind === 'storyboard' ? t('storyboardEditor.action.storyboardCta') : t('storyboardEditor.action.fixationCta')
  const lead = leadOverride ?? defaultLead
  const [mode, setMode] = React.useState<StoryboardShotMode>('image')
  return (
    <div className={cn('flex flex-col gap-2 p-3 rounded-nomi border border-nomi-line bg-nomi-paper')} data-action-card={kind}>
      <div className={cn('flex items-center gap-2 min-w-0')}>
        <Icon size={15} stroke={1.6} className={cn('shrink-0 text-nomi-ink-60')} />
        <span className={cn('min-w-0 flex-1 text-body-sm text-nomi-ink-80 leading-relaxed')}>{lead}</span>
        {onDismiss ? (
          <button
            type="button"
            aria-label={t('storyboardEditor.action.dismiss')}
            onClick={onDismiss}
            className={cn('shrink-0 -mr-1 -mt-0.5 p-1 rounded-nomi-sm text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
          >
            <IconX size={13} stroke={1.8} />
          </button>
        ) : null}
      </div>
      {kind === 'storyboard' ? (
        <div className={cn('flex items-center gap-1')} role="radiogroup" aria-label={t('storyboardEditor.action.typeAria')}>
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
                {t(option.labelKey as 'storyboardEditor.action.imageMode')}
              </button>
            )
          })}
          <span className={cn('text-micro text-nomi-ink-40 ml-1 min-w-0 truncate')}>
            {mode === 'image'
              ? t('storyboardEditor.action.imageHint')
              : mode === 'image-video'
                ? t('storyboardEditor.action.imageVideoHint')
                : t('storyboardEditor.action.videoHint')}
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
        {resolved ? t('storyboardEditor.action.started') : cta}
        {!resolved ? <IconArrowRight size={13} stroke={1.7} /> : null}
      </WorkbenchButton>
    </div>
  )
}
