import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconDownload, IconLetterCase, IconMaximize, IconMinimize, IconPlayerPause, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward, IconRefresh, IconVolume, IconVolumeOff, IconX, IconZoomIn, IconZoomOut } from '@tabler/icons-react'
import { NomiLoadingMark, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import type { TimelineState } from '../timeline/timelineTypes'
import type { ClipFit, ClipFraming } from '../timeline/clipFraming'
import type { FramingTarget } from '../timeline/framingTarget'
import type { PreviewAspectRatio } from '../workbenchTypes'
import { PREVIEW_RATIOS } from './previewAspectRatios'
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
  /** 整片属性。 */
  aspectRatio: PreviewAspectRatio
  onAspectRatioChange: (value: PreviewAspectRatio) => void
  /** 当前片段属性：目标为 null 时整组禁用（契约 C1）。 */
  framingTarget: FramingTarget | null
  framing: ClipFraming
  onFitChange: (fit: ClipFit) => void
  onScaleDelta: (delta: number) => void
  onResetFraming: () => void
  /** 文字叠加。 */
  textMenuRef: React.RefObject<HTMLDivElement>
  textMenuOpen: boolean
  onTextMenuOpenChange: (open: boolean) => void
  onAddText: (style: 'caption' | 'title') => void
  timeline: TimelineState
  selectedTextClipId: string
  /** 出片。 */
  exportStatus: string
  exportRatio: number
  canCancelExport: boolean
  onCancelExport: () => void
  onExport: () => void
  exportBusy: boolean
  exportTitle: string
}

