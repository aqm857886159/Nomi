import React from 'react'
import { useEditor, type Editor, type JSONContent, type UseEditorOptions } from '@tiptap/react'
import { markInputRule, markPasteRule, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { markdownToTiptapContent } from '../creation/markdownToTiptap'
import { sanitizePastedHtml } from './sanitizePastedHtml'
import { PersistentSelectionExtension } from './persistentSelection'
import { createControlledEditorSync } from './controlledEditorSync'
import { useEditorRebuildSync } from './useEditorRebuildSync'
import { AiRewriteExtension } from '../creation/aiRewrite/rewriteSession'

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
  // 选中文字 → AI 编辑 → 就地出结果（只有创作编辑器挂；画布文字节点不挂）。
  AiRewriteExtension,
]

const EMPTY_EXTENSIONS: AnyExtension[] = []

/**
 * The React adapter must keep one mounted TipTap instance as the owner of the
 * ProseMirror view. React 19 can render a parent again while a native DOM
 * selection is settling; allowing transaction-driven React renders or an
 * implicit client/server mode to choose the lifecycle makes the DOM and the
 * editor state diverge. Both rich-text surfaces consume this one contract.
 */
const NOMI_TIPTAP_EDITOR_OPTIONS = {
  immediatelyRender: true,
  shouldRerenderOnTransaction: false,
} as const

/**
 * The only door to TipTap's `useEditor` (eslint `no-restricted-imports` bans it
 * elsewhere): every Nomi editor gets the lifecycle policy above, and a caller
 * cannot override it. Callers still own keeping their option collections stable.
 */
export function useNomiTiptapEditor(options: UseEditorOptions, deps?: React.DependencyList): Editor {
  return useEditor({ ...options, ...NOMI_TIPTAP_EDITOR_OPTIONS }, deps)
}

/**
 * Shared Tiptap rich-text kernel — single source of truth for BOTH the creation
 * editor (WorkbenchEditor) and the canvas text node (TextDocumentNode). The
 * extension set, controlled-content sync (anti-feedback-loop), selection reading
 * and markdown-apply commands all live here so we never run two Tiptap configs.
 *
 * Each surface renders its own shell (full-height toolbar vs floating bar) but
 * shares this kernel + useRichTextActions().
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

/** 受控内容按编辑器 schema 解析后，是否与当前文档结构相同。解析不了（非法内容）按「不同」处理。 */
function docsAreEqual(editor: Editor, content: JSONContent): boolean {
  try {
    return editor.schema.nodeFromJSON(content).eq(editor.state.doc)
  } catch {
    return false
  }
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

  // 编辑器是自己文档的唯一 owner：受控 content 只有「真正来自外部」时才写进来，
  // 自己发出去又经 store → props 回流的旧 JSON（React Flow 投影会晚一拍）一律不覆盖文档。
  // 裁决与 PromptEditor 共用一份（controlledEditorSync.ts）。
  const syncRef = React.useRef<ReturnType<typeof createControlledEditorSync> | null>(null)
  if (!syncRef.current) syncRef.current = createControlledEditorSync(JSON.stringify(content))
  const sync = syncRef.current

  const extensions = React.useMemo(() => [
    StarterKit,
    Placeholder.configure({ placeholder: placeholder ?? '' }),
    ...featureExtensions,
    ...(persistentSelection ? [PersistentSelectionExtension] : []),
  ], [featureExtensions, persistentSelection, placeholder])

  const editorProps = React.useMemo(
    () => ({
      // 列表的样式写在这里，不写全局 CSS：Tailwind 的 preflight 把 ul / ol 的 list-style 清成 none，
      // 之前全局 CSS 只补了缩进没补符号——点「无序 / 有序列表」只看到整段右移，像没生效（2026-10-23 用户实测）。
      // 待办列表（ul[data-type=taskList]）在 workbench.css 里以更高优先级去掉符号。
      attributes: { class: 'workbench-editor__content [&_ul]:mb-3.5 [&_ul]:pl-6 [&_ul]:list-disc [&_ol]:mb-3.5 [&_ol]:pl-6 [&_ol]:list-decimal' },
      transformPastedHTML: sanitizePaste ? (html: string) => sanitizePastedHtml(html) : undefined,
    }),
    [sanitizePaste],
  )

  const editor = useNomiTiptapEditor(
    {
      editable,
      extensions,
      content,
      editorProps,
      onUpdate: ({ editor: current }) => {
        const json = current.getJSON()
        if (sync.emit(JSON.stringify(json))) onChangeRef.current?.(json)
      },
      onSelectionUpdate: ({ editor: current }) => {
        onSelectionChangeRef.current?.(readSelectedText(current))
      },
    },
    [placeholder],
  )

  // 实例重建（placeholder 变化、Activity 放出）：新实例的文档就是它创建时拿到的那份 content，账从它重开——
  // 与 PromptEditor 同一处生命周期（useEditorRebuildSync）。
  useEditorRebuildSync(editor, sync, { serialize: (current) => JSON.stringify(current.getJSON()) })

  // Sync controlled content in (e.g. AI wrote into the doc, or node switched).
  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    if (!sync.receive(JSON.stringify(content))) return
    // owner 回流的是「同一篇文档的另一种写法」（键序 / 空段落省不省 content 不同，字符串比不等）时，
    // 这不是外部改写：文档已经是这个样子，再 setContent 只会往撤销栈里压一条看不见的等价记录，
    // 用户点完加粗得按两次撤销。按文档结构比（ProseMirror 的 Node.eq），相等就什么都不做。
    if (docsAreEqual(editor, content)) return
    const previousSelection = editor.state.selection
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
  }, [editor, content, sync])

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
