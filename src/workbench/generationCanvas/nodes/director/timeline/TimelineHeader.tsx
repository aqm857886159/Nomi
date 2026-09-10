/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../design（WorkbenchButton / WorkbenchIconButton / NomiSelect）、../../../../../vendor/tablerIcons、
 *          ../DirectorEditorContext、../model/timeGrid 的 secondsToFrame、../model/hotkeys（DIRECTOR_HOTKEYS / formatHotkey）、../OutputsContext、./timelineCommands、./useTimelineViewport
 * [OUTPUT]: 对外提供 TimelineHeader：▶ ■ ｜ F 帧/秒 ｜ 自动帧 ｜ 吸附 ｜ 倍速 ｜ 缩放三件 ｜ … ｜ 录制 MP4 ｜ 插入关键帧 (I) ｜ 折叠
 * [POS]: director/timeline 的头部工具条（不带簇名；产出与截图住视口底栏）；按钮全部打到命令层，不自己碰 store 细节。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../../../design'
import {
  IconChevronDown,
  IconChevronUp,
  IconKeyframe,
  IconMagnet,
  IconMaximize,
  IconMovie,
  IconPlayerPause,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconZoomIn,
  IconZoomOut,
} from '../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { useOutputs } from '../OutputsContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../model/hotkeys'
import { secondsToFrame } from '../model/timeGrid'
import { insertKeyframeAtPlayhead, stopPlayback, togglePlay } from './timelineCommands'
import type { TimelineViewport } from './useTimelineViewport'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

function ToggleChip({ on, label, hint, icon, onClick }: { on: boolean; label: string; hint: string; icon: React.ReactNode; onClick: () => void }): JSX.Element {
  return (
    <WorkbenchButton size="sm" variant={on ? 'primary' : 'default'} aria-pressed={on} title={hint} onClick={onClick} className="gap-1 px-2">
      {icon}
      {label}
    </WorkbenchButton>
  )
}

