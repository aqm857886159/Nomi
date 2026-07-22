import React from 'react'
import i18n from '../../../i18n'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import {
  COMPOSER_ATTACHMENT_MAX_BYTES,
  attachmentKindFromContentType,
  formatAttachmentSize,
  type ComposerAttachment,
} from './composerAttachmentTypes'

// composer 附件入口可接受的类型（点击上传 / 拖拽 / 粘贴共用）。
// 传输层格式无关（nomi-local），这里只做友好筛选 + 体验提示。
export const COMPOSER_ATTACHMENT_ACCEPT =
  'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.markdown'

type SetAttachments = (updater: (prev: ComposerAttachment[]) => ComposerAttachment[]) => void

let attachmentSeq = 0
function nextAttachmentId(): string {
  attachmentSeq += 1
  return `att_${Date.now().toString(36)}_${attachmentSeq}`
}

function readAssetUrl(asset: { data?: Record<string, unknown> }): string {
  const url = asset?.data?.url
  return typeof url === 'string' ? url : ''
}

export type UseComposerAttachments = {
  isDragging: boolean
  openFilePicker: () => void
  inputRef: React.RefObject<HTMLInputElement>
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  addFiles: (files: FileList | File[] | null | undefined) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
  handlePaste: (event: React.ClipboardEvent) => void
  dragHandlers: {
    onDragEnter: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  }
}

// 把附件状态（来源可以是 store 或 useState）注入，hook 负责上传编排 + 拖拽/粘贴/选择三入口。
export function useComposerAttachments(opts: {
  attachments: ComposerAttachment[]
  setAttachments: SetAttachments
  onError?: (message: string) => void
}): UseComposerAttachments {
  const { setAttachments, onError } = opts
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragDepth, setDragDepth] = React.useState(0)
  const onErrorRef = React.useRef(onError)
  onErrorRef.current = onError

  const uploadOne = React.useCallback(async (id: string, file: File) => {
    try {
      const asset = await importWorkbenchLocalAssetFile(file)
      const url = readAssetUrl(asset)
      if (!url) throw new Error(i18n.t('runtime.attachments.uploadNoUrl'))
      setAttachments((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item
          if (item.previewUrl) {
            try { URL.revokeObjectURL(item.previewUrl) } catch { /* noop */ }
          }
          return { ...item, status: 'ready', url, previewUrl: undefined }
        }),
      )
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : i18n.t('runtime.attachments.uploadFailed')
      setAttachments((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'error', error: message } : item)),
      )
      onErrorRef.current?.(i18n.t('runtime.attachments.uploadFailedWithName', { name: file.name, message }))
    }
  }, [setAttachments])

  const addFiles = React.useCallback((files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    const accepted: Array<{ id: string; file: File }> = []
    const nextAttachments: ComposerAttachment[] = []
    for (const file of list) {
      if (file.size > COMPOSER_ATTACHMENT_MAX_BYTES) {
        onErrorRef.current?.(
          i18n.t('runtime.attachments.tooLarge', {
            name: file.name,
            limit: formatAttachmentSize(COMPOSER_ATTACHMENT_MAX_BYTES),
          }),
        )
        continue
      }
      const id = nextAttachmentId()
      const kind = attachmentKindFromContentType(file.type)
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined
      nextAttachments.push({
        id,
        fileName: file.name || 'asset',
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind,
        status: 'uploading',
        previewUrl,
      })
      accepted.push({ id, file })
    }
    if (!nextAttachments.length) return
    setAttachments((prev) => [...prev, ...nextAttachments])
    for (const { id, file } of accepted) void uploadOne(id, file)
  }, [setAttachments, uploadOne])

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl) } catch { /* noop */ }
      }
      return prev.filter((item) => item.id !== id)
    })
  }, [setAttachments])

  const clearAttachments = React.useCallback(() => {
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.previewUrl) {
          try { URL.revokeObjectURL(item.previewUrl) } catch { /* noop */ }
        }
      }
      return []
    })
  }, [setAttachments])

  const openFilePicker = React.useCallback(() => {
    inputRef.current?.click()
  }, [])

  const onInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(event.currentTarget.files)
    event.currentTarget.value = ''
  }, [addFiles])

  const handlePaste = React.useCallback((event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files || [])
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length) {
      event.preventDefault()
      addFiles(images)
    }
  }, [addFiles])

  const hasFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer?.types || []).includes('Files')

  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragDepth((depth) => depth + 1)
    },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!hasFiles(event)) return
      setDragDepth((depth) => Math.max(0, depth - 1))
    },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragDepth(0)
      addFiles(event.dataTransfer?.files)
    },
  }

  return {
    isDragging: dragDepth > 0,
    openFilePicker,
    inputRef,
    onInputChange,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dragHandlers,
  }
}
