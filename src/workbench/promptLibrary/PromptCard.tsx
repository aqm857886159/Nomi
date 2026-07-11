import React from 'react'
import { IconPlayerPlayFilled, IconPhoto, IconVideo } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import type { LibraryPrompt } from '../api/promptLibraryApi'

type Props = {
  prompt: LibraryPrompt
  onSelect: (prompt: LibraryPrompt, rect: DOMRect) => void
}

// 单张提示词卡:封面(图<img>/视频<video 首帧>)+标题渐变压字+类型角标。memo 化(搜索/滚动重渲不重建)。
export const PromptCard = React.memo(function PromptCard({ prompt, onSelect }: Props): JSX.Element {
  const [broken, setBroken] = React.useState(false)
  const isVideo = prompt.mediaType === 'video'
  const hasMedia = Boolean(prompt.mediaUrl) && !broken

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(event) => onSelect(prompt, event.currentTarget.getBoundingClientRect())}
          className={cn(
            'group relative block w-full aspect-[4/3] overflow-hidden text-left cursor-pointer',
            'rounded-nomi border border-nomi-line bg-nomi-ink-05',
            'transition-[transform,box-shadow] duration-[var(--nomi-transition-fast)]',
            'hover:-translate-y-0.5 hover:shadow-nomi-md',
          )}
        >
          {hasMedia ? (
            isVideo ? (
              <video
                src={prompt.mediaUrl}
                muted
                playsInline
                preload="metadata"
                className={cn('absolute inset-0 w-full h-full object-cover')}
                onError={() => setBroken(true)}
              />
            ) : (
              <img
                src={prompt.mediaUrl}
                alt={prompt.title}
                loading="lazy"
                className={cn('absolute inset-0 w-full h-full object-cover')}
                onError={() => setBroken(true)}
              />
            )
          ) : (
            <div className={cn('absolute inset-0 grid place-items-center text-nomi-ink-30')}>
              {isVideo ? <IconVideo size={30} stroke={1.4} /> : <IconPhoto size={30} stroke={1.4} />}
            </div>
          )}

          <span className={cn(
            'absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-px rounded-full text-micro leading-none',
            'bg-nomi-overlay-chip text-nomi-paper backdrop-blur-sm',
          )}>
            {isVideo ? <IconPlayerPlayFilled size={9} /> : null}
            {isVideo ? '视频' : '图片'}
          </span>

          <span className={cn(
            'absolute left-0 right-0 bottom-0 px-2 pt-3 pb-1.5',
            'bg-gradient-to-t from-nomi-media-veil to-transparent',
          )}>
            <span className={cn('block text-caption text-nomi-paper font-medium truncate')}>{prompt.title}</span>
            <span className={cn('block text-micro text-nomi-paper/70 truncate')}>{prompt.source}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 whitespace-normal leading-snug">
        {prompt.title}
      </TooltipContent>
    </Tooltip>
  )
})
