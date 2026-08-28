import i18n from '../../i18n'

import type { PreviewAspectRatio } from '../workbenchTypes'

export function buildMp4ExportButtonTitle(params: {
  aspectRatio: PreviewAspectRatio
  isEmpty?: boolean
  isConverting?: boolean
  isRecording?: boolean
  progressPercent?: number
}): string {
  if (params.isEmpty) return i18n.t('generationCommon.exportStatus.emptyTimeline')
  if (params.isConverting) return i18n.t('generationCommon.exportStatus.converting')
  if (params.isRecording) return i18n.t('generationCommon.exportStatus.exporting', {
      percent: Math.max(0, Math.min(100, Math.round(params.progressPercent ?? 0))),
    })
  return ['导出 MP4：1080p', params.aspectRatio, '标准发布', '保存到项目 exports 文件夹'].join(' · ')
}
