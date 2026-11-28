import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustments, IconChevronDown, IconMovie, IconMusic, IconPhoto, IconSubtitles } from '@tabler/icons-react'
import { DesignNumberInput, DesignSwitch, NomiSegmented, NomiSelect, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../workbenchStore'
import { resolveClipAudio } from '../../timeline/clipAudio'
import { resolveClipFraming } from '../../timeline/clipFraming'
import { computeTimelineDuration } from '../../timeline/timelineMath'
// 时码只有一份实现（合同 §2.8：用户读时码和秒）。本文件原来自带第三份手抄的 MM:SS，
// 于是同一个起点在属性面板和计划摘要里读出两个不一样的数。
import { timelineTimecodePrecise } from '../../timeline/timelineTimecode'
import type { TimelineState } from '../../timeline/timelineTypes'
import { TextClipFields } from './TextClipFields'
import { ClipTransitionFields } from './ClipTransitionFields'
import { PanelRail } from '../PanelRail'
import { PREVIEW_RATIOS, selectPreviewAspectRatio } from '../previewAspectRatios'
import type { PreviewAspectRatio } from '../../workbenchTypes'

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen)
  return <section className="border-b border-[var(--workbench-border)] py-2">
    <button type="button" className="flex w-full items-center justify-between px-3 py-1 text-left text-caption font-semibold text-[var(--workbench-ink)]" aria-expanded={open} onClick={() => setOpen(!open)}><span>{title}</span><IconChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} /></button>
    {open ? <div className="space-y-2 px-3 pt-2">{children}</div> : null}
  </section>
}

// 属性栏最窄 200（panelLayout EDITING_PANEL_BOUNDS.inspector.min，1440 开着 Nomi 时就是这个宽）。
// 两列网格：名字列至少放下它最长的词、其余空间都归它；控件列按内容宽，只有名字折到最窄后才缩，缩的是滑块——读数、输入框、下拉不被裁。
// 不用弹性布局分差额：那样名字一折行，控件组也会被分走零点几像素，下拉里的「1080p」就成了「108…」。
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return <div className="grid grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)] items-center gap-2 text-caption text-[var(--workbench-muted)]" title={hint}><span>{label}</span><span className="flex min-w-0 items-center justify-end gap-1 [&>input[type=range]]:min-w-0">{children}</span></div>
}

function InspectorNumberInput({
  value,
  min,
  max,
  step = 1,
  decimalScale = 0,
  fixedDecimalScale = false,
  ariaLabel,
  className,
  onCommit,
}: {
  value: number
  min: number
  max?: number
  step?: number
  decimalScale?: number
  fixedDecimalScale?: boolean
  ariaLabel: string
  className?: string
  onCommit: (next: number) => void
}): JSX.Element {
  const [draft, setDraft] = React.useState<string | number>(value)
  React.useEffect(() => { setDraft(value) }, [value])
  return (
    <DesignNumberInput
      value={draft}
      min={min}
      max={max}
      step={step}
      decimalScale={decimalScale}
      fixedDecimalScale={fixedDecimalScale}
      allowDecimal={decimalScale > 0}
      clampBehavior="blur"
      hideControls
      size="xs"
      aria-label={ariaLabel}
      className={className}
      classNames={{ input: 'text-right text-micro tabular-nums' }}
      styles={{ input: { height: 24, minHeight: 24, paddingInline: 6 } }}
      onChange={(next) => {
        setDraft(next)
        if (typeof next === 'number' && Number.isFinite(next) && next >= min && (max === undefined || next <= max)) {
          onCommit(next)
        }
      }}
      onBlur={() => {
        const numeric = typeof draft === 'number' ? draft : Number(draft)
        if (!Number.isFinite(numeric)) {
          setDraft(value)
          return
        }
        const clamped = Math.max(min, max === undefined ? numeric : Math.min(max, numeric))
        setDraft(clamped)
        if (clamped !== value) onCommit(clamped)
      }}
    />
  )
}

function TypeIcon({ type }: { type: 'video' | 'image' | 'text' }): JSX.Element {
  if (type === 'video') return <IconMovie size={16} />
  if (type === 'image') return <IconPhoto size={16} />
  return <IconSubtitles size={16} />
}

