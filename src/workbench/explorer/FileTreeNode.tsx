import React from 'react'
import {
  IconChevronRight,
  IconFile,
  IconFileText,
  IconMovie,
  IconMusic,
  IconPhoto,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { useFilePreviewStore } from './useFilePreviewStore'
import { WORKSPACE_FILE_DRAG_MIME, type WorkspaceFileDragPayload } from './workspaceFileDrag'

type Props = {
  node: WorkspaceFileNode
  projectId: string
  depth?: number
}

function FileKindIcon({ kind }: { kind: WorkspaceFileNode['kind'] }): JSX.Element {
  if (kind === 'text') return <IconFileText size={16} stroke={1.5} aria-hidden />
  if (kind === 'image') return <IconPhoto size={16} stroke={1.5} aria-hidden />
  if (kind === 'video') return <IconMovie size={16} stroke={1.5} aria-hidden />
  if (kind === 'audio') return <IconMusic size={16} stroke={1.5} aria-hidden />
  if (kind === 'document') return <IconFileText size={16} stroke={1.5} aria-hidden />
  return <IconFile size={16} stroke={1.5} aria-hidden />
}

export default function FileTreeNode({ node, projectId, depth = 0 }: Props): JSX.Element {
  const [expanded, setExpanded] = React.useState(depth < 2)
  const [selected, setSelected] = React.useState(false)
  const openPreview = useFilePreviewStore((s) => s.openPreview)
  const hasChildren = node.kind === 'directory' && Boolean(node.children?.length)
  const label = node.name

  const selectOrToggle = React.useCallback(() => {
    if (node.kind === 'directory') {
      setExpanded((value) => !value)
      return
    }
    setSelected(true)
  }, [node.kind])

  // Single click keeps selecting (muscle memory); preview opens on double-click or
  // Space (QuickLook-style) so glancing at a file never hijacks ordinary clicks.
  const preview = React.useCallback(() => {
    if (node.kind !== 'directory') openPreview(projectId, node)
  }, [node, projectId, openPreview])

  // 图片/视频可拖进画布（引用已在项目里的文件，不重新导入）。
  const draggable = (node.kind === 'image' || node.kind === 'video') && Boolean(projectId)
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!draggable) return
    const payload: WorkspaceFileDragPayload = { projectId, relativePath: node.relativePath, name: node.name, kind: node.kind }
    event.dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'copy'
  }, [draggable, node.kind, node.name, node.relativePath, projectId])

  return (
    <div>
      <button
        type="button"
        draggable={draggable}
        onDragStart={handleDragStart}
        onClick={selectOrToggle}
        onDoubleClick={preview}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.code === 'Space') && node.kind !== 'directory') {
            e.preventDefault()
            preview()
          }
        }}
        className={cn(
          'w-full h-7 flex items-center gap-1 rounded-nomi-sm px-1 text-left text-caption',
          'text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05',
          selected && 'bg-nomi-ink-05 text-nomi-ink',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={node.relativePath}
      >
        <span className="w-7 shrink-0 grid place-items-center text-nomi-ink-40">
          {hasChildren ? (
            <IconChevronRight
              size={16}
              stroke={1.5}
              className={cn('transition-transform', expanded && 'rotate-90')}
              aria-hidden
            />
          ) : (
            <FileKindIcon kind={node.kind} />
          )}
        </span>
        <span className="truncate">{label}</span>
      </button>
      {hasChildren && expanded ? (
        <div>
          {node.children?.map((child) => (
            <FileTreeNode key={child.id} node={child} projectId={projectId} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
