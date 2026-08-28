import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBlockquote,
  IconBold,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconHighlight,
  IconItalic,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconSeparatorHorizontal,
  IconStrikethrough,
  IconTable,
} from '@tabler/icons-react'
import type { Editor } from '@tiptap/react'
import i18n from '../../i18n'
import { isEditorReady } from './useNomiRichTextEditor'

/**
 * Toolbar action definitions for the shared rich-text kernel. Pure logic — the
 * creation editor renders these as a horizontal bar, the canvas text node as a
 * floating pill. One definition, two shells (no parallel toolbars).
 *
 * 画布文字节点复用同一份 actions：它会过滤掉自己没启用的特性（表格/待办/高亮）
 * ——见 buildRichTextActions 末尾的 hasFeature 守卫。
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
  const linkActive = editor.isActive('link')
  const actions: RichTextAction[] = [
    { id: 'bold', label: i18n.t('creationAi.selection.bold'), icon: <IconBold size={15} />, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
    { id: 'italic', label: i18n.t('creationAi.selection.italic'), icon: <IconItalic size={15} />, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
    { id: 'strike', label: i18n.t('creationAi.selection.strike'), icon: <IconStrikethrough size={15} />, active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
    { id: 'code', label: i18n.t('creationAi.selection.code'), icon: <IconCode size={15} />, active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() },
    { id: 'highlight', label: i18n.t('creationAi.selection.highlight'), icon: <IconHighlight size={15} />, active: editor.isActive('highlight'), onClick: () => editor.chain().focus().toggleHighlight().run() },
    { id: 'h1', label: i18n.t('creationAi.selection.heading1'), icon: <IconH1 size={16} />, active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: i18n.t('creationAi.selection.heading2'), icon: <IconH2 size={16} />, active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'h3', label: i18n.t('creationAi.selection.heading3'), icon: <IconH3 size={16} />, active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: 'blockquote', label: i18n.t('creationAi.selection.blockquote'), icon: <IconBlockquote size={15} />, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { id: 'horizontal-rule', label: i18n.t('creationAi.selection.horizontalRule'), icon: <IconSeparatorHorizontal size={15} />, onClick: () => editor.chain().focus().setHorizontalRule().run() },
    { id: 'bullet-list', label: i18n.t('creationAi.selection.bulletList'), icon: <IconList size={15} />, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { id: 'ordered-list', label: i18n.t('creationAi.selection.orderedList'), icon: <IconListNumbers size={15} />, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { id: 'task-list', label: i18n.t('creationAi.selection.taskList'), icon: <IconListCheck size={15} />, active: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run() },
    { id: 'table', label: i18n.t('creationAi.selection.insertTable'), icon: <IconTable size={15} />, onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'link', label: i18n.t('creationAi.selection.link'), icon: <IconLink size={15} />, active: linkActive, onClick: () => editor.chain().focus().setLink({ href: 'https://' }).run() },
    { id: 'undo', label: i18n.t('creationAi.selection.undo'), icon: <IconArrowBackUp size={15} />, disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
    { id: 'redo', label: i18n.t('creationAi.selection.redo'), icon: <IconArrowForwardUp size={15} />, disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
  ]
  // 画布文字节点：过滤掉未启用的特性（高亮/待办/表格/链接），只保留 StarterKit 基础能力 + 历史。
  return actions.filter((action) => {
    if (action.id === 'highlight') return Boolean(editor.schema.marks.highlight)
    if (action.id === 'task-list') return Boolean(editor.schema.nodes.taskList)
    if (action.id === 'table') return Boolean(editor.schema.nodes.table)
    if (action.id === 'link') return Boolean(editor.schema.marks.link)
    return true
  })
}
