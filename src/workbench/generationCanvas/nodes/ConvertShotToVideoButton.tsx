import React from 'react'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import { convertImageShotToVideo } from '../agent/convertShotToVideo'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 分镜预览层的两件 overlay（从 BaseGenerationNode 抽出，R9/R12 防巨壳）：
 * ① 「镜头 N」常显角标——补「生成出画面 / 选中」两个缺口（占位卡消失后编号不再蒸发，
 *    用户反馈「分镜没有 1/2/3」）；未生成未选中时由 PendingGenerationPlaceholder 自显，互斥不重复。
 * ② 图片镜头的「转视频」按钮（仅 shots 分类、已出图、非只读、非生成中）——
 *    image-first 桥，逻辑在 agent/convertShotToVideo（纯 store 编排，可单测）。
 */
export function ShotPreviewOverlays({
  node,
  selected,
  readOnly,
  shotIndex,
  hasResult,
  isGenerating,
}: {
  node: GenerationCanvasNode
  selected: boolean
  readOnly: boolean
  shotIndex: number | null
  hasResult: boolean
  isGenerating: boolean
}): JSX.Element | null {
  if (shotIndex == null) return null
  const showConvert = !readOnly && node.kind === 'image' && node.result?.type === 'image' && hasResult && !isGenerating
  return (
    <>
      {hasResult || selected ? (
        <span className="absolute top-1.5 left-1.5 z-[3] inline-flex items-center h-[18px] px-2 rounded-full bg-nomi-ink/85 text-nomi-paper text-micro font-bold tabular-nums pointer-events-none shadow-nomi-sm backdrop-blur-[2px]">
          镜头 {shotIndex}
        </span>
      ) : null}
      {showConvert ? <ConvertShotToVideoButton node={node} selected={selected} /> : null}
    </>
  )
}

/** 悬浮「转视频」按钮：hover/选中浮现，不常驻挡画面。 */
function ConvertShotToVideoButton({ node, selected }: { node: GenerationCanvasNode; selected: boolean }): JSX.Element {
  return (
    <button
      type="button"
      aria-label="把这张图转成视频镜头（作为首帧）"
      title="转视频镜头 · 这张图作为首帧"
      data-convert-shot-to-video={node.id}
      className={cn(
        'absolute bottom-1.5 right-1.5 z-[4] inline-flex items-center gap-1 h-6 px-2 rounded-full',
        'bg-nomi-ink/85 text-nomi-paper text-micro font-medium shadow-nomi-sm backdrop-blur-[2px]',
        'transition-opacity duration-[var(--nomi-transition-fast)]',
        selected ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100 focus-visible:opacity-100',
        'hover:bg-nomi-ink focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        const { existed } = convertImageShotToVideo(node)
        toast(existed ? '这一镜已转过视频，已选中它' : '已转出视频镜头 · 这张图作为首帧', 'info')
      }}
    >
      <IconMovie size={12} stroke={1.8} />
      转视频
    </button>
  )
}
