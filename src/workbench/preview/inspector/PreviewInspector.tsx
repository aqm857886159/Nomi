import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustments, IconChevronDown, IconMovie, IconMusic, IconPhoto, IconSubtitles, IconTransitionLeft, IconTransitionRight } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton, NomiSelect } from '../../../design'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../workbenchStore'
import { resolveClipAudio } from '../../timeline/clipAudio'
import { resolveClipFraming } from '../../timeline/clipFraming'
import { computeTimelineDuration } from '../../timeline/timelineMath'
import type { TimelineState } from '../../timeline/timelineTypes'
import { TextClipFields } from './TextClipFields'
import { PanelRail } from '../PanelRail'
import { PREVIEW_RATIOS } from '../previewAspectRatios'
import type { PreviewAspectRatio } from '../../workbenchTypes'

function timecode(frame: number, fps: number): string {
  const total = Math.max(0, Math.floor(frame / Math.max(1, fps)))
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen)
  return <section className="border-b border-[var(--workbench-border)] py-2">
    <button type="button" className="flex w-full items-center justify-between px-3 py-1 text-left text-caption font-semibold text-[var(--workbench-ink)]" aria-expanded={open} onClick={() => setOpen(!open)}><span>{title}</span><IconChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} /></button>
    {open ? <div className="space-y-2 px-3 pt-2">{children}</div> : null}
  </section>
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return <label className="flex items-center justify-between gap-2 text-caption text-[var(--workbench-muted)]" title={hint}><span>{label}</span><span className="flex items-center gap-1">{children}</span></label>
}

function TypeIcon({ type }: { type: 'video' | 'image' | 'text' }): JSX.Element {
  if (type === 'video') return <IconMovie size={16} />
  if (type === 'image') return <IconPhoto size={16} />
  return <IconSubtitles size={16} />
}

