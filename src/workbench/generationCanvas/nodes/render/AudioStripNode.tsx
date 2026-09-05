/**
 * AudioStripNode body — 声音分类节点（spec §4.4，2026-06-15 升级）。
 *
 * 三态（420×80 固定条）：
 * - 配音/上传音频（result.type='audio'）：播放钮 + 类型徽标 + 名字 + **真实播放条（波形即进度，点/拖 seek）** + 当前/总时长
 * - 转写文本（result.type='text'）：文本（clamp）+ 复制 + 生成字幕（SRT）
 * - 空：上传按钮（配音模式则由 composer 填台词生成）
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay, IconPlayerPause, IconWaveSine, IconFileText, IconCopy, IconBadgeCc } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import { toast } from '../../../../ui/toast'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readAudioMeta } from '../../model/nodeMetaFields'
import { useNodeUsageCount } from '../../hooks/useNodeRelationships'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { UsageDot } from './CardCommon'
import { NodeEmptyState } from './NodeEmptyState'
import { getDisplayTitle } from '../../model/titleHeuristics'

type Props = {
  node: GenerationCanvasNode
}

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// SRT 时间戳 hh:mm:ss,mmm
function srtTime(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const ms = Math.round((safe - Math.floor(safe)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

type WhisperSegment = { start?: number; end?: number; text?: string }

// 从转写结果构建 SRT：优先 verbose_json 的 segments；无则整段一条 cue。
function buildSrt(node: GenerationCanvasNode): string {
  const result = node.result
  const raw = (result?.raw || {}) as { segments?: WhisperSegment[]; text?: string; duration?: number }
  const segments = Array.isArray(raw.segments) ? raw.segments : []
  if (segments.length > 0) {
    return segments
      .map(
        (seg, i) =>
          `${i + 1}\n${srtTime(seg.start ?? 0)} --> ${srtTime(seg.end ?? (seg.start ?? 0) + 2)}\n${(seg.text || '').trim()}\n`,
      )
      .join('\n')
  }
  const text = (result?.text || raw.text || '').trim()
  if (!text) return ''
  return `1\n${srtTime(0)} --> ${srtTime(raw.duration || 5)}\n${text}\n`
}

// 进度感知播放条：波形竖条按 currentTime/duration 分「已播实色 / 未播淡色」，点/拖 seek。
function PlayBar({ progress, onSeek }: { progress: number; onSeek: (fraction: number) => void }): JSX.Element {
  const { t } = useTranslation()
  const bars = React.useMemo(
    () => [0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.6, 0.7, 0.4, 0.8, 0.5, 0.6, 0.7, 0.4, 0.9, 0.5, 0.65, 0.45, 0.8, 0.55],
    [],
  )
  const seekFromEvent = React.useCallback(
    (event: React.MouseEvent) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
    },
    [onSeek],
  )
  const playedIndex = Math.round(bars.length * progress)
  return (
    <div
      className={cn('flex-1 min-w-0 flex items-center gap-[2px] h-8 cursor-pointer text-nomi-accent')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={seekFromEvent}
      role="slider"
      aria-label={t('generationCommon.audio.progress')}
      aria-valuenow={Math.round(progress * 100)}
    >
      {bars.map((h, i) => (
        <span
          key={i}
          className={cn('flex-1 rounded-full')}
          style={{
            height: `${Math.round(h * 100)}%`,
            background: 'currentColor',
            opacity: i < playedIndex ? 0.85 : 0.25,
          }}
        />
      ))}
    </div>
  )
}

function AudioStripNodeImpl({ node }: Props): JSX.Element {
  const { t } = useTranslation()
  const meta = readAudioMeta(node)
  const usageCount = useNodeUsageCount(node.id, node.title)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const audioKindLabel = meta.audioKind
    ? meta.audioKind === 'bgm'
      ? 'BGM'
      : t(`generationCommon.audio.${meta.audioKind}` as 'generationCommon.audio.sfx')
    : null
  const result = node.result
  const isTranscript = result?.type === 'text' && Boolean(result.text)
  const hasAudio = result?.type === 'audio' && Boolean(result.url)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(meta.durationSec || 0)

  const handleUpload = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      const createdAt = Date.now()
      // 先落盘再写 store：音频动辄几十 MB，base64 进 store 会被每次写入整段 JSON 深拷贝、
      // 随每次保存全量序列化（同「九宫格切图卡死」的病根，见 docs/plan/2026-08-20-grid-split-freeze.md）。
      void persistNodeImageFile(file, node.id).then((localUrl) => {
        if (!localUrl) {
          toast(t('generationCommon.audio.uploadFailed'), 'error')
          return
        }
        updateNode(node.id, {
          result: { id: `upload-audio-${createdAt}`, type: 'audio', url: localUrl, createdAt },
          meta: { ...(node.meta || {}), audioFilename: file.name, audioMime: file.type },
        })
      })
    },
    [node.id, node.meta, updateNode, t],
  )

  const handleTogglePlay = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => {})
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [])

  const handleSeek = React.useCallback((fraction: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    audio.currentTime = fraction * audio.duration
    setCurrentTime(audio.currentTime)
  }, [])

  const handleCopyText = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      void navigator.clipboard?.writeText(result?.text || '').catch(() => {})
    },
    [result?.text],
  )

  const handleGenerateSubtitle = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const srt = buildSrt(node)
      if (!srt) {
        toast(t('generationCommon.audio.noSubtitleContent'), 'error')
        return
      }
      void navigator.clipboard
        ?.writeText(srt)
        .then(() => toast(t('generationCommon.audio.subtitleCopied'), 'success'))
        .catch(() => {})
    },
    [node, t],
  )

  // 转写文本态：文本 + 复制 + 生成字幕（SRT）。
  if (isTranscript) {
    return (
      <div className={cn('w-full h-full rounded-nomi-lg bg-nomi-paper flex items-center gap-3 px-3')}>
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-nomi-accent-soft text-nomi-accent',
          )}
        >
          <IconFileText size={14} stroke={1.6} aria-hidden />
        </span>
        <p
          className={cn('flex-1 min-w-0 text-body-sm text-nomi-ink line-clamp-2 leading-snug')}
          title={result?.text || ''}
        >
          {result?.text}
        </p>
        <div className={cn('shrink-0 flex items-center gap-1')}>
          <WorkbenchButton
            variant="default"
            size="sm"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleCopyText}
            title={t('generationCommon.audio.copyTranscript')}
          >
            <IconCopy size={14} stroke={1.6} aria-hidden />
            {t('generationCommon.audio.copy')}
          </WorkbenchButton>
          <WorkbenchButton
            variant="primary"
            size="sm"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleGenerateSubtitle}
            title={t('generationCommon.audio.generateSubtitleHint')}
          >
            <IconBadgeCc size={14} stroke={1.6} aria-hidden />
            {t('generationCommon.audio.generateSubtitle')}
          </WorkbenchButton>
        </div>
      </div>
    )
  }

  if (!hasAudio) {
    return <label className="block h-full w-full cursor-pointer bg-nomi-paper" title={t('generationCommon.audio.upload')}>
      <NodeEmptyState compact icon={<IconWaveSine size={20} stroke={1.6} />} title={t('generationCommon.nodeEmpty.audio.title')} description={t('generationCommon.nodeEmpty.audio.description')} />
      <input className="hidden" type="file" accept="audio/*" onChange={handleUpload} />
    </label>
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  return (
    <div className={cn('w-full h-full rounded-nomi-lg bg-nomi-paper flex items-center gap-3 px-3')}>
      {hasAudio ? (
        <audio
          ref={audioRef}
          src={result!.url!}
          preload="metadata"
          onEnded={() => {
            setPlaying(false)
            setCurrentTime(0)
          }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const durationSec = event.currentTarget.duration
            if (Number.isFinite(durationSec) && durationSec > 0) {
              setDuration(durationSec)
              if (meta.durationSec !== durationSec) updateNode(node.id, { meta: { ...(node.meta || {}), durationSec } })
            }
          }}
        />
      ) : null}

      {hasAudio ? (
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-nomi-ink text-nomi-paper hover:bg-nomi-accent transition-colors',
          )}
          aria-label={isPlaying ? t('generationCommon.audio.pause') : t('generationCommon.audio.play')}
          title={isPlaying ? t('generationCommon.audio.pause') : t('generationCommon.audio.play')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleTogglePlay}
        >
          {isPlaying ? (
            <IconPlayerPause size={14} stroke={1.6} aria-hidden />
          ) : (
            <IconPlayerPlay size={14} stroke={1.6} aria-hidden />
          )}
        </button>
      ) : null}


      <div className="flex flex-col gap-1 min-w-0 shrink-0 max-w-[140px]">
        {audioKindLabel ? (
          <span
            className={cn(
              'inline-flex w-fit rounded-full px-2 py-[1px] bg-nomi-accent-soft text-nomi-accent text-micro font-medium',
            )}
          >
            {audioKindLabel}
          </span>
        ) : null}
        <span className="text-body-sm font-semibold text-nomi-ink-80 truncate" title={node.title}>
          {getDisplayTitle(node.title, t('generationCommon.audio.title'))}
        </span>
      </div>

      <PlayBar progress={progress} onSeek={handleSeek} />

      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-caption text-nomi-ink-60 tabular-nums font-mono">
          {`${formatDuration(currentTime)} / ${formatDuration(duration || meta.durationSec)}`}
        </span>
        <UsageDot count={usageCount} />
      </div>
    </div>
  )
}

const AudioStripNode = React.memo(AudioStripNodeImpl, (prev, next) => prev.node === next.node)
AudioStripNode.displayName = 'AudioStripNode'
export default AudioStripNode
