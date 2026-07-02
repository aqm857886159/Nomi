import React from 'react'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 图片镜头 →「转视频」桥（image-first 收敛路，用户拍板 2026-07-02）：
 * 图片分镜先把画面定下来，满意后一键升成视频镜头——建一个派生视频节点，
 * 连 first_frame 边（这张图 = 视频首帧，复用现有 i2v 链路，P1 零新链路）。
 *
 * 语义要点：
 * - 视频节点**继承源图的镜号**（同一镜的两阶段，排片按视频镜位落在剧本位置 3 而非新号 13）；
 *   addNode 会先自动领新号，随即 updateNode 覆写回继承号（nextShotIndex 按 max 计算，空号无影响）。
 * - meta.sourceNodeId 指回源图 → 一键整理会把视频紧跟其源镜头摆放。
 * - 不写 modelKey：让 useNodeModelAutoSelect 的「modelKey 空时自动选默认视频模型」既有路径接管。
 * - 幂等：该图已转出过视频（存在 image→video 出边）→ 选中已有的，不重复建。
 */
function convertImageShotToVideo(node: GenerationCanvasNode): void {
  const state = useGenerationCanvasStore.getState()
  const existing = state.nodes.find(
    (candidate) =>
      getGenerationNodeExecutionKind(candidate.kind) === 'video' &&
      state.edges.some((edge) => edge.source === node.id && edge.target === candidate.id),
  )
  if (existing) {
    state.selectNode(existing.id)
    toast('这一镜已转过视频，已选中它', 'info')
    return
  }
  const video = state.addNode({
    kind: 'video',
    title: node.title ? `${node.title} · 视频` : '',
    prompt: node.prompt || '',
    meta: { sourceNodeId: node.id },
    position: { x: node.position.x + (node.size?.width ?? 320) + 80, y: node.position.y },
    ...(node.categoryId ? { categoryId: node.categoryId } : {}),
    select: true,
  })
  if (typeof node.shotIndex === 'number') {
    state.updateNode(video.id, { shotIndex: node.shotIndex })
  }
  state.connectNodes(node.id, video.id, 'first_frame')
  toast('已转出视频镜头 · 这张图作为首帧', 'info')
}

/**
 * 分镜预览层的两件 overlay（从 BaseGenerationNode 抽出，R9/R12 防巨壳）：
 * ① 「镜头 N」常显角标——补「生成出画面 / 选中」两个缺口（占位卡消失后编号不再蒸发，
 *    用户反馈「分镜没有 1/2/3」）；未生成未选中时由 PendingGenerationPlaceholder 自显，互斥不重复。
 * ② 图片镜头的「转视频」按钮（仅 shots 分类、已出图、非只读、非生成中）。
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

/** 悬浮「转视频」按钮：仅分镜分类的图片镜头（有编号+已出图）显示；hover/选中浮现，不常驻挡画面。 */
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
        convertImageShotToVideo(node)
      }}
    >
      <IconMovie size={12} stroke={1.8} />
      转视频
    </button>
  )
}
