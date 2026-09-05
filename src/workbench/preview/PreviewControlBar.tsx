import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconLetterCase, IconMaximize, IconMinimize, IconPlayerPause, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward, IconSubtitles, IconVolume, IconVolumeOff } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import type { TimelineState } from '../timeline/timelineTypes'
import { TextClipStyleControls } from './TextClipStyleControls'
import { CONTROL_ICON_BUTTON_CLASS } from './previewControlTokens'

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