export type PreviewInspectorProps = {
  timeline: TimelineState
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function PreviewInspector({ timeline, collapsed, onToggleCollapsed }: PreviewInspectorProps): JSX.Element {
  const { t } = useTranslation()
  const aspectRatio = useWorkbenchStore((state) => state.previewAspectRatio)
  const setAspectRatio = useWorkbenchStore((state) => state.setPreviewAspectRatio)
  const selectedIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedTextId = useWorkbenchStore((state) => state.selectedTextClipId)
  const setFraming = useWorkbenchStore((state) => state.setTimelineClipFraming)
  const setAudio = useWorkbenchStore((state) => state.setTimelineClipAudio)
  const exportResolution = useWorkbenchStore((state) => state.exportResolution)
  const exportQuality = useWorkbenchStore((state) => state.exportQuality)
  const setExportResolution = useWorkbenchStore((state) => state.setExportResolution)
  const setExportQuality = useWorkbenchStore((state) => state.setExportQuality)
  const clip = React.useMemo(() => timeline.tracks.flatMap((track) => track.clips).find((entry) => selectedIds.includes(entry.id)) ?? null, [selectedIds, timeline])
  const textClip = timeline.textClips.find((entry) => entry.id === selectedTextId) ?? null
  const objectType: 'video' | 'image' | 'text' | null = textClip ? 'text' : clip?.type === 'video' ? 'video' : clip?.type === 'image' ? 'image' : null
  const framing = resolveClipFraming(clip ?? undefined)
  const audio = resolveClipAudio(clip?.audio, clip ? clip.endFrame - clip.startFrame : 0)
  const fps = timeline.fps || 30
  const target = textClip ?? clip
  const objectName = target ? (clip?.label || textClip?.text || '') : t('timelinePreview.previewInspector.wholeFilm')
  const objectKind = objectType
    ? t(({ video: 'timelinePreview.previewInspector.types.video', image: 'timelinePreview.previewInspector.types.image', text: 'timelinePreview.previewInspector.types.text' } as const)[objectType])
    : t('timelinePreview.previewInspector.project')
  const durationFrames = target ? target.endFrame - target.startFrame : computeTimelineDuration(timeline)
  const objectDuration = `${(durationFrames / fps).toFixed(1)}${t('timelinePreview.previewInspector.seconds')}`
  // 收起态与素材栏共用同一个 PanelRail：宽度由面板系统的 collapsedSize 决定，组件里不再各写一个 w-8。
  if (collapsed) return <PanelRail icon={<IconAdjustments size={16} />} label={t('timelinePreview.previewInspector.title')} title={t('timelinePreview.previewInspector.expand')} onClick={onToggleCollapsed} />
  return <aside className="flex h-full min-w-0 flex-col overflow-y-auto border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]" aria-label={t('timelinePreview.previewInspector.aria')}>
    <header className="flex h-10 flex-none items-center justify-between border-b border-[var(--workbench-border)] px-3"><div className="flex items-center gap-2 text-body-sm font-semibold"><IconAdjustments size={16} />{t('timelinePreview.previewInspector.title')}</div><WorkbenchIconButton label={t('timelinePreview.previewInspector.collapse')} title={t('timelinePreview.previewInspector.collapse')} icon={<IconChevronDown size={16} />} onClick={onToggleCollapsed} /></header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* 类型色条用**现役轨道色相**：视频 = --workbench-video，字幕 = --workbench-text，
          图片与整片 = --workbench-accent（图片轨的点就是 accent，没有 --workbench-image 这个 token）。 */}
      <div className="flex items-center gap-2 border-b border-[var(--workbench-border)] px-3 py-2" data-testid="preview-inspector-object" data-object-type={objectType ?? 'film'}>
        <span className={cn('h-6 w-1 rounded-pill', objectType === 'video' ? 'bg-[var(--workbench-video)]' : objectType === 'text' ? 'bg-[var(--workbench-text)]' : 'bg-[var(--workbench-accent)]')} />
        {objectType ? <TypeIcon type={objectType} /> : <IconMusic size={16} />}
        {/* 「对象名 + 类型·时长」（合同 §2.3）。整片态的类型写「项目」而不是再写一遍「整片」——
            名字已经是「整片」了，副行重复一次是白噪音；时长给整条时间轴的长度，比一个死词有用。 */}
        <div className="min-w-0">
          <div className="truncate text-caption font-semibold">{objectName}</div>
          <div className="text-micro text-[var(--workbench-muted)]">{objectKind} · {objectDuration}</div>
        </div>
      </div>
      {!objectType ? <>
        <Section title={t('timelinePreview.previewInspector.groups.display')}><Field label={t('timelinePreview.previewInspector.aspectRatio')}><NomiSelect ariaLabel={t('timelinePreview.previewInspector.aspectRatio')} size="xs" value={aspectRatio} options={PREVIEW_RATIOS.map((ratio) => ({ value: ratio.value, label: ratio.label }))} onChange={(value) => setAspectRatio(value as PreviewAspectRatio)} /></Field></Section>
        <Section title={t('timelinePreview.previewInspector.groups.export')}><Field label={t('timelinePreview.previewInspector.resolution')}><NomiSelect ariaLabel={t('timelinePreview.previewInspector.resolution')} size="xs" value={exportResolution} options={[{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }]} onChange={(value) => setExportResolution(value as '720p' | '1080p')} /></Field><Field label={t('timelinePreview.previewInspector.quality')}><NomiSelect ariaLabel={t('timelinePreview.previewInspector.quality')} size="xs" value={exportQuality} options={[{ value: 'small', label: t('timelinePreview.previewInspector.qualities.small') }, { value: 'standard', label: t('timelinePreview.previewInspector.qualities.standard') }, { value: 'high', label: t('timelinePreview.previewInspector.qualities.high') }]} onChange={(value) => setExportQuality(value as 'small' | 'standard' | 'high')} /></Field></Section>
        <Section title={t('timelinePreview.previewInspector.groups.audio')}><Field label={t('timelinePreview.previewInspector.musicVolume')}><input aria-label={t('timelinePreview.previewInspector.musicVolume')} type="range" min={-60} max={0} step={1} defaultValue={0} className="w-24" /></Field></Section>
      </> : objectType === 'text' && textClip ? <>
        <Section title={t('timelinePreview.previewInspector.groups.text')}><TextClipFields clip={textClip} /></Section>
        <Section title={t('timelinePreview.previewInspector.groups.time')}><Field label={t('timelinePreview.previewInspector.start')}><span className="tabular-nums">{timecode(textClip.startFrame, fps)}</span></Field><Field label={t('timelinePreview.previewInspector.duration')}><span className="tabular-nums">{((textClip.endFrame - textClip.startFrame) / fps).toFixed(1)}{t('timelinePreview.previewInspector.seconds')}</span></Field></Section>
      </> : clip ? <>
        <Section title={t('timelinePreview.previewInspector.groups.display')}><Field label={t('timelinePreview.previewInspector.fit')}><div className="flex overflow-hidden rounded-nomi-sm border border-[var(--workbench-border)]"><button type="button" className={cn('px-2 py-1 text-micro', framing.fit === 'contain' && 'bg-[var(--workbench-accent-soft)]')} onClick={() => setFraming(clip.id, { fit: 'contain' })}>{t('timelinePreview.contain')}</button><button type="button" className={cn('px-2 py-1 text-micro', framing.fit === 'cover' && 'bg-[var(--workbench-accent-soft)]')} onClick={() => setFraming(clip.id, { fit: 'cover' })}>{t('timelinePreview.cover')}</button></div></Field><Field label={t('timelinePreview.previewInspector.scale')}><input aria-label={t('timelinePreview.previewInspector.scale')} type="range" min={0.5} max={3} step={0.05} value={framing.scale} className="w-20" onChange={(event) => setFraming(clip.id, { scale: Number(event.target.value) })} /><span className="w-10 tabular-nums text-right">{Math.round(framing.scale * 100)}%</span></Field><Field label={t('timelinePreview.previewInspector.reset')}><WorkbenchButton className="h-6 px-2 text-micro" onClick={() => setFraming(clip.id, { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 })}>{t('timelinePreview.previewInspector.reset')}</WorkbenchButton></Field></Section>
        <Section title={t('timelinePreview.previewInspector.groups.time')}><Field label={t('timelinePreview.previewInspector.start')}><span className="tabular-nums">{timecode(clip.startFrame, fps)}</span></Field><Field label={t('timelinePreview.previewInspector.duration')}><span className="tabular-nums">{((clip.endFrame - clip.startFrame) / fps).toFixed(1)}{t('timelinePreview.previewInspector.seconds')}</span></Field><Field label={t('timelinePreview.previewInspector.sourceWindow')}><span className="tabular-nums text-micro">{clip.offsetStartFrame}–{clip.frameCount - clip.offsetEndFrame}{t('timelinePreview.previewInspector.frames')}</span></Field></Section>
        {clip.type !== 'image' ? <Section title={t('timelinePreview.previewInspector.groups.audio')}><Field label={t('timelinePreview.previewInspector.volumeDb')}><input aria-label={t('timelinePreview.previewInspector.volumeDb')} type="range" min={-60} max={0} step={1} value={audio.gainDb} className="w-20" onChange={(event) => setAudio(clip.id, { gainDb: Number(event.target.value) })} /><input aria-label={t('timelinePreview.previewInspector.volumeDbInput')} type="number" min={-60} max={0} value={audio.gainDb} className="w-12 rounded-nomi-sm border border-[var(--workbench-border)] bg-transparent px-1 text-right text-micro" onChange={(event) => setAudio(clip.id, { gainDb: Number(event.target.value) })} /></Field><Field label={t('timelinePreview.previewInspector.muted')}><input type="checkbox" checked={audio.muted} aria-label={t('timelinePreview.previewInspector.muted')} onChange={(event) => setAudio(clip.id, { muted: event.target.checked })} /></Field><Field label={t('timelinePreview.previewInspector.fadeIn')}><input type="number" min={0} value={(audio.fadeInFrames / fps).toFixed(2)} className="w-14 rounded-nomi-sm border border-[var(--workbench-border)] bg-transparent px-1 text-right text-micro" onChange={(event) => setAudio(clip.id, { fadeInFrames: Math.max(0, Math.round(Number(event.target.value) * fps)) })} /><span className="text-micro">{t('timelinePreview.previewInspector.seconds')}</span></Field><Field label={t('timelinePreview.previewInspector.fadeOut')}><input type="number" min={0} value={(audio.fadeOutFrames / fps).toFixed(2)} className="w-14 rounded-nomi-sm border border-[var(--workbench-border)] bg-transparent px-1 text-right text-micro" onChange={(event) => setAudio(clip.id, { fadeOutFrames: Math.max(0, Math.round(Number(event.target.value) * fps)) })} /><span className="text-micro">{t('timelinePreview.previewInspector.seconds')}</span></Field></Section> : null}
        <Section title={t('timelinePreview.previewInspector.groups.transition')}><Field label={t('timelinePreview.previewInspector.transitionIn')}><WorkbenchButton className="h-7 px-2 text-micro" title={t('timelinePreview.previewInspector.transitionHint')} onClick={() => undefined}><IconTransitionLeft size={14} />{t('timelinePreview.previewInspector.choose')}</WorkbenchButton></Field><Field label={t('timelinePreview.previewInspector.transitionOut')}><WorkbenchButton className="h-7 px-2 text-micro" title={t('timelinePreview.previewInspector.transitionHint')} onClick={() => undefined}><IconTransitionRight size={14} />{t('timelinePreview.previewInspector.choose')}</WorkbenchButton></Field></Section>
      </> : null}
    </div>
  </aside>
}
