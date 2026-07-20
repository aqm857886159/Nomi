import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronRight } from '@tabler/icons-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

type ImageStackEntry = GenerationNodeResult & { url: string }

function isImageStackEntry(result: GenerationNodeResult | undefined): result is ImageStackEntry {
  return result?.type === 'image' && typeof result.url === 'string' && result.url.length > 0
}

function getImageResultStack(node: GenerationCanvasNode): ImageStackEntry[] {
  const entries: ImageStackEntry[] = []
  const seen = new Set<string>()
  const add = (result: GenerationNodeResult | undefined) => {
    if (!isImageStackEntry(result)) return
    const key = result.id || result.url
    if (seen.has(key)) return
    seen.add(key)
    entries.push(result)
  }
  add(node.result)
  ;(node.history || []).forEach(add)
  return entries
}

export function ImageResultStackControls({
  node,
  readOnly,
  selected,
  visualWidth,
  visualHeight,
  onOpenChange,
}: {
  node: GenerationCanvasNode
  readOnly: boolean
  selected: boolean
  visualWidth: number
  visualHeight: number
  onOpenChange?: (open: boolean) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const [open, setOpen] = React.useState(false)
  const entries = React.useMemo(() => getImageResultStack(node), [node])
  const currentResultId = node.result?.id || ''
  const currentResultUrl = node.result?.type === 'image' ? node.result.url || '' : ''
  const otherEntries = React.useMemo(
    () =>
      entries.filter((entry) => {
        if (currentResultId && entry.id === currentResultId) return false
        if (currentResultUrl && entry.url === currentResultUrl) return false
        return true
      }),
    [currentResultId, currentResultUrl, entries],
  )
  const setMainImage = React.useCallback(
    (entry: ImageStackEntry) => {
      if (readOnly) return
      const entryKey = entry.id || entry.url
      const latestNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
      const nextResult = [latestNode?.result, ...(latestNode?.history || [])].find((candidate) => {
        if (!isImageStackEntry(candidate)) return false
        return (candidate.id || candidate.url) === entryKey
      })
      if (!latestNode || !nextResult) return

      const nextHistory: GenerationNodeResult[] = []
      const seen = new Set<string>()
      const add = (result: GenerationNodeResult | undefined) => {
        if (!result) return
        const key = result.id || result.url || result.thumbnailUrl || result.text || ''
        if (!key || seen.has(key)) return
        seen.add(key)
        nextHistory.push(result)
      }
      const nextMain = { ...nextResult }
      add(nextMain)
      add(latestNode.result)
      ;(latestNode.history || []).forEach(add)
      updateNode(node.id, {
        result: nextMain,
        history: nextHistory,
        status: 'success',
        error: undefined,
      })
      setOpen(false)
    },
    [node.id, readOnly, updateNode],
  )

  React.useEffect(() => {
    if (!selected || entries.length < 2 || otherEntries.length === 0) setOpen(false)
  }, [entries.length, otherEntries.length, selected])

  React.useEffect(() => {
    onOpenChange?.(open && selected)
  }, [onOpenChange, open, selected])

  if (!selected || entries.length < 2) return null

  const tileWidth = visualWidth
  const tileHeight = visualHeight
  const panelGap = 14
  const columns = entries.length <= 1 ? 1 : Math.min(3, Math.ceil(Math.sqrt(entries.length)))
  const rows = Math.ceil(entries.length / columns)
  const mainRow = rows - 1
  const mainSlotY = mainRow * (tileHeight + panelGap)
  const panelWidth = tileWidth * columns + panelGap * (columns - 1)
  const originX = visualWidth / 2
  const originY = mainSlotY + visualHeight / 2

  return (
    <>
      <div
        className={cn(
          'absolute bottom-2 right-2 z-[8] inline-flex overflow-hidden rounded-full',
          'border border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-md',
          'pointer-events-auto',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="inline-flex h-7 w-9 items-center justify-center border-0 bg-transparent px-2.5 text-body-sm font-semibold tabular-nums text-inherit"
          aria-label={t('generationCommon.imagePreview.stackCount', { count: entries.length })}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          {entries.length}
        </button>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center border-0 border-l border-nomi-line bg-transparent text-inherit hover:bg-nomi-ink-05"
          aria-label={
            open ? t('generationCommon.imagePreview.collapseStack') : t('generationCommon.imagePreview.expandStack')
          }
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          <IconChevronRight
            size={16}
            stroke={2}
            className={cn('transition-transform duration-150', open && 'rotate-90')}
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && selected ? (
          <motion.div
            className={cn('absolute left-0 top-0 z-[12]', 'pointer-events-none')}
            style={{
              top: -mainSlotY,
              width: panelWidth,
              height: rows * tileHeight + (rows - 1) * panelGap,
            }}
            role="list"
            aria-label={t('generationCommon.imagePreview.switchableStack')}
            initial={{ opacity: 0, scale: 0.98, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.98, x: -10 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {otherEntries.map((entry) => {
              const layoutIndex = entries.findIndex(
                (candidate) => (candidate.id || candidate.url) === (entry.id || entry.url),
              )
              const normalizedIndex = Math.max(1, layoutIndex) - 1
              const bottomRowExtraSlots = Math.max(0, columns - 1)
              const column =
                normalizedIndex < bottomRowExtraSlots
                  ? normalizedIndex + 1
                  : (normalizedIndex - bottomRowExtraSlots) % columns
              const row =
                normalizedIndex < bottomRowExtraSlots
                  ? mainRow
                  : mainRow - 1 - Math.floor((normalizedIndex - bottomRowExtraSlots) / columns)
              const tileX = column * (tileWidth + panelGap)
              const tileY = row * (tileHeight + panelGap)
              return (
                <motion.div
                  key={entry.id || entry.url}
                  className={cn(
                    'group relative overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-md',
                    'ring-1 ring-inset ring-nomi-line transition-shadow duration-150',
                    'hover:shadow-nomi-lg hover:ring-nomi-accent',
                    'pointer-events-auto',
                  )}
                  role="listitem"
                  layout
                  initial={{
                    opacity: 0,
                    scale: 0.44,
                    rotate: 8,
                    x: originX - (tileX + tileWidth / 2),
                    y: originY - (tileY + tileHeight / 2),
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    rotate: 0,
                    x: 0,
                    y: 0,
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.44,
                    rotate: 8,
                    x: originX - (tileX + tileWidth / 2),
                    y: originY - (tileY + tileHeight / 2),
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 560,
                    damping: 24,
                    mass: 0.55,
                  }}
                  style={{
                    position: 'absolute',
                    left: tileX,
                    top: tileY,
                    width: tileWidth,
                    height: tileHeight,
                  }}
                >
                  <img
                    className="h-full w-full bg-nomi-paper object-contain"
                    src={entry.url}
                    alt=""
                    draggable={false}
                  />
                  <button
                    type="button"
                    className={cn(
                      'absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2',
                      'border border-nomi-line bg-nomi-paper text-micro font-medium text-nomi-ink shadow-nomi-sm',
                      'opacity-0 translate-y-[-2px] transition-[opacity,transform,background,color,border-color] duration-150 ease-out',
                      'hover:border-nomi-ink-20 hover:bg-nomi-ink-05 focus-visible:border-nomi-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/25',
                      'group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0',
                      readOnly && 'opacity-0 group-hover:opacity-60 group-focus-within:opacity-60',
                    )}
                    disabled={readOnly}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setMainImage(entry)
                    }}
                  >
                    <IconCheck size={13} stroke={2.2} />
                    {t('generationCommon.imagePreview.setPrimary')}
                  </button>
                </motion.div>
              )
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
