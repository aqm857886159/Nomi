import React from 'react'
import { IconDownload } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useResultDownload } from './useResultDownload'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 视频（及非图片）结果的下载浮条：与图片编辑工具条同形态的顶部浮条，只放一个「下载」按钮。
// 图片结果的下载已并入 NodeImageEditToolbar；这里专管没有编辑工具条的结果类型（视频等），
// 让下载在所有结果类型上都「在上面浮条、看得清」（P4）。仅在选中且有可下载的非图片结果时渲染。

type Props = {
  node: GenerationCanvasNode
  selected: boolean
}

export default function NodeResultDownloadButton({ node, selected }: Props): JSX.Element | null {
  const { canDownload, downloading, download } = useResultDownload(node)
  if (!selected || !canDownload || node.result?.type === 'image') return null

  return (
    <div
      className={cn(
        'generation-canvas-v2-node__panorama-toolbar',
        'absolute left-1/2 bottom-[calc(100%+18px)] z-[12]',
        'inline-flex items-center gap-1 min-h-[44px] py-[5px] px-2',
        'border border-[rgba(18,24,38,0.08)] rounded-[14px]',
        'bg-white/[0.96] shadow-[0_12px_34px_rgba(18,24,38,0.14)]',
        '-translate-x-1/2 backdrop-blur-[12px]',
      )}
      role="toolbar"
      aria-label="结果操作"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className={cn(
          'inline-flex items-center justify-center gap-[7px]',
          'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
          'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          'disabled:opacity-[0.45] disabled:cursor-wait',
        )}
        type="button"
        aria-label="下载到本地"
        title="下载 / 另存到本地"
        disabled={downloading}
        onClick={download}
      >
        <IconDownload size={16} stroke={1.8} />
        <span>下载</span>
      </button>
    </div>
  )
}
