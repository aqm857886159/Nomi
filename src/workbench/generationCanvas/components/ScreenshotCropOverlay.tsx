import { canvasLayerMayHandleInput } from '../../shortcutSurface'
/**
 * 全局截图落地面板：热键抓完整屏 → 在这里拖一个区域 → 落成画布节点。
 *
 * 为什么选区做在**应用内**、而不是在屏幕上盖一层透明窗去盲拖：
 * 抓屏发生时用户多半正在别的软件里（这正是全局热键的意义），此刻把 Nomi 拉到前台、
 * 把抓到的整屏摆出来让他看清了再框，比在一层半透明遮罩上凭记忆拖要靠谱得多——
 * 而且框错了能当场重框、能取消，不用重按一次热键。
 *
 * 直接回车/点确认 = 要整屏（不框也是一种合法选择，别逼用户必须拖一下）。
 */
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconX } from '@tabler/icons-react'
import { useModalInputLayer } from '../../../design/modalInputLayer'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { dataUrlToFile, persistNodeImageFile } from '../adapters/persistNodeImage'
import { isProjectImportCancellation } from '../adapters/assetImportAdapter'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { cropScreenshotRegion, normalizeSelectionRect, type SelectionRect } from './screenshotCropGeometry'
import { computeMediaMetaPatch } from '../nodes/nodeSizing'

type Props = {
  capture: { url: string; width: number; height: number }
  /** 抓屏发生时就固定的原项目生命周期（由主进程绑定经 useCanvasScreenshotCapture 接手），不在确认时重新认领当前项目。 */
  project: ProjectExecutionContext
  basePosition: { x: number; y: number }
  categoryId?: string
  onClose: () => void
}

export function ScreenshotCropOverlay({ capture, project, basePosition, categoryId, onClose }: Props): JSX.Element {
  const { t } = useTranslation()
  const frameRef = React.useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = React.useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [busy, setBusy] = React.useState(false)

  const selection: SelectionRect | null = drag ? normalizeSelectionRect(drag.start, drag.end) : null
  const canvasViewport =
    typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.workbench-generation__canvas')
  const isTopLayer = useModalInputLayer(Boolean(canvasViewport), canvasViewport)

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canvasLayerMayHandleInput(isTopLayer)) { event.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isTopLayer, onClose])

  const pointFromEvent = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const commit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      project.assertCurrent()
      // 没框 = 要整屏。框太小（误点）也当整屏，别产出一个 3px 的碎片。
      const region = selection && selection.width > 0.01 && selection.height > 0.01 ? selection : null
      const cropped = region ? await cropScreenshotRegion(capture.url, region) : null
      project.assertCurrent()
      const url = cropped?.dataUrl ?? capture.url
      const store = useGenerationCanvasStore.getState()
      const created = store.addNode({
        kind: 'image',
        title: t('generationCommon.screenshot.nodeTitle'),
        position: basePosition,
        ...(categoryId ? { categoryId } : {}),
      })
      const createdAt = Date.now()
      const resultId = `screenshot-${createdAt}`
      const dimensions = cropped ? { width: cropped.width, height: cropped.height } : { width: capture.width, height: capture.height }
      const mediaMeta = computeMediaMetaPatch({ resultType: 'image', meta: created.meta || {}, ...dimensions })?.meta
      useGenerationCanvasStore.getState().updateNode(created.id, {
        result: { id: resultId, type: 'image', url, createdAt },
        ...(mediaMeta ? { meta: mediaMeta } : {}),
      })
      useGenerationCanvasStore.getState().selectNode(created.id)
      // 裁过的图是 base64 → 落盘换成 nomi-local://（别让 PNG base64 常驻 store）。
      if (cropped) {
        const file = dataUrlToFile(cropped.dataUrl, `screenshot-${createdAt}.png`)
        if (file) {
          // 只拿门牌号（它的契约测试住在白板目录，归草稿 #1189）：结果没有预览事实，由打开 / 变更后补预览补齐。
          const localUrl = await persistNodeImageFile(file, created.id, project)
          project.assertCurrent()
          const latest = useGenerationCanvasStore.getState()
          const node = latest.nodes.find((candidate) => candidate.id === created.id)
          if (localUrl && node?.result?.id === resultId) {
            latest.updateNode(created.id, { result: { ...node.result, url: localUrl } })
          }
        }
      }
    } catch (error) {
      if (!project.signal.aborted && !isProjectImportCancellation(error)) throw error
    } finally {
      if (!project.signal.aborted) {
        setBusy(false)
        onClose()
      }
    }
  }

  if (!canvasViewport) return <></>

  return createPortal(
    <div
      className="absolute inset-0 z-application-modal flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-black/55 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('generationCommon.screenshot.title')}
      data-screenshot-crop="true"
    >
      <div className="flex w-full max-w-[900px] items-center justify-between">
        <span className="text-body-sm text-nomi-paper">{t('generationCommon.screenshot.hint')}</span>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-full border-0 bg-nomi-overlay-chip text-nomi-media-ink cursor-pointer hover:bg-nomi-overlay-chip-strong"
          aria-label={t('generationCommon.screenshot.cancel')}
          onClick={onClose}
        >
          <IconX size={16} stroke={1.8} />
        </button>
      </div>

      <div
        ref={frameRef}
        className="relative max-h-[70%] max-w-[900px] cursor-crosshair select-none overflow-hidden rounded-nomi shadow-nomi-lg"
        onPointerDown={(event) => {
          event.preventDefault()
          ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
          const point = pointFromEvent(event)
          setDrag({ start: point, end: point })
        }}
        onPointerMove={(event) => {
          if (!drag) return
          setDrag((prev) => (prev ? { ...prev, end: pointFromEvent(event) } : prev))
        }}
      >
        <img src={capture.url} alt="" draggable={false} className="block max-h-full max-w-full object-contain" />
        {selection && selection.width > 0.005 && selection.height > 0.005 ? (
          <>
            <div className="pointer-events-none absolute inset-0 bg-black/45" />
            <div
              className="pointer-events-none absolute border-2 border-nomi-ink"
              style={{
                left: `${selection.x * 100}%`,
                top: `${selection.y * 100}%`,
                width: `${selection.width * 100}%`,
                height: `${selection.height * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.0)',
                background: `url("${capture.url}") no-repeat`,
                backgroundSize: `${100 / selection.width}% ${100 / selection.height}%`,
                backgroundPosition: `${(selection.x / Math.max(1e-6, 1 - selection.width)) * 100}% ${(selection.y / Math.max(1e-6, 1 - selection.height)) * 100}%`,
              }}
            />
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-caption text-nomi-paper/80">
          {selection && selection.width > 0.01
            ? t('generationCommon.screenshot.selected', {
                width: Math.round(selection.width * capture.width),
                height: Math.round(selection.height * capture.height),
              })
            : t('generationCommon.screenshot.whole', { width: capture.width, height: capture.height })}
        </span>
        <button
          type="button"
          data-screenshot-commit="true"
          disabled={busy}
          className={cn(
            'inline-flex h-9 items-center rounded-full border-0 px-4 cursor-pointer',
            'bg-nomi-paper text-body font-medium text-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper',
            'transition-colors duration-nomi-fast ease-nomi-fast disabled:opacity-50',
          )}
          onClick={commit}
        >
          {t('generationCommon.screenshot.commit')}
        </button>
      </div>
    </div>,
    canvasViewport,
  )
}
