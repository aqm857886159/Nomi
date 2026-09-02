import React from 'react'
import { useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { markInputRule, markPasteRule, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { markdownToTiptapContent } from '../creation/markdownToTiptap'
import { sanitizePastedHtml } from './sanitizePastedHtml'
import { PersistentSelectionExtension } from './persistentSelection'

// ==高亮== 输入/粘贴规则：Tiptap 默认规则要求 `==` 前是行首或空白，中文「这是==重点==」
// 无空格场景会失效；这里放宽为任意位置触发，对齐 ColaMD 的 `/==([^=]+)==/`。
const HighlightWithZh = Highlight.extend({
  addInputRules() {
    return [markInputRule({ find: /==([^=]+)==$/, type: this.type })]
  },
  addPasteRules() {
    return [markPasteRule({ find: /==([^=]+)==/g, type: this.type })]
  },
})

// 创作编辑器的富文本特性扩展（模块级稳定引用，避免 editor 反复重建）。
// 画布文字节点（TextDocumentNode）复用同一内核但不挂这些——它保持基础能力，行为零回归。
export const RICH_TEXT_FEATURE_EXTENSIONS: AnyExtension[] = [
  HighlightWithZh,
  TaskList,
  TaskItem,
  TableKit,
]

const EMPTY_EXTENSIONS: AnyExtension[] = []

/**
 * Shared Tiptap rich-text kernel — single source of truth for BOTH the creation
 * editor (WorkbenchEditor) and the canvas text node (TextDocumentNode). The
 * extension set, controlled-content sync (anti-feedback-loop), selection reading
 * and markdown-apply commands all live here so we never run two Tiptap configs.
 *
 * Each surface renders its own shell (full-height toolbar vs floating bar) but
 * shares this kernel + buildRichTextActions().
 */
export type RichTextApplyMode = 'insert' | 'replace' | 'append'

export type NomiRichTextTools = {
  readFullText: () => string
  readSelectionText: () => string
  /** Apply markdown at an explicit ProseMirror range captured by the caller. */
  applyAtRange: (content: string, range: { from: number; to: number }) => void
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
}

export function isEditorReady(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed)
}

export function readSelectedText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection
  if (empty || from === to) return ''
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

export function useNomiRichTextEditor(options: {
  /** Controlled content (Tiptap JSON). Synced in without feeding back the editor's own edits. */
  content: JSONContent
  placeholder?: string
  editable?: boolean
  /** 富文本特性扩展（高亮/待办/表格）。创作编辑器传 RICH_TEXT_FEATURE_EXTENSIONS，画布文字节点省略保持基础能力。 */
  featureExtensions?: AnyExtension[]
  /** 粘贴 HTML 清洗（Excel/Word 脏 HTML → 干净语义结构）。创作编辑器开，画布文字节点默认关。 */
  sanitizePaste?: boolean
  /** Keep a selected creation range visibly marked while a sibling surface owns focus. */
  persistentSelection?: boolean
  /** Fires on every edit with the new JSON. Caller persists however it wants. */
  onChange?: (json: JSONContent) => void
  /** Fires on selection change with the selected plain text (empty when none). */
  onSelectionChange?: (text: string) => void
}): { editor: Editor | null; tools: NomiRichTextTools } {
  const {
    content,
    placeholder,
    editable = true,
    featureExtensions = EMPTY_EXTENSIONS,
    sanitizePaste = false,
    persistentSelection = false,
    onChange,
    onSelectionChange,
  } = options

  // Keep callbacks in refs so changing them never re-creates the editor instance.
  const onChangeRef = React.useRef(onChange)
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  React.useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  // Guards against the controlled-content effect re-applying the editor's own edits.
  const lastEditorJsonRef = React.useRef('')

  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        ...featureExtensions,
        ...(persistentSelection ? [PersistentSelectionExtension] : []),
      ],
      content,
      editorProps: {
        attributes: { class: 'workbench-editor__content' },
        transformPastedHTML: sanitizePaste ? (html) => sanitizePastedHtml(html) : undefined,
      },
      onUpdate: ({ editor: current }) => {
        const json = current.getJSON()
        lastEditorJsonRef.current = JSON.stringify(json)
        onChangeRef.current?.(json)
      },
      onSelectionUpdate: ({ editor: current }) => {
        onSelectionChangeRef.current?.(readSelectedText(current))
      },
    },
    [placeholder],
  )

  // Sync controlled content in (e.g. AI wrote into the doc, or node switched).
  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const nextJson = JSON.stringify(content)
    if (!nextJson || nextJson === lastEditorJsonRef.current) return
    const previousSelection = editor.state.selection
    lastEditorJsonRef.current = nextJson
    // Controlled resource switches are hydration, not user edits. Emitting an
    // update here would bump the destination document timestamp and mark its
    // storyboard designs stale merely because the user opened the document.
    editor.commands.setContent(content, { emitUpdate: false })
    if (editor.isFocused) {
      const maxPosition = editor.state.doc.content.size
      editor.commands.setTextSelection({
        from: Math.min(previousSelection.from, maxPosition),
        to: Math.min(previousSelection.to, maxPosition),
      })
    }
  }, [editor, content])

  React.useEffect(() => {
    if (isEditorReady(editor)) editor.setEditable(editable)
  }, [editor, editable])

  const tools = React.useMemo<NomiRichTextTools>(() => {
    const apply = (text: string, mode: RichTextApplyMode) => {
      if (!isEditorReady(editor)) return
      const tiptapContent = markdownToTiptapContent(text)
      if (!tiptapContent.length) return
      const chain = editor.chain().focus()
      if (mode === 'append') {
        chain.setTextSelection(editor.state.doc.content.size).insertContent(tiptapContent).run()
        return
      }
      if (mode === 'replace') {
        chain.deleteSelection().insertContent(tiptapContent).run()
        return
      }
      chain.insertContent(tiptapContent).run()
    }
    const applyAtRange = (text: string, range: { from: number; to: number }) => {
      if (!isEditorReady(editor)) return
      const tiptapContent = markdownToTiptapContent(text)
      if (!tiptapContent.length) return
      const chain = editor.chain().focus().setTextSelection(range)
      if (range.from !== range.to) chain.deleteSelection()
      chain.insertContent(tiptapContent).run()
    }
    return {
      readFullText: () => (isEditorReady(editor) ? editor.getText({ blockSeparator: '\n' }).trim() : ''),
      readSelectionText: () => (isEditorReady(editor) ? readSelectedText(editor) : ''),
      applyAtRange,
      insertAtCursor: (content) => apply(content, 'insert'),
      replaceSelection: (content) => apply(content, 'replace'),
      appendToEnd: (content) => apply(content, 'append'),
    }
  }, [editor])

  return { editor, tools }
}
