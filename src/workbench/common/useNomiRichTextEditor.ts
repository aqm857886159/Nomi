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
    editorProps: { attributes: { class: 'workbench-editor__content' } },
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
