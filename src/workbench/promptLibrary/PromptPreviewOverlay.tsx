import React from 'react'
import { Portal } from '@mantine/core'
import { IconCopy, IconExternalLink, IconLayoutBoard, IconCheck, IconX, IconVideo, IconPhoto } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { LibraryPrompt } from '../api/promptLibraryApi'

type Props = {
  prompt: LibraryPrompt
  originRect: DOMRect
  onClose: () => void
  onSendToCanvas: (prompt: LibraryPrompt) => void
}

const EASE = 'cubic-bezier(.2, .7, .3, 1)'
const ANIM_MS = 260

// 预览浮层:从被点卡片的位置 FLIP 放大浮到屏幕中央(transform-origin 0 0,先映射回原位再过渡到正位)。
export function PromptPreviewOverlay({ prompt, originRect, onClose, onSendToCanvas }: Props): JSX.Element {
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [closing, setClosing] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const isVideo = prompt.mediaType === 'video'
  const hasMedia = Boolean(prompt.mediaUrl)

  const mapToOrigin = React.useCallback((box: HTMLDivElement) => {
    const rect = box.getBoundingClientRect()
    const scale = originRect.width / rect.width
    const dx = originRect.left - rect.left
    const dy = originRect.top - rect.top
    return `translate(${dx}px, ${dy}px) scale(${scale})`
  }, [originRect])

  // 进场:挂载即贴回原卡位置 → 下一帧过渡到正位。
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

  const handleSend = () => {
    onSendToCanvas(prompt)
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
        aria-label={prompt.title}
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4200, background: 'var(--nomi-scrim)', animation: `nomi-fade ${ANIM_MS}ms ${EASE}` }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
      >
        <div
          ref={boxRef}
          className={cn('w-[560px] max-w-full max-h-[88vh] flex flex-col overflow-hidden', 'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg')}
        >
          {/* 媒体 16:9 */}
          <div className={cn('relative w-full bg-nomi-ink-05')} style={{ aspectRatio: '16 / 9' }}>
            {hasMedia ? (
              isVideo ? (
                <video src={prompt.mediaUrl} controls autoPlay muted loop playsInline className={cn('absolute inset-0 w-full h-full object-cover')} />
              ) : (
                <img src={prompt.mediaUrl} alt={prompt.title} className={cn('absolute inset-0 w-full h-full object-cover')} />
              )
            ) : (
              <div className={cn('absolute inset-0 grid place-items-center gap-1 text-nomi-ink-30')}>
                {isVideo ? <IconVideo size={40} stroke={1.3} /> : <IconPhoto size={40} stroke={1.3} />}
                <span className={cn('text-caption text-nomi-ink-40')}>此条暂无封面媒体</span>
              </div>
            )}
            <span className={cn('absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full text-micro', 'bg-nomi-overlay-chip text-nomi-paper backdrop-blur-sm')}>
              {isVideo ? '视频' : '图片'} · {prompt.source}
            </span>
            <button
              type="button"
              aria-label="关闭"
              onClick={close}
              className={cn('absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-full cursor-pointer border-0', 'bg-nomi-overlay-chip text-nomi-paper hover:bg-nomi-overlay-chip-strong')}
            >
              <IconX size={16} stroke={2} />
            </button>
          </div>

          {/* 内容 */}
          <div className={cn('flex-1 min-h-0 overflow-y-auto px-4 pt-3.5 pb-4')}>
            <div className={cn('text-title font-semibold text-nomi-ink mb-2')}>{prompt.title}</div>
            <p className={cn('text-body-sm leading-relaxed text-nomi-ink-80 whitespace-pre-wrap')}>{prompt.prompt}</p>
          </div>

          {/* 操作 */}
          <div className={cn('flex items-center gap-2 px-4 py-3 border-t border-nomi-line')}>
            <button
              type="button"
              onClick={handleSend}
              className={cn('inline-flex items-center gap-1.5 h-9 px-4 rounded-full cursor-pointer border-0', 'bg-nomi-ink text-nomi-paper text-body-sm font-semibold hover:bg-nomi-accent', 'transition-[background] duration-[var(--nomi-transition-fast)]')}
            >
              {sent ? <IconCheck size={16} stroke={2} /> : <IconLayoutBoard size={16} stroke={1.8} />}
              {sent ? '已送上画布' : '送上画布'}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="复制提示词"
              className={cn('inline-flex items-center gap-1.5 h-9 px-3 rounded-full cursor-pointer', 'border border-nomi-line bg-transparent text-nomi-ink-80 text-body-sm hover:bg-nomi-ink-05')}
            >
              {copied ? <IconCheck size={15} stroke={2} /> : <IconCopy size={15} stroke={1.8} />}
              {copied ? '已复制' : '复制'}
            </button>
            <span className={cn('flex-1')} />
            {prompt.sourceUrl ? (
              <a
                href={prompt.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={cn('inline-flex items-center gap-1 text-caption text-nomi-ink-40 hover:text-nomi-ink')}
              >
                <IconExternalLink size={13} stroke={1.7} />
                来源
              </a>
            ) : (
              <span className={cn('inline-flex items-center gap-1 text-caption text-nomi-ink-40')}>我的库 · 仅本地</span>
            )}
          </div>
        </div>
        <style>{`@keyframes nomi-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      </div>
    </Portal>
  )
}
