import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageGenerationPreset } from 'img-fx'
import { useWorkbenchStore } from '../../workbenchStore'
import { GenerationWaitingSurface } from './GenerationWaitingSurface'
import { useDeferredNodeMediaVisibility } from './deferredNodeMediaQueue'
import { importRevealRatio, useAssetImportProgressStore } from '../store/assetImportProgressStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 1.38 GB / 640 MB / 12.4 MB —— 只给一位小数，读数比精度重要。 */
function formatImportBytes(bytes: number): string {
  if (!(bytes > 0)) return ''
  const gigabytes = bytes / (1024 * 1024 * 1024)
  if (gigabytes >= 1) return `${gigabytes.toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 导入中的节点：进度驱动的渐显。
 *
 * 和生成的区别就是「有没有真进度」——生成是不确定的等待（按时间跑动画），
 * 导入知道自己搬了多少字节（马赛克长多少由字节说了算）。两者共用同一个等待层组件，
 * 不为导入另写一套视觉。
 */
export function NodeImportingOverlay({ node, motion, preset }: {
  node: GenerationCanvasNode
  motion?: 'reduced'
  preset?: ImageGenerationPreset
}): JSX.Element | null {
  const { t } = useTranslation()
  const progress = useAssetImportProgressStore((state) => state.byNode[node.id])
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  const viewport = useDeferredNodeMediaVisibility()
  if (node.meta?.uploadStatus !== 'uploading') return null
  const ratio = importRevealRatio(progress)
  const size = formatImportBytes(progress?.totalBytes ?? 0)
  // 比例为 0 = 一个字节都还没搬：主进程还在读文件头 / ffprobe / 归一化。
  // 大视频会在这一段停几十秒，报「0%」像卡死了；说「检查中」才是那一刻真实发生的事。
  const checking = ratio === 0
  const percent = Math.round(ratio * 100)
  const label = checking
    ? (size ? t('generationCommon.observability.import.checking', { size }) : t('generationCommon.observability.import.checkingUnknownSize'))
    : (size ? t('generationCommon.observability.import.progress', { percent, size }) : t('generationCommon.observability.import.progressUnknownSize', { percent }))
  return <div ref={viewport.ref} className="absolute inset-0 z-[3] pointer-events-none" data-generating-placement="import">
    <GenerationWaitingSurface previewLabel="" zoom={zoom} inViewport={viewport.visible} motion={motion} preset={preset}
      progressReveal={{ ratio, imageUrl: progress?.previewUrl }} label={label} />
  </div>
}
