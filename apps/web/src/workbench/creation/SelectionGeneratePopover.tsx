import React from 'react'
import type { Editor } from '@tiptap/react'
import {
  IconBold,
  IconH1,
  IconH2,
  IconItalic,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'
import { createNodeFromSelection, type SelectionGenerationKind } from './createNodeFromSelection'
import { useGenerationCanvasStore } from '../generationCanvasV2/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'

type SelectionGeneratePopoverProps = {
  editor: Editor | null
  selectedText: string
  onCreated?: () => void
}

type SelectionPopoverPosition = {
  left: number
  top: number
  placement: 'top' | 'bottom'
}

type SelectionFormatAction = {
  id: string
  label: string
  active?: boolean
  icon: JSX.Element
  onClick: () => void
}

const POPOVER_WIDTH = 210
const POPOVER_HEIGHT = 40
const POPOVER_OFFSET = 10

function resolveSelectionPosition(editor: Editor, root: HTMLElement | null): SelectionPopoverPosition | null {
  if (!root) return null
  const { from, to, empty } = editor.state.selection
  if (empty || from === to) return null
  const start = editor.view.coordsAtPos(from)
  const end = editor.view.coordsAtPos(to)
  const rootRect = root.getBoundingClientRect()
  const selectionLeft = Math.min(start.left, end.left)
  const selectionRight = Math.max(start.right, end.right)
  const selectionTop = Math.min(start.top, end.top)
  const selectionBottom = Math.max(start.bottom, end.bottom)
  const preferredLeft = selectionLeft + (selectionRight - selectionLeft) / 2 - rootRect.left - POPOVER_WIDTH / 2
  const left = Math.max(12, Math.min(preferredLeft, Math.max(12, rootRect.width - POPOVER_WIDTH - 12)))
  const topPlacementTop = selectionTop - rootRect.top - POPOVER_HEIGHT - POPOVER_OFFSET
  if (topPlacementTop >= 8) {
    return { left, top: topPlacementTop, placement: 'top' }
  }
  return {
    left,
    top: Math.min(selectionBottom - rootRect.top + POPOVER_OFFSET, Math.max(8, rootRect.height - POPOVER_HEIGHT - 8)),
    placement: 'bottom',
  }
}

export default function SelectionGeneratePopover({ editor, selectedText, onCreated }: SelectionGeneratePopoverProps): JSX.Element | null {
  const normalizedText = selectedText.trim()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState<SelectionPopoverPosition | null>(null)
  const addGenerationNode = useGenerationCanvasStore((state) => state.addNode)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)

  const updatePosition = React.useCallback(() => {
    if (!editor || !normalizedText) {
      setPosition(null)
      return
    }
    const root = (rootRef.current?.closest('.workbench-editor') ?? editor.view.dom.closest('.workbench-editor')) as HTMLElement | null
    setPosition(resolveSelectionPosition(editor, root))
  }, [editor, normalizedText])

  React.useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition])

  React.useEffect(() => {
    if (!editor || !normalizedText) return
    const root = (rootRef.current?.closest('.workbench-editor') ?? editor.view.dom.closest('.workbench-editor')) as HTMLElement | null
    const scrollRoot = root?.querySelector('.workbench-editor__scroll')
    const frame = () => window.requestAnimationFrame(updatePosition)
    const onScroll = () => { frame() }
    const onResize = () => { frame() }
    scrollRoot?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      scrollRoot?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [editor, normalizedText, updatePosition])

  if (!normalizedText || !editor || !position) return null

  const handleCreate = (kind: SelectionGenerationKind) => {
    if (createNodeFromSelection({ selectedText: normalizedText, kind, addGenerationNode, setWorkspaceMode })) {
      onCreated?.()
    }
  }

  const formatActions: SelectionFormatAction[] = [
    {
      id: 'bold',
      label: '加粗',
      icon: <IconBold size={14} />,
      active: editor.isActive('bold'),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: 'italic',
      label: '斜体',
      icon: <IconItalic size={14} />,
      active: editor.isActive('italic'),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: 'h1',
      label: '一级标题',
      icon: <IconH1 size={15} />,
      active: editor.isActive('heading', { level: 1 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      label: '二级标题',
      icon: <IconH2 size={15} />,
      active: editor.isActive('heading', { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
  ]

  return (
    <div
      ref={rootRef}
      className="workbench-selection-popover"
      role="toolbar"
      aria-label="选中文本工具"
      data-placement={position.placement}
      style={{ left: position.left, top: position.top }}
    >
      <div className="workbench-selection-popover__format-group" aria-label="常用格式">
        {formatActions.map((action) => (
          <WorkbenchIconButton
            key={action.id}
            className="workbench-selection-popover__tool"
            label={action.label}
            data-active={action.active ? 'true' : 'false'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action.onClick}
            icon={action.icon}
          />
        ))}
      </div>
      <div className="workbench-selection-popover__divider" />
      <div className="workbench-selection-popover__generate-group" aria-label="生成">
        <WorkbenchIconButton
          className="workbench-selection-popover__tool workbench-selection-popover__tool--generate"
          label="生成图片"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => handleCreate('image')}
          icon={<IconPhoto size={14} />}
        />
        <WorkbenchIconButton
          className="workbench-selection-popover__tool workbench-selection-popover__tool--generate"
          label="生成视频"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => handleCreate('video')}
          icon={<IconVideo size={14} />}
        />
      </div>
    </div>
  )
}
