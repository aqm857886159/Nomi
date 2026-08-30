// 创作/画布助手 composer 的附件模型（S1）。纯前端：把用户附的文件传成 nomi-local://，
// 在 composer 里以 chip 呈现。带不带去发送由 S2 的链路决定，本层只描述「一个待发附件」。

import i18n from '../../../i18n'

export type ComposerAttachmentKind = 'image' | 'file'
export type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'

export type ComposerAttachment = {
  id: string
  /** Stable project-asset identity returned by the main-process storage boundary. */
  assetId?: string
  contentHash?: string
  fileName: string
  contentType: string
  sizeBytes: number
  kind: ComposerAttachmentKind
  status: ComposerAttachmentStatus
  /** 上传完成后的 nomi-local:// 持久 URL（status==='ready' 时有值）。 */
  url?: string
  /** 图片乐观预览的 object URL（上传窗口期临时用，ready 后撤销）。 */
  previewUrl?: string
  error?: string
}

// 与生成画布图片导入上限一致（GENERATION_CANVAS_IMAGE_IMPORT_MAX_BYTES）。
export const COMPOSER_ATTACHMENT_MAX_BYTES = 30 * 1024 * 1024

export function attachmentKindFromContentType(contentType: string | null | undefined): ComposerAttachmentKind {
  return typeof contentType === 'string' && contentType.startsWith('image/') ? 'image' : 'file'
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 文件类型短标（chip 副标用），优先取扩展名，其次按 MIME 粗分。
export function attachmentTypeLabel(fileName: string, contentType: string): string {
  const ext = (fileName.split('.').pop() || '').trim().toLowerCase()
  if (ext && ext !== fileName.toLowerCase() && ext.length <= 5) return ext.toUpperCase()
  const ct = (contentType || '').toLowerCase()
  if (ct.startsWith('image/')) return i18n.t('generationCommon.composer.attachmentImage')
  if (ct.includes('pdf')) return 'PDF'
  if (ct.includes('word')) return 'DOCX'
  if (ct.includes('sheet') || ct.includes('excel')) return 'XLSX'
  if (ct.startsWith('text/')) return 'TXT'
  return i18n.t('generationCommon.composer.attachmentFile')
}
