/**
 * AudioStripNode body — 声音分类节点（spec §4.4）。
 *
 * 视觉：420×80 固定，无图，水平条带布局：
 * [播放按钮] [类型徽标] [名字] [波形] [时长] [使用计数]
 *
 * v0.7 不做真实播放 / 波形分析（需要 audio kind 落地）。
 * 当前显示骨架 + meta 里的 audioKind / durationSec 优雅渲染。
 */
import React from 'react'
import { IconPlayerPlay, IconUpload } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readAudioMeta, AUDIO_KIND_LABELS } from '../../model/nodeMetaFields'
import { useNodeUsageCount } from '../../hooks/useNodeRelationships'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { UsageDot } from './CardCommon'
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

function WaveformPlaceholder(): JSX.Element {
  // 静态 SVG 波形占位，v0.7 不做真实分析
  const bars = [0.4, 0.7, 0.5, 0.9, 0.3, 0.8, 0.6, 0.7, 0.4, 0.8, 0.5, 0.6, 0.7, 0.4, 0.9, 0.5]
  return (
    <svg viewBox="0 0 160 32" preserveAspectRatio="none" className="h-8 flex-1 opacity-30">
      {bars.map((h, i) => {
        const barH = h * 28
        const y = (32 - barH) / 2
        return (
          <rect
            key={i}
            x={i * 10}
            y={y}
            width="6"
            height={barH}
            rx="2"
            fill="currentColor"
          />
        )
      })}
    </svg>
  )
}

function AudioStripNodeImpl({ node }: Props): JSX.Element {
  const meta = readAudioMeta(node)
  const usageCount = useNodeUsageCount(node.id, node.title)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const audioKindLabel = meta.audioKind ? AUDIO_KIND_LABELS[meta.audioKind] : null
  const hasAudio = Boolean(node.result?.url)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setPlaying] = React.useState(false)

  // v0.7.1: 上传音频 — 用 dataURL 存进 result.url，type 暂用 'image' 占位（schema 未扩 'audio'）
  // categoryId='audio' 是真正的派发依据，buildClipFromGenerationNode 看 categoryId 决定 clip.type='audio'
  const handleUpload = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const createdAt = Date.now()
    // 即时 base64 预览（短命），随后落盘换 nomi-local 替换掉——音频文件同样不该把整段 base64 永久驻留。
    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const dataUrl = loadEvent.target?.result
      if (typeof dataUrl !== 'string') return
      updateNode(node.id, {
        result: { id: `upload-audio-${createdAt}`, type: 'image', url: dataUrl, createdAt },
        meta: { ...(node.meta || {}), audioFilename: file.name, audioMime: file.type },
      })
    }
    reader.readAsDataURL(file)
    void persistNodeImageFile(file, node.id).then((localUrl) => {
      if (!localUrl) return
      updateNode(node.id, {
        result: { id: `upload-audio-asset-${createdAt}`, type: 'image', url: localUrl, createdAt },
      })
    })
  }, [node.id, node.meta, updateNode])

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

  return (
    <div
      className={cn(
        'w-full h-full rounded-nomi-lg bg-nomi-paper',
        'flex items-center gap-3 px-3',
      )}
    >
      {/* 隐藏 audio 元素 — v0.7.1 真实播放上传的音频 */}
      {hasAudio ? (
        <audio
          ref={audioRef}
          src={node.result!.url!}
          preload="metadata"
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => {
            const durationSec = event.currentTarget.duration
            if (Number.isFinite(durationSec) && durationSec > 0 && meta.durationSec !== durationSec) {
              updateNode(node.id, {
                meta: { ...(node.meta || {}), durationSec },
              })
            }
          }}
        />
      ) : null}

      {/* 播放按钮 / 上传按钮（无音频时） */}
      {hasAudio ? (
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full',
            'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent transition-colors',
          )}
          aria-label={isPlaying ? '暂停' : '播放'}
          title={isPlaying ? '暂停' : '播放'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleTogglePlay}
        >
          <IconPlayerPlay size={14} stroke={1.8} aria-hidden />
        </button>
      ) : (
        <label
          className={cn(
            'inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full cursor-pointer',
            'bg-nomi-accent-soft text-nomi-accent hover:bg-nomi-accent hover:text-nomi-paper transition-colors',
          )}
          aria-label="上传音频"
          title="上传音频"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconUpload size={14} stroke={1.8} aria-hidden />
          <input className="hidden" type="file" accept="audio/*" onChange={handleUpload} />
        </label>
      )}

      {/* 类型徽标 + 名字 */}
      <div className="flex flex-col gap-1 min-w-0 shrink-0 max-w-[140px]">
        {audioKindLabel ? (
          <span
            className={cn(
              'inline-flex w-fit rounded-full px-2 py-[1px]',
              'bg-nomi-accent-soft text-nomi-accent',
              'text-[10px] font-medium',
            )}
          >
            {audioKindLabel}
          </span>
        ) : null}
        <span className="text-body text-nomi-ink truncate" title={node.title}>
          {getDisplayTitle(node.title, '声音')}
        </span>
      </div>

      {/* 波形 */}
      <div className="flex-1 min-w-0 text-nomi-ink-40">
        <WaveformPlaceholder />
      </div>

      {/* 时长 + 计数 */}
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-caption text-nomi-ink-60 tabular-nums font-mono">
          {formatDuration(meta.durationSec)}
        </span>
        <UsageDot count={usageCount} />
      </div>
    </div>
  )
}

const AudioStripNode = React.memo(AudioStripNodeImpl, (prev, next) => prev.node === next.node)
AudioStripNode.displayName = 'AudioStripNode'
export default AudioStripNode