export function TimelineHeader({
  viewport,
  collapsed,
  onToggleCollapsed,
  onReject,
}: {
  viewport: TimelineViewport
  collapsed: boolean
  onToggleCollapsed: () => void
  onReject: (reasonKey: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const isPlaying = useDirectorStore((state) => state.timeline.isPlaying)
  const currentTime = useDirectorStore((state) => state.timeline.currentTime)
  const autoKey = useDirectorStore((state) => state.timeline.autoKey)
  const contentEnd = useDirectorStore((state) => state.contentEndSeconds())
  const playbackRate = useDirectorStore((state) => state.playbackRate)
  const snapEnabled = useDirectorStore((state) => state.snapEnabled)
  const outputs = useOutputs()
  const videoRecording = useDirectorStore((state) => state.videoRecording)
  const hasSubject = useDirectorStore((state) => Boolean(state.selection.objectId || state.selection.cameraId))

  const playLabel = `${isPlaying ? t('director.timeline.pause') : t('director.timeline.play')} (${formatHotkey(DIRECTOR_HOTKEYS.togglePlay)})`
  const insertLabel = `${t('director.timeline.insertKeyframe')} (${formatHotkey(DIRECTOR_HOTKEYS.insertKeyframe)})`

  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b border-nomi-line-soft bg-nomi-paper px-2 text-caption text-nomi-ink" data-testid="director-timeline-header">
      <span title={contentEnd <= 0 && !isPlaying ? t('director.timeline.nothingToPlay') : undefined}>
        <WorkbenchIconButton size="sm" icon={isPlaying ? <IconPlayerPause size={14} stroke={2} /> : <IconPlayerPlayFilled size={14} stroke={2} />} label={playLabel} disabled={contentEnd <= 0 && !isPlaying} onClick={() => togglePlay(store)} />
      </span>
      <WorkbenchIconButton size="sm" icon={<IconPlayerStopFilled size={12} stroke={2} />} label={t('director.timeline.stop')} onClick={() => stopPlayback(store)} />
      {/* 「F  帧 /  秒s」，两个数各占 4ch 右对齐、斜杠加粗 */}
      <span className="ml-1 mr-1 inline-flex h-7 items-center gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1.5 font-nomi-mono text-caption tabular-nums text-nomi-ink" aria-live="polite" data-testid="director-frame-readout" title={t('director.timeline.frameReadout', { frame: secondsToFrame(currentTime), seconds: contentEnd.toFixed(1) })}>
        <span className="inline-flex"><span>{t('director.timeline.frameUnit')}</span><span className="inline-block w-[4ch] text-right">{secondsToFrame(currentTime)}</span></span>
        <span className="shrink-0 font-semibold">/</span>
        <span className="inline-flex"><span className="inline-block w-[4ch] text-right">{contentEnd.toFixed(1)}</span><span className="text-nomi-ink-60">{t('director.timeline.secondsUnit')}</span></span>
      </span>
      <ToggleChip on={autoKey} label={t('director.timeline.autoKey')} hint={t('director.timeline.autoKeyHint')} icon={<IconKeyframe size={14} stroke={2} />} onClick={() => store.getState().setTimelineContext({ autoKey: !autoKey })} />
      <ToggleChip on={snapEnabled} label={t('director.timeline.snap')} hint={t('director.timeline.snapHint')} icon={<IconMagnet size={14} stroke={2} />} onClick={() => store.getState().setSnapEnabled(!snapEnabled)} />
      <NomiSelect
        size="xs"
        ariaLabel={t('director.timeline.speed')}
        value={String(playbackRate)}
        options={SPEEDS.map((speed) => ({ value: String(speed), label: t('director.timeline.speedValue', { rate: Number.isInteger(speed * 10) ? speed.toFixed(1) : String(speed) }) }))}
        onChange={(value) => store.getState().setPlaybackRate(Number(value))}
      />
      <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden />
      <WorkbenchIconButton size="sm" icon={<IconZoomIn size={16} stroke={1.9} />} label={t('director.timeline.zoomIn')} onClick={viewport.zoomIn} />
      <WorkbenchIconButton size="sm" icon={<IconZoomOut size={16} stroke={1.9} />} label={t('director.timeline.zoomOut')} onClick={viewport.zoomOut} />
      <WorkbenchIconButton size="sm" icon={<IconMaximize size={16} stroke={1.9} />} label={t('director.timeline.zoomFit')} onClick={viewport.fit} />
      <div className="flex-1" />
      {videoRecording ? (
        <WorkbenchButton size="sm" variant="primary" className="gap-1" title={t('director.timeline.recordVideoCancel')} onClick={outputs.cancelRecording}>
          <IconPlayerStopFilled size={12} stroke={2} />
          {t('director.timeline.recordVideoProgress', { current: videoRecording.current, total: videoRecording.total })}
        </WorkbenchButton>
      ) : (
        <WorkbenchButton size="sm" className="gap-1" title={t('director.timeline.recordVideoHint')} onClick={() => void outputs.recordVideo()}>
          <IconMovie size={14} stroke={2} />
          {t('director.timeline.recordVideo')}
        </WorkbenchButton>
      )}
      <span title={hasSubject ? insertLabel : t('director.timeline.toast.selectEntityForKeyframe')}>
        <WorkbenchButton
          size="sm"
          disabled={!hasSubject}
          className="gap-1"
          onClick={() => {
            const result = insertKeyframeAtPlayhead(store)
            if (!result.ok && result.reasonKey) onReject(result.reasonKey)
          }}
        >
          <IconPlus size={14} stroke={2} />
          {t('director.timeline.insertKeyframe')}
          <kbd className="rounded border border-nomi-line bg-nomi-bg px-1 font-nomi-mono text-micro text-nomi-ink-40">{formatHotkey(DIRECTOR_HOTKEYS.insertKeyframe)}</kbd>
        </WorkbenchButton>
      </span>
      <WorkbenchIconButton
        size="sm"
        icon={collapsed ? <IconChevronUp size={16} stroke={1.9} /> : <IconChevronDown size={16} stroke={1.9} />}
        label={collapsed ? t('director.timeline.expand') : t('director.timeline.collapse')}
        onClick={onToggleCollapsed}
      />
    </header>
  )
}
