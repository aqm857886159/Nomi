import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlayFilled, IconPhoto, IconVideo } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import type { LibraryPrompt } from '../api/promptLibraryApi'
import { promptDisplayTitle, promptSourceLabel } from './promptDisplay'

type Props = {
  prompt: LibraryPrompt
  onSelect: (prompt: LibraryPrompt, rect: DOMRect) => void
}

// 单张提示词卡:封面(图<img>/视频<video 首帧>)+标题渐变压字+类型角标。memo 化(搜索/滚动重渲不重建)。
export const PromptCard = React.memo(function PromptCard({ prompt, onSelect }: Props): JSX.Element {
  const { t } = useTranslation()
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
                alt={promptDisplayTitle(prompt)}
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

          <span
            className={cn(
              'absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-px rounded-full text-micro leading-none',
              // 描边加到 /35：暗色卡顶常压在深色媒体上（深发/暗景），深徽标+弱边=黑底黑字看不见（用户反馈）。
              'bg-nomi-overlay-chip-strong border border-nomi-paper/35 text-nomi-paper shadow-nomi-sm backdrop-blur-sm',
            )}
          >
            {isVideo ? <IconPlayerPlayFilled size={9} /> : null}
            {isVideo ? t('libraries.prompt.card.video') : t('libraries.prompt.card.image')}
          </span>

          <span
            // 远端策展内容（标题/来源名都来自公共提示词库，不是应用 UI 文案）——
            // 用户 2026-09-02 拍板不翻译，这个标记让 i18n EN-DOM 网跳过它。
            // 标在这层而不是整个面板：面板自己的文案（标题/tab/搜索/空状态）必须继续被抓。
            data-remote-content
            className={cn(
              // 遮罩加高（pt-3→pt-6）并加中段停靠色，确保标题+来源两行始终坐在足够深的 scrim 上；
              // 卡底若是亮区（白衬衫）白字才不会糊掉（用户反馈「标题与背景融合」）。
              'absolute left-0 right-0 bottom-0 px-2 pt-6 pb-1.5',
              'bg-gradient-to-t from-nomi-media-veil via-nomi-media-veil/70 to-transparent',
            )}
          >
            <span className={cn('block text-caption text-nomi-paper font-semibold truncate drop-shadow-[0_1px_2px_var(--nomi-scrim)]')}>{promptDisplayTitle(prompt)}</span>
            <span className={cn('block text-micro text-nomi-paper/80 truncate')}>{promptSourceLabel(prompt)}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 whitespace-normal leading-snug">
        {promptDisplayTitle(prompt)}
      </TooltipContent>
    </Tooltip>
  )
})
