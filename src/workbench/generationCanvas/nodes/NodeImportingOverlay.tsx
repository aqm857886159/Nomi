import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
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
 * 和生成的区别就是「有没有真进度」——生成是不确定的等待（静止灰格），
 * 导入知道自己搬了多少字节（马赛克长多少由字节说了算）。两者共用同一个等待层组件，
 * 不为导入另写一套视觉。
 */
export function NodeImportingOverlay({ node }: {
  node: GenerationCanvasNode
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
  // 转换格式：比例来自 ffmpeg 已转时长 / 探到的总时长。探不到总时长时主进程只报开头那个 0、不编比例，
  // 这时说「转换格式」不带百分比——一直挂着「转换格式 · 0%」像卡死了。
  const converting = progress?.phase === 'converting'
  // 字节搬完了、事情没完（哈希重读整份文件、落库、认领预览）。这一段在 1.3 GB 真素材上约 5 秒，
  // 此前显示的是「100%」，和卡死长得一模一样（2026-09-17，W-08）。
  // 不编一个走到 99% 就停的假进度条：这一段没有可测的分母，诚实说「在收尾」。
  const finalizing = progress?.phase === 'finalizing'
  const label = finalizing
    ? (size ? t('generationCommon.observability.import.finalizing', { size }) : t('generationCommon.observability.import.finalizingUnknownSize'))
    : converting && checking
      ? (size ? t('generationCommon.observability.import.convertingUnmeasured', { size }) : t('generationCommon.observability.import.convertingUnmeasuredUnknownSize'))
    : converting
      ? (size ? t('generationCommon.observability.import.converting', { percent, size }) : t('generationCommon.observability.import.convertingUnknownSize', { percent }))
    : checking
      ? (size ? t('generationCommon.observability.import.checking', { size }) : t('generationCommon.observability.import.checkingUnknownSize'))
      : (size ? t('generationCommon.observability.import.progress', { percent, size }) : t('generationCommon.observability.import.progressUnknownSize', { percent }))
  return <div ref={viewport.ref} className="absolute inset-0 z-[3] pointer-events-none" data-generating-placement="import">
    <GenerationWaitingSurface previewLabel="" zoom={zoom} inViewport={viewport.visible}
      progressReveal={{ ratio, imageUrl: progress?.previewUrl }} label={label} />
  </div>
}
