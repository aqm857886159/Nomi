import { NomiMarkdown } from '../common/NomiMarkdown'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconCheck, IconCopy, IconExternalLink, IconPencil, IconPhoto, IconTrash, IconVideo, IconX } from '@tabler/icons-react'
import { useModalInputLayer } from '../../design/modalInputLayer'
import { cn } from '../../utils/cn'
import type { LibraryPrompt } from '../api/promptLibraryApi'
import { libraryGroup } from '../library/libraryGroups'
import { LibraryDetailFooter, LibraryDetailIconButton, LibraryDetailMeta, LibraryDetailPrimary } from '../library/LibraryDetailParts'
import { SkillMedia } from '../skillLibrary/SkillMedia'
import { isBuiltinPromptSourceId } from '../../../electron/shared/contracts/promptLibrary'
import { promptDisplayTitle } from './promptDisplay'

type Props = {
  prompt: LibraryPrompt
  originRect: DOMRect
  onClose: () => void
  onAddToCanvas: (prompt: LibraryPrompt) => void
  /** 「放上画布」现在为什么点不了（项目库页上没开项目）；有它主按钮就禁用并说原因（C1）。 */
  addToCanvasBlockedReason?: string
  /** 只「我的」条目给。 */
  onEdit?: (prompt: LibraryPrompt) => void
  onDelete?: (prompt: LibraryPrompt) => void
}

const EASE = 'cubic-bezier(.2, .7, .3, 1)'
const ANIM_MS = 260

/**
 * 提示词详情（PromptDetail 板）：从被点卡片的位置 FLIP 放大浮到屏幕中央（transform-origin 0 0，先映射回原位再过渡到正位）。
 * × 在标题行，不压在媒体上；标题下一行「分类 · 内置 / 公开库 / 我的 · 类型」；媒体 16:9 完整显示（不裁）；
 * 底栏左边是「来源 ↗」（我的条目是删除），右边（我的）编辑、复制图标、唯一主按钮「放上画布」。
 */
