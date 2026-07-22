import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBlockquote,
  IconBold,
  IconH1,
  IconH2,
  IconItalic,
  IconList,
  IconListNumbers,
} from '@tabler/icons-react'
import type { Editor } from '@tiptap/react'
import i18n from '../../i18n'
import { isEditorReady } from './useNomiRichTextEditor'

/**
 * Toolbar action definitions for the shared rich-text kernel. Pure logic — the
 * creation editor renders these as a horizontal bar, the canvas text node as a
 * floating pill. One definition, two shells (no parallel toolbars).
 */
export type RichTextAction = {
  id: string
  label: string
  icon: JSX.Element
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

export function buildRichTextActions(editor: Editor | null): RichTextAction[] {
  if (!isEditorReady(editor)) return []
  return [
    { id: 'bold', label: i18n.t('creationAi.selection.bold'), icon: <IconBold size={15} />, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
    { id: 'italic', label: i18n.t('creationAi.selection.italic'), icon: <IconItalic size={15} />, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
    { id: 'h1', label: i18n.t('creationAi.selection.heading1'), icon: <IconH1 size={16} />, active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: i18n.t('creationAi.selection.heading2'), icon: <IconH2 size={16} />, active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'bullet-list', label: i18n.t('creationAi.selection.bulletList'), icon: <IconList size={15} />, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { id: 'ordered-list', label: i18n.t('creationAi.selection.orderedList'), icon: <IconListNumbers size={15} />, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { id: 'blockquote', label: i18n.t('creationAi.selection.blockquote'), icon: <IconBlockquote size={15} />, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { id: 'undo', label: i18n.t('creationAi.selection.undo'), icon: <IconArrowBackUp size={15} />, disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
    { id: 'redo', label: i18n.t('creationAi.selection.redo'), icon: <IconArrowForwardUp size={15} />, disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
  ]
}
