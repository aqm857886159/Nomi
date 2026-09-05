import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconLetterCase, IconMaximize, IconMinimize, IconPlayerPause, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward, IconSubtitles, IconVolume, IconVolumeOff } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import type { TimelineState } from '../timeline/timelineTypes'
import { TextClipStyleControls } from './TextClipStyleControls'
import { CONTROL_ICON_BUTTON_CLASS } from './previewControlTokens'

// 播放器控制条（2026-08-03 从 TimelinePreview 抽出：那个文件已 812 行超 800 门岗，
// 而控制条本来就是独立关注点）。
//
// 这一版把「作用域」讲清楚了。改之前 15 个控件横铺一行、长成同款 pill，里面混着三种作用域：
//   · 整片（画幅）· 当前片段（显示/缩放/重置）· 无作用域（播放/音量/文字/导出）
// 中间只有 5 道 w-px 分隔线，真机上淡到基本看不见——用户根本不知道自己改的是整片还是一段。
// 查了 FCP / DaVinci / Firefly / OpenCut：通行做法是**按作用域物理分区**（OpenCut 干脆让播放器条
// 只留传输控件、片段属性另开面板）。我们控件量小，取中间路线：**同一条，但分组带名字**，
// 且「这一段」那组写出当前片段名、没有目标时整组禁用并说明原因。
//
// 契约（设计系统 §4.1 C1/C4）：可点即有效，否则禁用 + 说明为什么。
// 禁用的 <button> 自己不触发 title，得靠外层 <span title> —— 沿用 NodeGenerationComposer 的既有范式。

/** 一组控件 + 组名。组名是这版的关键：作用域从「猜」变成「写着」。 */
export function ControlGroup({
  label,
  tone = 'plain',
  disabled = false,
  disabledReason,
  children,
}: {
  label?: string
  tone?: 'plain' | 'clip'
  disabled?: boolean
  disabledReason?: string
  children: React.ReactNode
}): JSX.Element {
  const group = (
    <div
      className={cn(
        'workbench-preview-player__control-group',
        'relative inline-flex flex-none items-center gap-1 rounded-nomi-sm px-2 py-1',
        label ? 'border border-[var(--workbench-border-soft)]' : 'border border-transparent',
        tone === 'clip' && !disabled && 'border-[var(--workbench-accent)] bg-[var(--workbench-accent-soft)]',
        disabled && 'opacity-45',
      )}
      aria-label={label}
      data-control-scope={tone === 'clip' ? 'clip' : 'film'}
    >
      {label ? (
        <span
          className={cn(
            'absolute -top-[7px] left-2 px-1 text-micro leading-none',
            'bg-[var(--nomi-paper)]',
            tone === 'clip' && !disabled ? 'text-[var(--workbench-accent)]' : 'text-[var(--workbench-muted-soft)]',
          )}
        >
          {label}
        </span>
      ) : null}
      {children}
    </div>
  )
  // 禁用整组时把原因挂在外层 span 上：内部按钮 disabled 后自身 title 不触发（浏览器行为）。
  return disabled && disabledReason ? <span title={disabledReason} style={{ display: 'contents' }}>{group}</span> : group
}

export type PreviewControlBarProps = {
  playing: boolean
  isEmpty: boolean
  onTogglePlayback: () => void
  onStepFrame: (delta: number) => void
  currentSeconds: string
  totalSeconds: string
  muted: boolean
  onMutedChange: (muted: boolean) => void
  volume: number
  onVolumeChange: (volume: number) => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  textMenuRef: React.RefObject<HTMLDivElement>
  textMenuOpen: boolean
  onTextMenuOpenChange: (open: boolean) => void
  onAddText: (style: 'caption' | 'title') => void
  timeline: TimelineState
  selectedTextClipId: string
}

