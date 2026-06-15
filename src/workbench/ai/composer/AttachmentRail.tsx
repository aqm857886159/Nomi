import { IconFile, IconFileText, IconPhoto, IconTable, IconX } from '@tabler/icons-react'
import { NomiLoadingMark } from '../../../design'
import { cn } from '../../../utils/cn'
import {
  attachmentTypeLabel,
  formatAttachmentSize,
  type ComposerAttachment,
} from './composerAttachmentTypes'

function fileExt(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').trim().toLowerCase()
  return ext && ext !== fileName.toLowerCase() ? ext : ''
}

function FileGlyph({ fileName }: { fileName: string }): JSX.Element {
  const ext = fileExt(fileName)
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <IconTable size={16} stroke={1.5} />
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'markdown'].includes(ext)) return <IconFileText size={16} stroke={1.5} />
  return <IconFile size={16} stroke={1.5} />
}

function RemoveButton({ onRemove, className }: { onRemove: () => void; className?: string }): JSX.Element {
  return (
    <button
      type="button"
      aria-label="移除附件"
      className={cn('grid size-6 place-items-center cursor-pointer', className)}
      onClick={onRemove}
    >
      {className?.includes('absolute') ? (
        <span className={cn('grid size-4 place-items-center rounded-pill border border-nomi-paper bg-nomi-ink text-nomi-paper')}>
          <IconX size={10} stroke={2} />
        </span>
      ) : (
        <IconX size={13} stroke={1.6} />
      )}
    </button>
  )
}

function AttachmentChip({ attachment, onRemove, readOnly }: { attachment: ComposerAttachment; onRemove: () => void; readOnly?: boolean }): JSX.Element {
  const uploading = attachment.status === 'uploading'
  const error = attachment.status === 'error'

  if (attachment.kind === 'image') {
    return (
      <div
        className={cn(
          'relative size-12 shrink-0 overflow-hidden rounded-nomi-sm border bg-nomi-ink-10',
          error ? 'border-workbench-danger' : 'border-nomi-line',
        )}
        title={error ? attachment.error : attachment.fileName}
        data-attachment-status={attachment.status}
      >
        {attachment.url || attachment.previewUrl ? (
          <img src={attachment.url || attachment.previewUrl} alt={attachment.fileName} className="size-full select-none object-cover" draggable={false} />
        ) : (
          <span className="grid size-full place-items-center text-nomi-ink-40"><IconPhoto size={18} stroke={1.5} /></span>
        )}
        {uploading ? (
          <span className="absolute inset-0 grid place-items-center bg-nomi-paper/60"><NomiLoadingMark size={15} /></span>
        ) : null}
        {readOnly ? null : <RemoveButton onRemove={onRemove} className="absolute -right-1 -top-1" />}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-12 max-w-[184px] shrink-0 items-center gap-2 rounded-nomi-sm border bg-nomi-ink-05 pl-2 pr-1',
        error ? 'border-workbench-danger' : 'border-nomi-line',
      )}
      title={error ? attachment.error : attachment.fileName}
      data-attachment-status={attachment.status}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-10 text-nomi-ink-60">
        {uploading ? <NomiLoadingMark size={15} /> : <FileGlyph fileName={attachment.fileName} />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body-sm text-nomi-ink">{attachment.fileName}</span>
        <span className="truncate text-micro text-nomi-ink-60">
          {error ? '上传失败' : [attachmentTypeLabel(attachment.fileName, attachment.contentType), formatAttachmentSize(attachment.sizeBytes)].filter(Boolean).join(' · ')}
        </span>
      </span>
      {readOnly ? null : (
        <RemoveButton onRemove={onRemove} className="ml-auto shrink-0 rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink" />
      )}
    </div>
  )
}

export function AttachmentRail({
  attachments,
  onRemove,
  readOnly,
  className,
}: {
  attachments: ComposerAttachment[]
  onRemove?: (id: string) => void
  readOnly?: boolean
  className?: string
}): JSX.Element | null {
  if (!attachments.length) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)} aria-label="已添加的附件">
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          readOnly={readOnly}
          onRemove={() => onRemove?.(attachment.id)}
        />
      ))}
    </div>
  )
}