export type PreviewInspectorProps = {
  timeline: TimelineState
  /** 画收起条还是展开内容——按本栏此刻的真实宽度定（PreviewWorkspace），不读存档开关。 */
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}

export default function PreviewInspector({ timeline, collapsed, onExpand, onCollapse }: PreviewInspectorProps): JSX.Element {
  const { t } = useTranslation()
  const aspectRatio = useWorkbenchStore(selectPreviewAspectRatio)
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
  // 「配乐音量」写的是音频轨每一段的 clip.audio.gainDb（合同 §2.3）。上一版这条滑杆是
  // `defaultValue={0}` 且**没有 onChange**：拖得动、什么都不改。空轨时它现在明着禁用并说明
  // 为什么，而不是让人拖半天再去猜是不是坏了。
  const musicClips = React.useMemo(
    () => timeline.tracks.filter((track) => track.type === 'audio').flatMap((track) => track.clips),
    [timeline],
  )
  const musicGainDb = musicClips.length ? Math.round(resolveClipAudio(musicClips[0].audio, musicClips[0].endFrame - musicClips[0].startFrame).gainDb) : 0
  const durationFrames = target ? target.endFrame - target.startFrame : computeTimelineDuration(timeline)
  const objectDuration = `${(durationFrames / fps).toFixed(1)}${t('timelinePreview.previewInspector.seconds')}`
  // 收起态与素材栏共用同一个 PanelRail：宽度由面板系统的 collapsedSize 决定，组件里不再各写一个 w-8。
  if (collapsed) return <PanelRail icon={<IconAdjustments size={16} />} label={t('timelinePreview.previewInspector.railLabel')} title={t('timelinePreview.previewInspector.expand')} horizontalLabel onClick={onExpand} />
  return <aside className="flex h-full min-w-0 flex-col overflow-y-auto border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]" aria-label={t('timelinePreview.previewInspector.aria')}>
    <header className="flex h-10 flex-none items-center justify-between border-b border-[var(--workbench-border)] px-3"><div className="flex items-center gap-2 text-body-sm font-semibold"><IconAdjustments size={16} />{t('timelinePreview.previewInspector.title')}</div><WorkbenchIconButton label={t('timelinePreview.previewInspector.collapse')} title={t('timelinePreview.previewInspector.collapse')} icon={<IconChevronDown size={16} />} onClick={onCollapse} /></header>
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
        <Section title={t('timelinePreview.previewInspector.groups.audio')}><Field label={t('timelinePreview.previewInspector.musicVolume')} hint={musicClips.length ? undefined : t('timelinePreview.previewInspector.musicVolumeEmpty')}><input aria-label={t('timelinePreview.previewInspector.musicVolume')} type="range" min={-60} max={0} step={1} value={musicGainDb} disabled={musicClips.length === 0} title={musicClips.length ? undefined : t('timelinePreview.previewInspector.musicVolumeEmpty')} className="w-24 disabled:opacity-40" data-inspector-music-volume="true" onChange={(event) => { const gainDb = Number(event.target.value); for (const entry of musicClips) setAudio(entry.id, { gainDb }) }} /><span className="w-10 text-right tabular-nums">{t('timelinePreview.previewInspector.decibels', { value: musicGainDb })}</span></Field></Section>
      </> : objectType === 'text' && textClip ? <>
        <Section title={t('timelinePreview.previewInspector.groups.text')}><TextClipFields clip={textClip} /></Section>
        <Section title={t('timelinePreview.previewInspector.groups.time')}><Field label={t('timelinePreview.previewInspector.start')}><span className="tabular-nums">{timelineTimecodePrecise(textClip.startFrame, fps)}</span></Field><Field label={t('timelinePreview.previewInspector.duration')}><span className="tabular-nums">{((textClip.endFrame - textClip.startFrame) / fps).toFixed(1)}{t('timelinePreview.previewInspector.seconds')}</span></Field></Section>
      </> : clip ? <>
        <Section title={t('timelinePreview.previewInspector.groups.display')}>
          <Field label={t('timelinePreview.previewInspector.fit')}>
            <NomiSegmented
              ariaLabel={t('timelinePreview.previewInspector.fit')}
              density="compact"
              fit="content"
              className="gap-0.5 p-0.5"
              itemClassName="px-2 py-0.5 text-micro"
              value={framing.fit}
              options={[
                { value: 'contain', label: t('timelinePreview.contain') },
                { value: 'cover', label: t('timelinePreview.cover') },
              ]}
              onChange={(value) => setFraming(clip.id, { fit: value as 'contain' | 'cover' })}
            />
          </Field>
          <Field label={t('timelinePreview.previewInspector.scale')}>
            <input aria-label={t('timelinePreview.previewInspector.scale')} type="range" min={0.5} max={3} step={0.05} value={framing.scale} className="w-20" onChange={(event) => setFraming(clip.id, { scale: Number(event.target.value) })} />
            <span className="w-10 text-right tabular-nums">{Math.round(framing.scale * 100)}%</span>
          </Field>
          <Field label={t('timelinePreview.previewInspector.reset')}>
            <WorkbenchButton className="h-6 px-2 text-micro" onClick={() => setFraming(clip.id, { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 })}>{t('timelinePreview.previewInspector.reset')}</WorkbenchButton>
          </Field>
        </Section>
        <Section title={t('timelinePreview.previewInspector.groups.time')}><Field label={t('timelinePreview.previewInspector.start')}><span className="tabular-nums">{timelineTimecodePrecise(clip.startFrame, fps)}</span></Field><Field label={t('timelinePreview.previewInspector.duration')}><span className="tabular-nums">{((clip.endFrame - clip.startFrame) / fps).toFixed(1)}{t('timelinePreview.previewInspector.seconds')}</span></Field><Field label={t('timelinePreview.previewInspector.sourceWindow')}><span className="tabular-nums text-micro">{clip.offsetStartFrame}–{clip.frameCount - clip.offsetEndFrame}{t('timelinePreview.previewInspector.frames')}</span></Field></Section>
        {clip.type !== 'image' ? (
          <Section title={t('timelinePreview.previewInspector.groups.audio')}>
            <Field label={t('timelinePreview.previewInspector.volumeDb')}>
              <input aria-label={t('timelinePreview.previewInspector.volumeDb')} type="range" min={-60} max={0} step={1} value={audio.gainDb} className="w-20" onChange={(event) => setAudio(clip.id, { gainDb: Number(event.target.value) })} />
              <InspectorNumberInput
                value={audio.gainDb}
                min={-60}
                max={0}
                step={1}
                ariaLabel={t('timelinePreview.previewInspector.volumeDbInput')}
                className="w-12"
                onCommit={(gainDb) => setAudio(clip.id, { gainDb })}
              />
            </Field>
            <Field label={t('timelinePreview.previewInspector.muted')}>
              <DesignSwitch
                size="xs"
                checked={audio.muted}
                aria-label={t('timelinePreview.previewInspector.muted')}
                onChange={(event) => setAudio(clip.id, { muted: event.currentTarget.checked })}
              />
            </Field>
            <Field label={t('timelinePreview.previewInspector.fadeIn')}>
              <InspectorNumberInput
                value={Number((audio.fadeInFrames / fps).toFixed(2))}
                min={0}
                step={0.1}
                decimalScale={2}
                fixedDecimalScale
                ariaLabel={t('timelinePreview.previewInspector.fadeIn')}
                className="w-14"
                onCommit={(seconds) => setAudio(clip.id, { fadeInFrames: Math.max(0, Math.round(seconds * fps)) })}
              />
              <span className="text-micro">{t('timelinePreview.previewInspector.seconds')}</span>
            </Field>
            <Field label={t('timelinePreview.previewInspector.fadeOut')}>
              <InspectorNumberInput
                value={Number((audio.fadeOutFrames / fps).toFixed(2))}
                min={0}
                step={0.1}
                decimalScale={2}
                fixedDecimalScale
                ariaLabel={t('timelinePreview.previewInspector.fadeOut')}
                className="w-14"
                onCommit={(seconds) => setAudio(clip.id, { fadeOutFrames: Math.max(0, Math.round(seconds * fps)) })}
              />
              <span className="text-micro">{t('timelinePreview.previewInspector.seconds')}</span>
            </Field>
          </Section>
        ) : null}
        <Section title={t('timelinePreview.previewInspector.groups.transition')}><ClipTransitionFields clip={clip} timeline={timeline} /></Section>
      </> : null}
    </div>
  </aside>
}