export function PreviewControlBar(props: PreviewControlBarProps): JSX.Element {
  const { t } = useTranslation()
  const {
    playing, isEmpty, onTogglePlayback, onStepFrame, currentSeconds, totalSeconds,
    muted, onMutedChange, volume, onVolumeChange, isFullscreen, onToggleFullscreen,
    aspectRatio, onAspectRatioChange, framingTarget, framing, onFitChange, onScaleDelta, onResetFraming,
    textMenuRef, textMenuOpen, onTextMenuOpenChange, onAddText, timeline, selectedTextClipId,
    exportStatus, exportRatio, canCancelExport, onCancelExport, onExport, exportBusy, exportTitle,
  } = props

  const clipDisabled = !framingTarget
  const clipLabel = framingTarget
    ? t('timelinePreview.scopeThisClipNamed', { label: framingTarget.clip.label || t('timelinePreview.scopeThisClip') })
    : t('timelinePreview.scopeThisClip')
  const clipReason = t('timelinePreview.scopeThisClipHint')
  const exporting = exportStatus === 'preparing' || exportStatus === 'recording' || exportStatus === 'converting'

  return (
    <div
      className={cn(
        'workbench-preview-player__control-bar',
        // 窄窗口时换行而非把「导出 MP4」挤出/截断：flex-wrap + 居中。
        'relative z-[3] shrink-0 max-w-full flex flex-wrap justify-center items-center gap-2.5 p-2',
        'border border-[var(--workbench-border)] rounded-[var(--nomi-radius-lg)]',
        'bg-[color-mix(in_oklch,var(--nomi-paper)_88%,transparent)]',
        'shadow-[var(--workbench-shadow-sm)] backdrop-blur-[12px] backdrop-saturate-[1.2]',
        '[&>*]:shrink-0',
      )}
      role="toolbar"
      aria-label={t('timelinePreview.controls')}
    >
      {/* 传输组：形态自明，不加组名（播放器长什么样人人都认得）。 */}
      <ControlGroup>
        <WorkbenchIconButton
          className={cn(
            'workbench-preview-player__play',
            'w-[30px] h-[30px] grid place-items-center border-0 rounded-full',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]',
            'enabled:hover:bg-[var(--nomi-accent)] enabled:hover:text-[var(--nomi-paper)]',
            'disabled:hover:bg-[var(--nomi-ink)] disabled:hover:text-[var(--nomi-paper)]',
          )}
          label={playing ? t('timelinePreview.pause') : t('timelinePreview.play')}
          icon={playing ? <IconPlayerPause size={16} stroke={1.6} /> : <IconPlayerPlay size={16} stroke={1.6} />}
          onClick={onTogglePlayback}
          disabled={isEmpty}
          title={isEmpty ? t('timelinePreview.emptyTimeline') : undefined}
        />
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={t('timelinePreview.previousFrame')}
          title={t('timelinePreview.previousFrameShortcut')}
          icon={<IconPlayerSkipBack size={15} stroke={1.6} />}
          onClick={() => onStepFrame(-1)}
          disabled={isEmpty}
        />
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={t('timelinePreview.nextFrame')}
          title={t('timelinePreview.nextFrameShortcut')}
          icon={<IconPlayerSkipForward size={15} stroke={1.6} />}
          onClick={() => onStepFrame(1)}
          disabled={isEmpty}
        />
        <span className="text-micro opacity-60 tabular-nums min-w-[60px] px-1">
          {t('timelinePreview.timeSummary', { current: currentSeconds, total: totalSeconds })}
        </span>
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={muted ? t('timelinePreview.unmute') : t('timelinePreview.mute')}
          title={muted ? t('timelinePreview.unmute') : t('timelinePreview.mute')}
          icon={muted ? <IconVolumeOff size={15} stroke={1.6} /> : <IconVolume size={15} stroke={1.6} />}
          onClick={() => onMutedChange(!muted)}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t('timelinePreview.volume')}
          className="w-[54px] h-1 cursor-pointer"
          style={{ accentColor: 'var(--nomi-accent)' }}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={isFullscreen ? t('timelinePreview.exitFullscreen') : t('timelinePreview.fullscreen')}
          title={isFullscreen ? t('timelinePreview.exitFullscreen') : t('timelinePreview.fullscreenPreview')}
          icon={isFullscreen ? <IconMinimize size={15} stroke={1.6} /> : <IconMaximize size={15} stroke={1.6} />}
          onClick={onToggleFullscreen}
        />
      </ControlGroup>

      {/* 整片组：改的是成片本身，与选中什么无关。 */}
      <ControlGroup label={t('timelinePreview.scopeWholeFilm')}>
        <NomiSelect
          ariaLabel={t('timelinePreview.aspectRatio')}
          leadingLabel={t('timelinePreview.aspectRatioShort')}
          size="xs"
          value={aspectRatio}
          options={PREVIEW_RATIOS.map((ratio) => ({ value: ratio.value, label: ratio.label }))}
          onChange={(value) => onAspectRatioChange(value as PreviewAspectRatio)}
        />
      </ControlGroup>

      {/* 当前片段组：accent 底色 + 写出片段名；没选中片段时整组禁用并说明原因（契约 C1/C4）。 */}
      <ControlGroup label={clipLabel} tone="clip" disabled={clipDisabled} disabledReason={clipReason}>
        <NomiSelect
          ariaLabel={t('timelinePreview.fit')}
          leadingLabel={t('timelinePreview.fitShort')}
          size="xs"
          value={framing.fit}
          disabled={clipDisabled}
          options={[
            { value: 'contain', label: t('timelinePreview.contain') },
            { value: 'cover', label: t('timelinePreview.cover') },
          ]}
          onChange={(value) => onFitChange(value as ClipFit)}
        />
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={t('timelinePreview.zoomOut')}
          icon={<IconZoomOut size={16} />}
          onClick={() => onScaleDelta(-0.1)}
          disabled={clipDisabled}
        />
        <span
          className={cn('workbench-preview-player__zoom-label', 'min-w-[38px] text-micro font-bold tabular-nums text-center')}
          aria-label={t('timelinePreview.currentZoom')}
        >
          {Math.round(framing.scale * 100)}%
        </span>
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={t('timelinePreview.resetView')}
          icon={<IconRefresh size={16} />}
          onClick={onResetFraming}
          disabled={clipDisabled}
        />
        <WorkbenchIconButton
          className={CONTROL_ICON_BUTTON_CLASS}
          label={t('timelinePreview.zoomIn')}
          icon={<IconZoomIn size={16} />}
          onClick={() => onScaleDelta(0.1)}
          disabled={clipDisabled}
        />
      </ControlGroup>

      {/* 叠加组：文字是加在成片上的一层，既不属整片属性也不属某个媒体片段。 */}
      <ControlGroup label={t('timelinePreview.scopeOverlay')}>
        <div ref={textMenuRef} className={cn('workbench-preview-player__text-tools', 'relative flex-none inline-flex items-center')}>
          <WorkbenchButton
            className={cn('h-7 px-2.5 inline-flex items-center gap-1 border border-[var(--workbench-border)] rounded-full whitespace-nowrap bg-transparent text-[var(--workbench-muted)] text-micro font-bold cursor-pointer hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]')}
            aria-label={t('timelinePreview.addText')}
            aria-expanded={textMenuOpen}
            title={t('timelinePreview.addTextHint')}
            onClick={() => onTextMenuOpenChange(!textMenuOpen)}
          >
            <IconLetterCase size={14} />{t('timelinePreview.text')}<IconChevronDown size={12} className="opacity-60" />
          </WorkbenchButton>
          {textMenuOpen ? (
            <div
              className={cn(
                'workbench-preview-player__text-menu',
                'absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-[5]',
                'min-w-[148px] p-1 flex flex-col gap-0.5',
                'rounded-[var(--nomi-radius)] border border-[var(--workbench-border)]',
                'bg-[var(--nomi-paper)] shadow-[var(--workbench-shadow-pop)]',
              )}
              role="menu"
            >
              {(['caption', 'title'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  role="menuitem"
                  className={cn('flex items-center gap-2 px-2 py-1.5 rounded-[var(--nomi-radius-sm)] text-left text-caption text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]')}
                  onClick={() => onAddText(style)}
                >
                  <IconLetterCase size={14} className="flex-none text-[var(--workbench-text)]" />
                  <span className="flex-1">{style === 'caption' ? t('timelinePreview.caption') : t('timelinePreview.titleCard')}</span>
                  <span className="text-[var(--workbench-muted-soft)] text-micro">
                    {style === 'caption' ? t('timelinePreview.captionPosition') : t('timelinePreview.titleCardPosition')}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <TextClipStyleControls timeline={timeline} selectedTextClipId={selectedTextClipId} />
      </ControlGroup>

      {exporting ? (
        <div className={cn('workbench-preview-player__export-progress', 'flex items-center gap-2 px-2')}>
          <div className={cn('workbench-preview-player__export-progress-bar-track', 'w-20 h-1 bg-nomi-ink-10 rounded-nomi-sm overflow-hidden')}>
            <div
              className={cn('workbench-preview-player__export-progress-bar', 'h-1 bg-nomi-accent rounded-nomi-sm transition-[width] duration-200 ease-in-out min-w-1')}
              style={{ width: `${Math.round(exportRatio * 100)}%` }}
            />
          </div>
          <span className={cn('workbench-preview-player__export-progress-label', 'text-caption text-nomi-ink-60 whitespace-nowrap')}>
            {exportStatus === 'preparing'
              ? t('timelinePreview.preparing')
              : exportStatus === 'converting'
                ? t('timelinePreview.converting')
                : t('timelinePreview.exporting', { percent: Math.round(exportRatio * 100) })}
          </span>
          <span title={canCancelExport ? t('timelinePreview.cancelExport') : t('timelinePreview.preparingCannotCancel')} style={{ display: 'contents' }}>
            <WorkbenchIconButton
              className={cn(
                'workbench-preview-player__export-cancel',
                'w-6 h-6 inline-grid place-items-center p-0 rounded-full border-0 bg-transparent text-[var(--workbench-muted)]',
                'enabled:cursor-pointer enabled:hover:bg-[var(--workbench-hover)] enabled:hover:text-[var(--workbench-danger)]',
                'disabled:hover:bg-transparent disabled:hover:text-[var(--workbench-muted)]',
              )}
              label={t('timelinePreview.cancelExport')}
              icon={<IconX size={14} />}
              onClick={onCancelExport}
              disabled={!canCancelExport}
            />
          </span>
        </div>
      ) : null}

      {/* 出片：预览页唯一的导出入口（顶栏那颗在预览页已不渲染，§1.5 一功能一个家）。 */}
      <span title={exportTitle} style={{ display: 'contents' }}>
        <WorkbenchButton
          className={cn(
            'workbench-preview-player__export-button',
            'h-7 px-3 border border-transparent rounded-full whitespace-nowrap',
            'inline-flex items-center justify-center gap-1.5',
            'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] text-micro font-bold cursor-pointer',
            'hover:bg-[var(--nomi-accent)] hover:text-[var(--nomi-paper)]',
            'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[var(--nomi-ink)]',
          )}
          aria-label={t('timelinePreview.exportMp4')}
          onClick={onExport}
          disabled={exportBusy || isEmpty}
        >
          {exportBusy ? <NomiLoadingMark size={15} className={cn('workbench-preview-player__spinner', 'animate-spin')} /> : <IconDownload size={15} />}
          {t('timelinePreview.exportMp4')}
        </WorkbenchButton>
      </span>
    </div>
  )
}