export function PromptPreviewOverlay({ prompt, originRect, onClose, onAddToCanvas, addToCanvasBlockedReason, onEdit, onDelete }: Props): JSX.Element {
  useModalInputLayer(true)
  const { t, i18n } = useTranslation()
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [closing, setClosing] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const isVideo = prompt.promptType === 'video'
  const mine = prompt.origin === 'user'
  const displayTitle = promptDisplayTitle(prompt)
  const group = libraryGroup(prompt, i18n.language)
  const typeLabel = isVideo ? t('libraries.prompt.card.video') : t('libraries.prompt.card.image')
  const segmentLabel = mine
    ? t('libraries.layout.mine')
    : isBuiltinPromptSourceId(prompt.sourceId) ? t('libraries.layout.segment.builtin') : t('libraries.layout.segment.public')
  const TypeIcon = prompt.mediaType === 'video' ? IconVideo : IconPhoto

  const mapToOrigin = React.useCallback(
    (box: HTMLDivElement) => {
      const rect = box.getBoundingClientRect()
      const scale = originRect.width / rect.width
      const dx = originRect.left - rect.left
      const dy = originRect.top - rect.top
      return `translate(${dx}px, ${dy}px) scale(${scale})`
    },
    [originRect],
  )

  // 进场：挂载即贴回原卡位置 → 下一帧过渡到正位。
  React.useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    box.style.transformOrigin = '0 0'
    box.style.transform = mapToOrigin(box)
    box.style.opacity = '0.4'
    const id = requestAnimationFrame(() => {
      box.style.transition = `transform ${ANIM_MS}ms ${EASE}, opacity ${ANIM_MS}ms ${EASE}`
      box.style.transform = 'translate(0, 0) scale(1)'
      box.style.opacity = '1'
    })
    return () => cancelAnimationFrame(id)
  }, [mapToOrigin])

  const close = React.useCallback(() => {
    const box = boxRef.current
    if (!box || closing) {
      onClose()
      return
    }
    setClosing(true)
    box.style.transition = `transform ${ANIM_MS}ms ${EASE}, opacity ${ANIM_MS}ms ${EASE}`
    box.style.transform = mapToOrigin(box)
    box.style.opacity = '0'
    window.setTimeout(onClose, ANIM_MS)
  }, [closing, mapToOrigin, onClose])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])

  const handleAdd = () => {
    onAddToCanvas(prompt)
    setSent(true)
    window.setTimeout(close, 950)
  }
  const handleCopy = () => {
    void navigator.clipboard?.writeText(prompt.prompt).catch(() => undefined)
    setCopied(true)
  }

  return (
    <Portal>
      <div
        role="dialog"
        aria-label={displayTitle}
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4200, background: 'var(--nomi-scrim)', animation: `nomi-fade ${ANIM_MS}ms ${EASE}` }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close()
        }}
      >
        <div
          ref={boxRef}
          data-prompt-preview={prompt.id}
          className={cn('flex max-h-[88vh] w-[640px] max-w-full flex-col overflow-hidden rounded-modal bg-nomi-paper shadow-nomi-lg ring-1 ring-nomi-line-soft')}
        >
          <header className="flex shrink-0 items-start gap-3 pb-3 pl-5 pr-4 pt-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="m-0 text-title font-semibold leading-[22px] text-nomi-ink" data-prompt-detail-title>{displayTitle}</h2>
              <LibraryDetailMeta data-prompt-detail-meta>
                {isVideo ? <IconVideo size={13} stroke={1.8} aria-hidden="true" className="-mr-0.5" /> : null}
                {[group?.label, segmentLabel, mine ? prompt.tags?.[0] : undefined, typeLabel].filter(Boolean).join(' · ')}
              </LibraryDetailMeta>
            </div>
            <button
              type="button"
              aria-label={t('libraries.layout.close')}
              onClick={close}
              data-prompt-detail-close
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink"
            >
              <IconX size={16} stroke={2} />
            </button>
          </header>
          <div className="relative mx-5 aspect-video shrink-0 overflow-hidden rounded-panel bg-nomi-ink-05" data-prompt-detail-media>
            {prompt.mediaUrl ? (
              <SkillMedia
                cover={prompt.mediaType === 'image' ? prompt.mediaUrl : undefined}
                preview={{ url: prompt.mediaUrl, type: prompt.mediaType }}
                play={prompt.mediaType === 'video'}
                illustration={prompt.curation?.preview?.provenance === 'illustration'}
                fallback={<TypeIcon size={40} stroke={1.3} />}
                expiredLabel={t('libraries.prompt.preview.expired')}
                className="absolute inset-0 size-full object-contain"
              />
            ) : (
              <span className="absolute inset-0 grid place-content-center justify-items-center gap-1 text-nomi-ink-30">
                <TypeIcon size={40} stroke={1.3} />
                <span className="px-8 text-center text-caption text-nomi-ink-40">{t('libraries.prompt.preview.noCover')}</span>
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3.5 text-body leading-[22px] text-nomi-ink-80" data-prompt-detail-text>
            <NomiMarkdown>{prompt.prompt}</NomiMarkdown>
          </div>
          <LibraryDetailFooter
            className="px-5 py-3"
            leading={mine ? (
              onDelete ? <LibraryDetailIconButton danger icon={<IconTrash size={16} stroke={1.8} />} label={t('libraries.prompt.card.delete')} onClick={() => onDelete(prompt)} data-prompt-detail-delete /> : null
            ) : prompt.sourceUrl ? (
              <a
                href={prompt.sourceUrl}
                target="_blank"
                rel="noreferrer"
                data-prompt-detail-source
                className="inline-flex items-center gap-1 text-caption text-nomi-ink-60 no-underline hover:text-nomi-ink"
              >
                <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
                {t('libraries.gallery.source')}
              </a>
            ) : null}
          >
            {mine && onEdit ? <LibraryDetailIconButton icon={<IconPencil size={16} stroke={1.8} />} label={t('libraries.prompt.card.edit')} onClick={() => onEdit(prompt)} data-prompt-detail-edit /> : null}
            <LibraryDetailIconButton
              icon={copied ? <IconCheck size={16} stroke={2} /> : <IconCopy size={16} stroke={1.8} />}
              label={copied ? t('libraries.prompt.preview.copied') : t('libraries.prompt.preview.copyAria')}
              onClick={handleCopy}
              data-prompt-detail-copy
            />
            <LibraryDetailPrimary disabledReason={addToCanvasBlockedReason} onClick={handleAdd} data-prompt-detail-add>
              {sent ? <IconCheck size={15} stroke={2} aria-hidden="true" /> : null}
              {sent ? t('libraries.prompt.preview.sent') : t('libraries.prompt.preview.send')}
            </LibraryDetailPrimary>
          </LibraryDetailFooter>
        </div>
        <style>{`@keyframes nomi-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      </div>
    </Portal>
  )
}