export function PreviewControlBar({
  playing, isEmpty, onTogglePlayback, onStepFrame, currentSeconds, totalSeconds,
  muted, onMutedChange, volume, onVolumeChange, isFullscreen, onToggleFullscreen,
  textMenuRef, textMenuOpen, onTextMenuOpenChange, onAddText, timeline, selectedTextClipId,
}: PreviewControlBarProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('workbench-preview-player__control-bar', 'relative z-[3] h-10 shrink-0 w-full flex items-center justify-between px-2', 'border-t border-[var(--workbench-border)] bg-[var(--workbench-surface)]')} role="toolbar" aria-label={t('timelinePreview.controls')}>
      <div className="workbench-preview-player__control-group flex items-center gap-1" data-control-scope="transport" aria-label={t('timelinePreview.controls')}>
        <WorkbenchIconButton className={cn('workbench-preview-player__play', 'h-7 w-7 rounded-full border-0 bg-[var(--nomi-ink)] text-[var(--nomi-paper)]')} label={playing ? t('timelinePreview.pause') : t('timelinePreview.play')} icon={playing ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />} onClick={onTogglePlayback} disabled={isEmpty} title={isEmpty ? t('timelinePreview.emptyTimeline') : undefined} />
        <WorkbenchIconButton className={CONTROL_ICON_BUTTON_CLASS} label={t('timelinePreview.previousFrame')} title={t('timelinePreview.previousFrameShortcut')} icon={<IconPlayerSkipBack size={15} />} onClick={() => onStepFrame(-1)} disabled={isEmpty} />
        <WorkbenchIconButton className={CONTROL_ICON_BUTTON_CLASS} label={t('timelinePreview.nextFrame')} title={t('timelinePreview.nextFrameShortcut')} icon={<IconPlayerSkipForward size={15} />} onClick={() => onStepFrame(1)} disabled={isEmpty} />
        <span className="min-w-[72px] px-2 text-micro tabular-nums text-[var(--workbench-muted)]">{t('timelinePreview.timeSummary', { current: currentSeconds, total: totalSeconds })}</span>
      </div>
      <div className="workbench-preview-player__control-group flex items-center gap-1" data-control-scope="overlay" aria-label={t('timelinePreview.controls')}>
        <div ref={textMenuRef} className="relative flex items-center">
          <WorkbenchButton className="inline-flex h-7 items-center gap-1 border-0 bg-transparent px-2 text-micro text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)]" aria-label={t('timelinePreview.addText')} aria-expanded={textMenuOpen} title={t('timelinePreview.addTextHint')} onClick={() => onTextMenuOpenChange(!textMenuOpen)}>
            <IconSubtitles size={14} />{t('timelinePreview.text')}<IconChevronDown size={12} />
          </WorkbenchButton>
          {textMenuOpen ? <div className="absolute bottom-full right-0 z-[5] mb-1 min-w-[148px] rounded-[var(--nomi-radius)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] p-1 shadow-[var(--workbench-shadow-pop)]" role="menu">
            {(['caption', 'title'] as const).map((style) => <button key={style} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-[var(--nomi-radius-sm)] px-2 py-1.5 text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]" onClick={() => onAddText(style)}><IconLetterCase size={14} /><span>{style === 'caption' ? t('timelinePreview.caption') : t('timelinePreview.titleCard')}</span></button>)}
          </div> : null}
        </div>
        <WorkbenchIconButton className={CONTROL_ICON_BUTTON_CLASS} label={muted ? t('timelinePreview.unmute') : t('timelinePreview.mute')} title={muted ? t('timelinePreview.unmute') : t('timelinePreview.mute')} icon={muted ? <IconVolumeOff size={15} /> : <IconVolume size={15} />} onClick={() => onMutedChange(!muted)} />
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label={t('timelinePreview.volume')} className="h-1 w-14 cursor-pointer" style={{ accentColor: 'var(--nomi-accent)' }} onChange={(event) => onVolumeChange(Number(event.target.value))} />
        <WorkbenchIconButton className={CONTROL_ICON_BUTTON_CLASS} label={isFullscreen ? t('timelinePreview.exitFullscreen') : t('timelinePreview.fullscreen')} title={t('timelinePreview.fullscreenPreview')} icon={isFullscreen ? <IconMinimize size={15} /> : <IconMaximize size={15} />} onClick={onToggleFullscreen} />
        <TextClipStyleControls timeline={timeline} selectedTextClipId={selectedTextClipId} />
      </div>
    </div>
  )
}
