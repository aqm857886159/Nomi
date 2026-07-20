import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlayFilled, IconPencil, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import type { LibraryPrompt } from '../api/promptLibraryApi'

type Props = {
  prompt: LibraryPrompt
  onSelect: (prompt: LibraryPrompt, rect: DOMRect) => void
  onEdit: (prompt: LibraryPrompt) => void
  onDelete: (prompt: LibraryPrompt) => void
}

// 我的库卡片:文字卡(无成品封面)——正文显提示词摘要 + 「我的」徽章 + 悬停编辑/删除。点开走同一预览浮层。
export const UserPromptCard = React.memo(function UserPromptCard({
  prompt,
  onSelect,
  onEdit,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const isVideo = prompt.promptType === 'video'
  const isUntitled =
    prompt.title === '未命名提示词' ||
    prompt.title === 'Untitled prompt' ||
    prompt.title === t('libraries.prompt.card.unnamed')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'group relative flex flex-col w-full aspect-[4/3] overflow-hidden text-left cursor-pointer',
            'rounded-nomi border border-nomi-accent/40 bg-nomi-paper p-2.5',
            'transition-[transform,box-shadow] duration-[var(--nomi-transition-fast)] hover:-translate-y-0.5 hover:shadow-nomi-md',
          )}
          role="button"
          tabIndex={0}
          onClick={(event) => onSelect(prompt, event.currentTarget.getBoundingClientRect())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(prompt, event.currentTarget.getBoundingClientRect())
            }
          }}
        >
          <div className={cn('flex items-center gap-1 mb-1.5')}>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-micro leading-none',
                'bg-nomi-accent/10 text-nomi-accent',
              )}
            >
              {t('libraries.prompt.card.mine')}
            </span>
            <span className={cn('inline-flex items-center gap-0.5 text-micro text-nomi-ink-40')}>
              {isVideo ? <IconPlayerPlayFilled size={8} /> : null}
              {isVideo ? t('libraries.prompt.card.video') : t('libraries.prompt.card.image')}
            </span>
          </div>

          <p className={cn('flex-1 min-h-0 overflow-hidden text-caption leading-relaxed text-nomi-ink-80')}>
            {prompt.prompt}
          </p>

          {prompt.title && !isUntitled ? (
            <span className={cn('block mt-1.5 text-micro text-nomi-ink-40 truncate')}>{prompt.title}</span>
          ) : null}

          <div
            className={cn('absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity')}
          >
            <button
              type="button"
              aria-label={t('libraries.prompt.card.edit')}
              className={cn(
                'w-6 h-6 grid place-items-center rounded-nomi-sm cursor-pointer border-0',
                'bg-nomi-paper/90 text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05 shadow-nomi-sm',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onEdit(prompt)
              }}
            >
              <IconPencil size={13} stroke={1.7} />
            </button>
            <button
              type="button"
              aria-label={t('libraries.prompt.card.delete')}
              className={cn(
                'w-6 h-6 grid place-items-center rounded-nomi-sm cursor-pointer border-0',
                'bg-nomi-paper/90 text-nomi-ink-60 hover:text-nomi-danger hover:bg-nomi-ink-05 shadow-nomi-sm',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(prompt)
              }}
            >
              <IconTrash size={13} stroke={1.7} />
            </button>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 whitespace-normal leading-snug">
        {prompt.title}
      </TooltipContent>
    </Tooltip>
  )
})
