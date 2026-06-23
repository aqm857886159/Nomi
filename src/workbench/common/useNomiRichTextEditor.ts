import React from 'react'
import { useEditor, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { markdownToTiptapContent } from '../creation/markdownToTiptap'

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
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
}

export function isEditorReady(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed)
}

const NOMI_RICH_TEXT_EDITOR_CLASS = [
  'workbench-editor__content',
  'min-h-full box-border px-8 pt-6 pb-20',
  'cursor-text text-[16px] leading-[1.76] tracking-[0] text-workbench-ink',
  'outline-none focus:outline-none focus-visible:outline-none',
  '[&_p]:m-0 [&_p]:mb-[14px]',
  '[&_h1]:mt-[22px] [&_h1]:mb-3 [&_h1]:text-[28px] [&_h1]:leading-[1.22] [&_h1]:tracking-[0] [&_h1]:text-workbench-ink',
  '[&_h2]:mt-[22px] [&_h2]:mb-3 [&_h2]:text-[22px] [&_h2]:leading-[1.22] [&_h2]:tracking-[0] [&_h2]:text-workbench-ink',
  '[&_h3]:mt-[22px] [&_h3]:mb-3 [&_h3]:text-[18px] [&_h3]:leading-[1.22] [&_h3]:tracking-[0] [&_h3]:text-workbench-ink',
  '[&_ul]:m-0 [&_ul]:mb-[14px] [&_ul]:pl-6',
  '[&_ol]:m-0 [&_ol]:mb-[14px] [&_ol]:pl-6',
  '[&_blockquote]:m-0 [&_blockquote]:mb-[14px] [&_blockquote]:border-l-[3px]',
  '[&_blockquote]:border-l-[color-mix(in_srgb,var(--workbench-accent)_34%,transparent)]',
  '[&_blockquote]:bg-workbench-surface-soft [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-workbench-ink',
  '[&_pre]:m-0 [&_pre]:mb-[14px] [&_pre]:overflow-auto [&_pre]:rounded-[7px]',
  '[&_pre]:bg-workbench-code-bg [&_pre]:p-3 [&_pre]:text-workbench-code-ink',
  '[&_code]:rounded [&_code]:bg-workbench-pressed [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.92em]',
].join(' ')

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
  /** Fires on every edit with the new JSON. Caller persists however it wants. */
  onChange?: (json: JSONContent) => void
  /** Fires on selection change with the selected plain text (empty when none). */
  onSelectionChange?: (text: string) => void
}): { editor: Editor | null; tools: NomiRichTextTools } {
  const { content, placeholder, editable = true, onChange, onSelectionChange } = options

  // Keep callbacks in refs so changing them never re-creates the editor instance.
  const onChangeRef = React.useRef(onChange)
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])
  React.useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])

  // Guards against the controlled-content effect re-applying the editor's own edits.
  const lastEditorJsonRef = React.useRef('')

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content,
    editorProps: { attributes: { class: NOMI_RICH_TEXT_EDITOR_CLASS } },
    onUpdate: ({ editor: current }) => {
      const json = current.getJSON()
      lastEditorJsonRef.current = JSON.stringify(json)
      onChangeRef.current?.(json)
    },
    onSelectionUpdate: ({ editor: current }) => {
      onSelectionChangeRef.current?.(readSelectedText(current))
    },
  })

  // Sync controlled content in (e.g. AI wrote into the doc, or node switched).
  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const nextJson = JSON.stringify(content)
    if (!nextJson || nextJson === lastEditorJsonRef.current) return
    const previousSelection = editor.state.selection
    lastEditorJsonRef.current = nextJson
    editor.commands.setContent(content)
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
    return {
      readFullText: () => (isEditorReady(editor) ? editor.getText({ blockSeparator: '\n' }).trim() : ''),
      readSelectionText: () => (isEditorReady(editor) ? readSelectedText(editor) : ''),
      insertAtCursor: (content) => apply(content, 'insert'),
      replaceSelection: (content) => apply(content, 'replace'),
      appendToEnd: (content) => apply(content, 'append'),
    }
  }, [editor])

  return { editor, tools }
}
